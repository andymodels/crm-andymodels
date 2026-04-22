#!/usr/bin/env node
/**
 * Backup da base de dados do CRM → Backblaze B2 (prefixo backups/database/).
 *
 * Produção (Render): PostgreSQL via DATABASE_URL — não é SQLite em ficheiro.
 * Requer pg_dump no PATH (GitHub Actions: instalar postgresql-client; local: brew install libpq).
 *
 * Variáveis: ver docs/BACKUP_E_RESTAURACAO.md e .env.example
 *
 * Uso:
 *   cd backend && node scripts/backupDatabaseToB2.js
 *   BACKUP_DRY_RUN=1 node scripts/backupDatabaseToB2.js   # só gera dump local, sem B2
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PREFIX = String(process.env.BACKUP_B2_PREFIX || 'backups/database/')
  .trim()
  .replace(/\/?$/, '/');
const RETENTION_KEEP = Math.max(
  1,
  Math.min(100, parseInt(String(process.env.BACKUP_RETENTION_KEEP || '12'), 10) || 12),
);

function log(msg) {
  console.log(`[backup-db-b2] ${msg}`);
}

function logErr(msg) {
  console.error(`[backup-db-b2] ${msg}`);
}

function readAppVersion() {
  try {
    const p = path.join(__dirname, '..', 'package.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return String(j.version || '1.0.0').trim();
  } catch {
    return 'unknown';
  }
}

function readGitCommit(repoRoot) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const h = String(out || '').trim();
    return h.length >= 7 ? h.slice(0, 40) : null;
  } catch {
    return null;
  }
}

function timestampForFilename() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = p(d.getMonth() + 1);
  const D = p(d.getDate());
  const h = p(d.getHours());
  const m = p(d.getMinutes());
  const s = p(d.getSeconds());
  return `${Y}-${M}-${D}-${h}${m}${s}`;
}

function assertPostgresUrl(url) {
  const u = String(url || '').trim();
  if (!u) {
    logErr('DATABASE_URL em falta. Defina a connection string do PostgreSQL (Render → Postgres → External Database URL).');
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\//i.test(u)) {
    logErr(
      'DATABASE_URL não é PostgreSQL. Este CRM em produção usa Postgres (render.yaml); não há caminho .sqlite no servidor.',
    );
    process.exit(1);
  }
  return u;
}

function runCommand(bin, args, opts = {}) {
  return spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    ...opts,
  });
}

function parseDatabaseUrl(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    const dbName = String(u.pathname || '').replace(/^\/+/, '');
    return {
      host: u.hostname,
      port: u.port ? String(u.port) : '5432',
      user: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      dbName,
      sslMode: u.searchParams.get('sslmode') || '',
    };
  } catch {
    return null;
  }
}

function isVersionMismatchError(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('server version mismatch') || (t.includes('server version:') && t.includes('pg_dump version:'));
}

function ensureDockerAvailable() {
  const check = runCommand('docker', ['--version']);
  return !(check.error || check.status !== 0);
}

function runPgDumpNative(databaseUrl, outFile) {
  const r = runCommand('pg_dump', ['-F', 'p', '-f', outFile, '--no-owner', '--no-acl', '--dbname', databaseUrl]);
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      return { ok: false, reason: 'missing_binary', stderr: 'pg_dump não encontrado no PATH.' };
    }
    return { ok: false, reason: 'spawn_error', stderr: String(r.error.message || r.error) };
  }
  if (r.status !== 0) {
    const stderr = (r.stderr || r.stdout || '').trim();
    return { ok: false, reason: isVersionMismatchError(stderr) ? 'version_mismatch' : 'exit_non_zero', stderr };
  }
  return { ok: true };
}

function runPgDumpDocker(databaseUrl, outFile, image) {
  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed || !parsed.host || !parsed.user || !parsed.dbName) {
    return {
      ok: false,
      reason: 'invalid_database_url',
      stderr: 'Não foi possível interpretar DATABASE_URL para execução via Docker.',
    };
  }
  if (!ensureDockerAvailable()) {
    return {
      ok: false,
      reason: 'docker_unavailable',
      stderr: 'Docker não disponível no ambiente para usar pg_dump via imagem postgres:18.',
    };
  }

  const outDir = path.dirname(outFile);
  const outName = path.basename(outFile);
  const env = { ...process.env };
  if (parsed.password) env.PGPASSWORD = parsed.password;
  if (parsed.sslMode) env.PGSSLMODE = parsed.sslMode;

  const args = [
    'run',
    '--rm',
    '-v',
    `${outDir}:/backup`,
    '--network',
    'host',
    '-e',
    'PGPASSWORD',
    '-e',
    'PGSSLMODE',
    image,
    'pg_dump',
    '--host',
    parsed.host,
    '--port',
    parsed.port,
    '--username',
    parsed.user,
    '--dbname',
    parsed.dbName,
    '--format=plain',
    '--file',
    `/backup/${outName}`,
    '--no-owner',
    '--no-acl',
  ];
  const r = runCommand('docker', args, { env });
  if (r.error) {
    return { ok: false, reason: 'docker_spawn_error', stderr: String(r.error.message || r.error) };
  }
  if (r.status !== 0) {
    return { ok: false, reason: 'docker_exit_non_zero', stderr: (r.stderr || r.stdout || '').trim() };
  }
  return { ok: true };
}

function runPgDump(databaseUrl, outFile) {
  const dockerImage = String(process.env.PG_DUMP_DOCKER_IMAGE || '').trim();
  if (dockerImage) {
    log(`A usar pg_dump via Docker image: ${dockerImage}`);
    const dockerResult = runPgDumpDocker(databaseUrl, outFile, dockerImage);
    if (!dockerResult.ok) {
      const err = String(dockerResult.stderr || '').slice(0, 2000);
      logErr(`Falha no pg_dump via Docker (${dockerResult.reason}). Saída (sem credenciais): ${err || '(vazio)'}`);
      process.exit(1);
    }
    return;
  }

  const nativeResult = runPgDumpNative(databaseUrl, outFile);
  if (nativeResult.ok) return;

  if (nativeResult.reason === 'version_mismatch') {
    const fallbackImage = String(process.env.PG_DUMP_DOCKER_FALLBACK_IMAGE || 'postgres:18').trim();
    log(`Versão local do pg_dump incompatível. A tentar fallback Docker (${fallbackImage})…`);
    const dockerResult = runPgDumpDocker(databaseUrl, outFile, fallbackImage);
    if (dockerResult.ok) return;
    const derr = String(dockerResult.stderr || '').slice(0, 2000);
    logErr(`Fallback Docker falhou (${dockerResult.reason}). Saída (sem credenciais): ${derr || '(vazio)'}`);
    process.exit(1);
  }

  if (nativeResult.reason === 'missing_binary') {
    logErr(
      'Comando pg_dump não encontrado. Instale cliente PostgreSQL no host ou defina PG_DUMP_DOCKER_IMAGE=postgres:18 para usar Docker.',
    );
    process.exit(1);
  }

  const err = String(nativeResult.stderr || '').slice(0, 2000);
  logErr(`pg_dump terminou com erro (${nativeResult.reason}). Saída (sem credenciais): ${err || '(vazio)'}`);
  process.exit(1);
}

function getS3Module() {
  try {
    return require('@aws-sdk/client-s3');
  } catch {
    logErr('Dependência @aws-sdk/client-s3 em falta. Execute npm install na pasta backend.');
    process.exit(1);
  }
}

function b2ClientConfig() {
  const endpoint = String(process.env.B2_S3_ENDPOINT || process.env.B2_ENDPOINT || '').trim();
  const region = String(process.env.B2_REGION || 'us-west-000').trim();
  const accessKeyId = String(process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.B2_APPLICATION_KEY || '').trim();
  const bucket = String(process.env.B2_BUCKET || '').trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    logErr(
      'Credenciais B2 incompletas. Defina B2_S3_ENDPOINT, B2_KEY_ID (ou B2_APPLICATION_KEY_ID), B2_APPLICATION_KEY, B2_BUCKET (nunca registe estes valores em logs).',
    );
    process.exit(1);
  }
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}

function s3Client() {
  const { S3Client } = getS3Module();
  const c = b2ClientConfig();
  return {
    client: new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      forcePathStyle: true,
    }),
    bucket: c.bucket,
  };
}

async function putObject(key, body, contentType) {
  const { PutObjectCommand } = getS3Module();
  const { client, bucket } = s3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
}

function keyToStem(key) {
  const rel = String(key || '').replace(/^\//, '');
  if (!rel.startsWith(PREFIX)) return null;
  const base = rel.slice(PREFIX.length);
  const m = base.match(/^(crm-backup-\d{4}-\d{2}-\d{2}-\d{6})\.(sql|meta\.json)$/);
  return m ? m[1] : null;
}

async function listBackupStems() {
  const { ListObjectsV2Command } = getS3Module();
  const { client, bucket } = s3Client();
  const stems = new Set();
  let ContinuationToken;
  for (;;) {
    const input = { Bucket: bucket, Prefix: PREFIX, MaxKeys: 1000 };
    if (ContinuationToken) input.ContinuationToken = ContinuationToken;
    const out = await client.send(new ListObjectsV2Command(input));
    for (const obj of out.Contents || []) {
      const stem = keyToStem(obj.Key);
      if (stem) stems.add(stem);
    }
    if (!out.IsTruncated) break;
    ContinuationToken = out.NextContinuationToken;
    if (!ContinuationToken) break;
  }
  return [...stems].sort().reverse();
}

async function deleteStem(stem) {
  const { DeleteObjectCommand } = getS3Module();
  const { client, bucket } = s3Client();
  for (const ext of ['sql', 'meta.json']) {
    const Key = `${PREFIX}${stem}.${ext}`;
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
      log(`Removido (retenção): ${Key}`);
    } catch (e) {
      logErr(`Aviso: não foi possível apagar ${Key}: ${e.message || e}`);
    }
  }
}

async function applyRetention() {
  const stems = await listBackupStems();
  if (stems.length <= RETENTION_KEEP) {
    log(`Retenção: ${stems.length} backup(s) no B2 (limite ${RETENTION_KEEP}). Nada a apagar.`);
    return;
  }
  const toRemove = stems.slice(RETENTION_KEEP);
  log(`Retenção: a manter os ${RETENTION_KEEP} mais recentes; a apagar ${toRemove.length} conjunto(s) antigo(s).`);
  for (const stem of toRemove) {
    await deleteStem(stem);
  }
}

async function main() {
  const dry = String(process.env.BACKUP_DRY_RUN || '').trim() === '1';
  const repoRoot = path.join(__dirname, '..', '..');
  const backendRoot = path.join(__dirname, '..');

  const databaseUrl = assertPostgresUrl(process.env.DATABASE_URL);

  const ts = timestampForFilename();
  const baseName = `crm-backup-${ts}`;
  const sqlName = `${baseName}.sql`;
  const metaName = `${baseName}.meta.json`;
  const keySql = `${PREFIX}${sqlName}`;
  const keyMeta = `${PREFIX}${metaName}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-db-backup-'));
  const tmpSql = path.join(tmpDir, sqlName);

  try {
    log('A executar pg_dump (PostgreSQL)…');
    runPgDump(databaseUrl, tmpSql);

    if (!fs.existsSync(tmpSql)) {
      logErr('Ficheiro de dump não foi criado.');
      process.exit(1);
    }
    const stat = fs.statSync(tmpSql);
    if (stat.size < 64) {
      logErr('Dump suspeito (ficheiro demasiado pequeno). Abortar.');
      process.exit(1);
    }
    log(`Dump criado (${stat.size} bytes).`);

    const meta = {
      backup_at_iso: new Date().toISOString(),
      database_file: sqlName,
      database_kind: 'postgresql',
      dump_format: 'plain_sql',
      size_bytes: stat.size,
      environment: process.env.GITHUB_ACTIONS
        ? 'github-actions'
        : process.env.RENDER
          ? 'render'
          : String(process.env.NODE_ENV || 'local').trim(),
      app_version: readAppVersion(),
      git_commit: readGitCommit(repoRoot),
      b2_key_sql: keySql,
      b2_key_meta: keyMeta,
      retention_keep: RETENTION_KEEP,
    };

    if (dry) {
      const dryOut = path.join(backendRoot, `${sqlName}.dry-run-copy`);
      fs.copyFileSync(tmpSql, dryOut);
      fs.writeFileSync(`${dryOut}.meta.json`, JSON.stringify(meta, null, 2), 'utf8');
      log(`BACKUP_DRY_RUN=1 — ficheiros copiados para: ${dryOut} (+ .meta.json). Sem upload B2.`);
      return;
    }

    const sqlBuf = fs.readFileSync(tmpSql);
    log(`A enviar para B2: ${keySql}`);
    await putObject(keySql, sqlBuf, 'application/sql');

    const metaBuf = Buffer.from(JSON.stringify(meta, null, 2), 'utf8');
    log(`A enviar metadados: ${keyMeta}`);
    await putObject(keyMeta, metaBuf, 'application/json');

    log(`Sucesso. Backup SQL: ${keySql} (${stat.size} bytes). Metadados: ${keyMeta}`);

    await applyRetention();
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

main().catch((e) => {
  logErr(e?.stack || e?.message || String(e));
  process.exit(1);
});
