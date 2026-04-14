/**
 * Camada de armazenamento de ficheiros: disco local (uploads/) ou S3-compatible (ex.: Backblaze B2).
 * Rotas e lógica de negócio permanecem iguais; só muda onde o buffer final é gravado.
 */

const path = require('path');
const fs = require('fs');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

function normalizeRel(p) {
  return String(p || '')
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');
}

function ensureDirForFile(absFile) {
  return fs.promises.mkdir(path.dirname(absFile), { recursive: true });
}

function absLocal(rel) {
  const relNorm = normalizeRel(rel);
  if (!relNorm || relNorm.includes('..')) {
    throw new Error('storage_path inválido.');
  }
  return path.join(UPLOAD_ROOT, ...relNorm.split('/'));
}

/** Base pública para ficheiros servidos em /uploads (driver local). */
function publicAppBase() {
  return String(process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com').replace(/\/$/, '');
}

function driver() {
  const d = String(
    process.env.STORAGE_DRIVER || process.env.FILE_STORAGE_DRIVER || 'local',
  )
    .trim()
    .toLowerCase();
  if (d === 'backblaze' || d === 'b2-s3') return 'b2';
  return d;
}

/**
 * URL pública para ficheiros no bucket B2 (formato "Friendly URL"):
 * https://fXXX.backblazeb2.com/file/NOME_DO_BUCKET
 * Pode definir diretamente ou montar com B2_DOWNLOAD_HOST + B2_BUCKET (valores do painel B2).
 */
function resolveB2PublicBase() {
  const explicit = String(process.env.B2_PUBLIC_BASE_URL || process.env.B2_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  let host = String(process.env.B2_DOWNLOAD_HOST || process.env.B2_FRIENDLY_URL_HOST || '')
    .trim()
    .replace(/\/$/, '');
  if (host.startsWith('http://') || host.startsWith('https://')) {
    try {
      host = new URL(host).host;
    } catch {
      /* keep */
    }
  }
  const bucket = String(process.env.B2_BUCKET || '').trim();
  if (host && bucket) {
    return `https://${host}/file/${bucket}`;
  }
  return '';
}

async function saveFileLocal({ buffer, relativePath, contentType: _contentType }) {
  const rel = normalizeRel(relativePath);
  const abs = absLocal(rel);
  await ensureDirForFile(abs);
  await fs.promises.writeFile(abs, buffer);
  return { relativePath: rel, driver: 'local' };
}

function createReadStreamLocal(rel) {
  const abs = absLocal(rel);
  if (!fs.existsSync(abs)) return null;
  return fs.createReadStream(abs);
}

async function readFileBufferLocal(rel) {
  const abs = absLocal(rel);
  return fs.promises.readFile(abs);
}

/**
 * Stream de leitura (GET download) — local: fs; B2: body do GetObject.
 */
async function getReadableStream(relativePath) {
  const rel = normalizeRel(relativePath);
  if (!rel) return null;
  if (driver() === 'b2') {
    const { GetObjectCommand } = getS3();
    const { bucket } = b2Config();
    const client = s3Client();
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: rel }));
    return out.Body || null;
  }
  return createReadStreamLocal(rel);
}

async function fileExistsLocal(rel) {
  try {
    await fs.promises.access(absLocal(rel));
    return true;
  } catch {
    return false;
  }
}

async function removeFileLocal(rel) {
  const abs = absLocal(rel);
  try {
    await fs.promises.unlink(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

function getPublicUrlLocal(rel) {
  const r = normalizeRel(rel);
  if (!r) return null;
  return `${publicAppBase()}/uploads/${r}`;
}

let _s3Module;
function getS3() {
  if (!_s3Module) {
    try {
      _s3Module = require('@aws-sdk/client-s3');
    } catch {
      throw new Error(
        'STORAGE_DRIVER=b2 requer a dependência @aws-sdk/client-s3. Execute: npm install @aws-sdk/client-s3',
      );
    }
  }
  return _s3Module;
}

function b2Config() {
  const endpoint = String(process.env.B2_S3_ENDPOINT || process.env.B2_ENDPOINT || '').trim();
  const region = String(process.env.B2_REGION || 'us-west-000').trim();
  const accessKeyId = String(process.env.B2_KEY_ID || process.env.B2_APPLICATION_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.B2_APPLICATION_KEY || '').trim();
  const bucket = String(process.env.B2_BUCKET || '').trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'B2: defina B2_S3_ENDPOINT, B2_KEY_ID (ou B2_APPLICATION_KEY_ID), B2_APPLICATION_KEY, B2_BUCKET',
    );
  }
  return { endpoint, region, accessKeyId, secretAccessKey, bucket };
}

function s3Client() {
  const { S3Client } = getS3();
  const c = b2Config();
  return new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    credentials: {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

async function saveFileB2({ buffer, relativePath, contentType }) {
  const { PutObjectCommand } = getS3();
  const rel = normalizeRel(relativePath);
  const { bucket } = b2Config();
  const client = s3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: rel,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  return { relativePath: rel, driver: 'b2' };
}

async function removeFileB2(rel) {
  const { DeleteObjectCommand } = getS3();
  const { bucket } = b2Config();
  const client = s3Client();
  const Key = normalizeRel(rel);
  if (!Key) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
  } catch (e) {
    console.warn('[storage/b2] remove:', e?.message || e);
  }
}

async function fileExistsB2(rel) {
  const { HeadObjectCommand } = getS3();
  const { bucket } = b2Config();
  const client = s3Client();
  const Key = normalizeRel(rel);
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key }));
    return true;
  } catch {
    return false;
  }
}

