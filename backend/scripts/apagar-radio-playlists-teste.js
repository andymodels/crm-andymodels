/**
 * Remove playlists de rádio consideradas de teste (nome/slug) e apaga ficheiros de áudio/capas no storage.
 *
 * Critério por omissão (basta um):
 * - nome contém "teste" (sem distinção de maiúsculas)
 * - slug começa por "test-" ou "demo-"
 *
 * Uso:
 *   cd backend && node scripts/apagar-radio-playlists-teste.js --dry-run
 *   cd backend && node scripts/apagar-radio-playlists-teste.js
 *
 * Forçar IDs concretos (ignora critério de nome):
 *   node scripts/apagar-radio-playlists-teste.js --ids=3,7 --dry-run
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL no arquivo backend/.env');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');
const storage = require('../src/services/storage');

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  let idsArg = null;
  for (const a of process.argv) {
    if (a.startsWith('--ids=')) idsArg = a.slice('--ids='.length);
  }
  const ids =
    idsArg == null || String(idsArg).trim() === ''
      ? null
      : String(idsArg)
          .split(',')
          .map((s) => Number(String(s).trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
  return { dryRun, ids };
}

async function listarPlaylistsTeste(client, explicitIds) {
  if (explicitIds && explicitIds.length > 0) {
    const { rows } = await client.query(
      `SELECT id, name, slug FROM radio_playlists WHERE id = ANY($1::int[]) ORDER BY id`,
      [explicitIds],
    );
    return rows;
  }
  const { rows } = await client.query(`
    SELECT id, name, slug FROM radio_playlists
    WHERE
      LOWER(name) LIKE '%teste%'
      OR slug LIKE 'test-%'
      OR slug LIKE 'demo-%'
    ORDER BY id
  `);
  return rows;
}

/** Mesma ideia que DELETE /api/radio/playlists/:id + capa da playlist. */
async function apagarPlaylistEFicheiros(client, id) {
  const { rows: plRows } = await client.query(`SELECT cover_url FROM radio_playlists WHERE id = $1`, [id]);
  const plCover = plRows[0]?.cover_url || null;

  const { rows: tracks } = await client.query(
    `SELECT audio_storage_path, cover_url FROM radio_tracks WHERE playlist_id = $1`,
    [id],
  );

  await client.query(`DELETE FROM radio_playlists WHERE id = $1`, [id]);

  for (const t of tracks) {
    try {
      if (t.audio_storage_path) await storage.removeFile(t.audio_storage_path);
    } catch (_e) {
      /* */
    }
    const cr = t.cover_url ? storage.relativePathFromPublicUrl(t.cover_url) : null;
    if (cr) {
      try {
        await storage.removeFile(cr);
      } catch (_e) {
        /* */
      }
    }
  }

  if (plCover) {
    const rel = storage.relativePathFromPublicUrl(plCover);
    if (rel) {
      try {
        await storage.removeFile(rel);
      } catch (_e) {
        /* */
      }
    }
  }
}

async function main() {
  const { dryRun, ids } = parseArgs();

  await initDb();
  const client = await pool.connect();
  try {
    const lista = await listarPlaylistsTeste(client, ids);

    if (lista.length === 0) {
      console.log('');
      console.log(
        ids && ids.length
          ? 'Nenhuma playlist encontrada com os IDs indicados.'
          : 'Nenhuma playlist de teste encontrada (critério: nome com «teste», ou slug test-* / demo-*). Use --ids=1,2 para apagar por ID.',
      );
      console.log('');
      return;
    }

    console.log('');
    console.log(dryRun ? 'Playlists que seriam removidas:' : 'A remover playlists:');
    lista.forEach((r) => {
      console.log(`  #${r.id} — ${r.name} — slug: ${r.slug}`);
    });
    console.log('');

    if (dryRun) {
      console.log('Modo --dry-run: nada foi apagado. Corra sem --dry-run para executar.');
      console.log('');
      return;
    }

    await client.query('BEGIN');
    for (const r of lista) {
      await apagarPlaylistEFicheiros(client, r.id);
    }
    await client.query('COMMIT');

    console.log(`OK — ${lista.length} playlist(s) removida(s).`);
    console.log('');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
