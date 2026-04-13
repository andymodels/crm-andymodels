/**
 * Migração: copia ficheiros da rádio do disco local (pasta uploads/) para Backblaze B2
 * e atualiza a base de dados com as novas chaves / URLs públicas.
 *
 * NÃO apaga ficheiros antigos no disco nem no B2.
 * NÃO remove linhas da base de dados.
 *
 * Pré-requisitos:
 *   - DATABASE_URL
 *   - Variáveis B2 completas (o script força STORAGE_DRIVER=b2 para as gravações)
 *   - Ficheiros ainda presentes em LOCAL_UPLOAD_ROOT (predef.: backend/uploads),
 *     ou seja: correr na mesma máquina onde estão os ficheiros OU copiar uploads/ para aí.
 *
 * Uso:
 *   cd backend && node scripts/migrate-radio-local-to-b2.js --dry-run
 *   cd backend && node scripts/migrate-radio-local-to-b2.js --confirm
 */

const path = require('path');
const fs = require('fs');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

process.env.STORAGE_DRIVER = 'b2';

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL.');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');
const storage = require('../src/services/storage');
const { radioStorageKey } = require('../src/services/radioStoragePaths');

const LOCAL_ROOT = path.resolve(
  String(process.env.LOCAL_UPLOAD_ROOT || path.join(__dirname, '..', 'uploads')).trim(),
);

function absLocal(rel) {
  const r = storage.normalizeRel(rel);
  if (!r || r.includes('..')) return null;
  return path.join(LOCAL_ROOT, ...r.split('/'));
}

async function readLocalMaybe(rel) {
  const abs = absLocal(rel);
  if (abs && fs.existsSync(abs)) {
    return fs.promises.readFile(abs);
  }
  return null;
}

function contentTypeAudio(ext) {
  const e = String(ext).toLowerCase();
  if (e === '.mp3' || e === '.mpeg') return 'audio/mpeg';
  if (e === '.m4a' || e === '.mp4') return 'audio/mp4';
  if (e === '.wav') return 'audio/wav';
  if (e === '.ogg') return 'audio/ogg';
  if (e === '.flac') return 'audio/flac';
  return 'application/octet-stream';
}

