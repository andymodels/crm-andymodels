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
const { listTestPlaylistsByCriteria, deletePlaylistWithStorage } = require('../src/services/radioPlaylistPurge');

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

async function main() {
  const { dryRun, ids } = parseArgs();

  await initDb();
  const client = await pool.connect();
  try {
    const lista = await listTestPlaylistsByCriteria(client, ids);

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
      await deletePlaylistWithStorage(client, r.id);
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