/** Extensões aceites para o pool de capas Andy Radio (ListObjects + filtro). */
const RADIO_POOL_IMAGE_KEY_EXT = /\.(jpe?g|png|webp)$/i;

/**
 * Lista chaves no bucket B2 (S3 ListObjectsV2) com extensões jpg/jpeg/png/webp.
 * Só com STORAGE_DRIVER=b2; caso contrário devolve [].
 * Prefix opcional: RADIO_B2_COVER_POOL_PREFIX (ex.: pasta no bucket).
 */
async function listB2RadioCoverPoolKeys() {
  if (driver() !== 'b2') return [];
  const { ListObjectsV2Command } = getS3();
  const { bucket } = b2Config();
  const client = s3Client();
  const prefix = normalizeRel(String(process.env.RADIO_B2_COVER_POOL_PREFIX || '').trim());
  const keys = [];
  let ContinuationToken;
  for (;;) {
    const input = { Bucket: bucket, MaxKeys: 1000 };
    if (prefix) input.Prefix = prefix;
    if (ContinuationToken) input.ContinuationToken = ContinuationToken;
    const out = await client.send(new ListObjectsV2Command(input));
    for (const obj of out.Contents || []) {
      const k = obj.Key;
      if (!k || k.endsWith('/')) continue;
      if (RADIO_POOL_IMAGE_KEY_EXT.test(k)) keys.push(k);
    }
    if (!out.IsTruncated) break;
    ContinuationToken = out.NextContinuationToken;
    if (!ContinuationToken) break;
  }
  return keys;
}

function getPublicUrlB2(rel) {
  const base = resolveB2PublicBase();
  const r = normalizeRel(rel);
  if (!r) return null;
  if (!base) {
    throw new Error(
      'B2: defina B2_PUBLIC_BASE_URL (ex.: https://f005.backblazeb2.com/file/nome-do-bucket) ou B2_DOWNLOAD_HOST (ex.: f005.backblazeb2.com) + B2_BUCKET. Sem isso a URL da foto não pode ser gravada na base de dados.',
    );
  }
  return `${base}/${r}`;
}

/**
 * Grava o ficheiro final (buffer já processado, ex. Sharp).
 * @param {{ buffer: Buffer, relativePath: string, contentType?: string }} opts
 */
async function saveFile(opts) {
  const d = driver();
  if (d === 'b2') {
    if (!resolveB2PublicBase()) {
      throw new Error(
        'B2: configure a URL pública antes de gravar: B2_PUBLIC_BASE_URL=https://fXXX.backblazeb2.com/file/NOME_BUCKET ou B2_DOWNLOAD_HOST + B2_BUCKET (veja painel Backblaze → Bucket → Friendly URL).',
      );
    }
    return saveFileB2(opts);
  }
  return saveFileLocal(opts);
}

async function readFileBuffer(relativePath) {
  const d = driver();
  if (d === 'b2') {
    const { GetObjectCommand } = getS3();
    const { bucket } = b2Config();
    const client = s3Client();
    const Key = normalizeRel(relativePath);
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
    const chunks = [];
    for await (const chunk of out.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  return readFileBufferLocal(relativePath);
}

async function fileExists(relativePath) {
  const d = driver();
  if (d === 'b2') return fileExistsB2(relativePath);
  return fileExistsLocal(relativePath);
}

async function removeFile(relativePath) {
  const d = driver();
  if (d === 'b2') return removeFileB2(relativePath);
  return removeFileLocal(relativePath);
}

/**
 * URL pública para referência (local: /uploads/... no mesmo host; B2: URL do bucket/CDN).
 */
function getPublicUrl(relativePath) {
  const d = driver();
  if (d === 'b2') return getPublicUrlB2(relativePath);
  return getPublicUrlLocal(relativePath);
}

/**
 * Caminho relativo (ex.: modelos/abc.jpg) a partir de uma URL devolvida por getPublicUrl.
 * Usado para apagar ficheiros ao substituir ou remover a foto.
 */
function relativePathFromPublicUrl(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const localPrefix = `${publicAppBase()}/uploads/`;
  if (u.startsWith(localPrefix)) {
    return normalizeRel(u.slice(localPrefix.length));
  }
  const b2 = resolveB2PublicBase();
  if (b2 && u.startsWith(`${b2}/`)) {
    return normalizeRel(u.slice(b2.length + 1));
  }
  return null;
}

(function logStorageEnvAtLoad() {
  console.log('[storage/env] STORAGE_DRIVER=', driver());
  console.log(
    '[storage/env] definidos (sem valores): B2_S3_ENDPOINT=',
    Boolean(String(process.env.B2_S3_ENDPOINT || '').trim()),
    'B2_KEY_ID=',
    Boolean(String(process.env.B2_KEY_ID || '').trim()),
    'B2_APPLICATION_KEY=',
    Boolean(String(process.env.B2_APPLICATION_KEY || '').trim()),
    'B2_BUCKET=',
    Boolean(String(process.env.B2_BUCKET || '').trim()),
  );
})();

module.exports = {
  UPLOAD_ROOT,
  saveFile,
  getReadableStream,
  readFileBuffer,
  fileExists,
  removeFile,
  getPublicUrl,
  relativePathFromPublicUrl,
  resolveB2PublicBase,
  normalizeRel,
  driver,
  listB2RadioCoverPoolKeys,
};