function contentTypeImage(ext) {
  return String(ext).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');

  if (!dryRun && !confirm) {
    console.error('Use --dry-run ou --confirm.\n');
    process.exit(1);
  }

  if (!storage.resolveB2PublicBase()) {
    console.error(
      'Erro: defina B2_PUBLIC_BASE_URL (ou B2_DOWNLOAD_HOST + B2_BUCKET) e credenciais B2 antes de migrar.\n',
    );
    process.exit(1);
  }

  await initDb();

  console.log('');
  console.log(`[migrate] LOCAL_UPLOAD_ROOT=${LOCAL_ROOT}`);
  console.log(`[migrate] STORAGE_DRIVER=${storage.driver()} (forçado b2 para novos objectos)`);
  console.log('');

  const { rows: tracks } = await pool.query(
    `SELECT id, audio_storage_path, cover_url FROM radio_tracks ORDER BY id`,
  );
  const { rows: playlists } = await pool.query(
    `SELECT id, cover_url FROM radio_playlists WHERE cover_url IS NOT NULL AND TRIM(cover_url) <> '' ORDER BY id`,
  );

  let wouldAudio = 0;
  let wouldCoverTrack = 0;
  let wouldCoverPl = 0;

  for (const t of tracks) {
    if (t.audio_storage_path) {
      const buf = await readLocalMaybe(t.audio_storage_path);
      if (buf) wouldAudio += 1;
    }
    if (t.cover_url) {
      const rel = storage.relativePathFromPublicUrl(t.cover_url);
      if (rel && rel.startsWith('radio/')) {
        const buf = await readLocalMaybe(rel);
        if (buf) wouldCoverTrack += 1;
      }
    }
  }
  for (const p of playlists) {
    const rel = storage.relativePathFromPublicUrl(p.cover_url);
    if (rel && rel.startsWith('radio/')) {
      const buf = await readLocalMaybe(rel);
      if (buf) wouldCoverPl += 1;
    }
  }

  console.log(
    dryRun
      ? `Simulação: ${tracks.length} faixa(s), ${playlists.length} playlist(s) com capa.`
      : 'A migrar…',
  );
  console.log(
    `  Áudio (ficheiro local encontrado): ${wouldAudio} | Capas faixa: ${wouldCoverTrack} | Capas playlist: ${wouldCoverPl}`,
  );
  console.log('');

  if (dryRun) {
    console.log('Modo --dry-run: base de dados intacta. Corra com --confirm para executar.\n');
    await pool.end();
    return;
  }

  let okAudio = 0;
  let okCoverT = 0;
  let okCoverP = 0;
  let skipAudio = 0;
  let skipCover = 0;

  for (const t of tracks) {
    if (t.audio_storage_path) {
      const buf = await readLocalMaybe(t.audio_storage_path);
      if (!buf) {
        skipAudio += 1;
      } else {
        const ext = path.extname(t.audio_storage_path) || '.mp3';
        const newRel = radioStorageKey(ext);
        await storage.saveFile({
          buffer: buf,
          relativePath: newRel,
          contentType: contentTypeAudio(ext),
        });
        await pool.query(
          `UPDATE radio_tracks SET audio_storage_path = $1, updated_at = NOW() WHERE id = $2`,
          [newRel, t.id],
        );
        okAudio += 1;
        console.log(`[ok] faixa #${t.id} áudio: ${t.audio_storage_path} → ${newRel}`);
      }
    }

    if (t.cover_url) {
      const oldRel = storage.relativePathFromPublicUrl(t.cover_url);
      if (oldRel && oldRel.startsWith('radio/')) {
        const buf = await readLocalMaybe(oldRel);
        if (!buf) {
          skipCover += 1;
        } else {
          const ext = path.extname(oldRel) || '.jpg';
          const safe = ext === '.png' ? '.png' : '.jpg';
          const newRel = radioStorageKey(safe);
          await storage.saveFile({
            buffer: buf,
            relativePath: newRel,
            contentType: contentTypeImage(ext),
          });
          const newUrl = storage.getPublicUrl(newRel);
          await pool.query(
            `UPDATE radio_tracks SET cover_url = $1, updated_at = NOW() WHERE id = $2`,
            [newUrl, t.id],
          );
          okCoverT += 1;
          console.log(`[ok] faixa #${t.id} capa: → ${newRel}`);
        }
      }
    }
  }

  for (const p of playlists) {
    const oldRel = storage.relativePathFromPublicUrl(p.cover_url);
    if (oldRel && oldRel.startsWith('radio/')) {
      const buf = await readLocalMaybe(oldRel);
      if (!buf) {
        skipCover += 1;
      } else {
        const ext = path.extname(oldRel) || '.jpg';
        const safe = ext === '.png' ? '.png' : '.jpg';
        const newRel = radioStorageKey(safe);
        await storage.saveFile({
          buffer: buf,
          relativePath: newRel,
          contentType: contentTypeImage(ext),
        });
        const newUrl = storage.getPublicUrl(newRel);
        await pool.query(`UPDATE radio_playlists SET cover_url = $1, updated_at = NOW() WHERE id = $2`, [
          newUrl,
          p.id,
        ]);
        okCoverP += 1;
        console.log(`[ok] playlist #${p.id} capa: → ${newRel}`);
      }
    }
  }

  console.log('');
  console.log(
    `Concluído. Áudio migrados: ${okAudio}, capas faixa: ${okCoverT}, capas playlist: ${okCoverP}. Saltados (sem ficheiro local): áudio ${skipAudio}, capas ${skipCover}.`,
  );
  console.log('Ficheiros antigos no disco não foram apagados.\n');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
