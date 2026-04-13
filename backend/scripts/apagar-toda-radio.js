/**
 * Remove TODAS as playlists Andy Radio, todas as faixas e apaga os ficheiros no storage (MP3 + capas).
 *
 * IMPORTANTE: use o mesmo ambiente (.env) que gravou os ficheiros:
 * - Se estavam no disco do Render (STORAGE_DRIVER local), corra isto na shell do Render ou com cópia de uploads.
 * - Se estão no B2, defina STORAGE_DRIVER=b2 e todas as variáveis B2_* antes de executar.
 *
 * Uso:
 *   cd backend && node scripts/apagar-toda-radio.js --dry-run
 *   cd backend && node scripts/apagar-toda-radio.js --confirm
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL (ex.: backend/.env)');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');
const storage = require('../src/services/storage');
const {
  listAllRadioPlaylistIds,
  deleteAllRadioPlaylistsWithStorage,
} = require('../src/services/radioPlaylistPurge');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');

  await initDb();
  const client = await pool.connect();
  try {
    const lista = await listAllRadioPlaylistIds(client);

    if (lista.length === 0) {
      console.log('\nNenhuma playlist de rádio na base de dados.\n');
      return;
    }

    console.log('');
    console.log(`[storage] STORAGE_DRIVER=${storage.driver()}`);
    console.log(dryRun ? 'Playlists que seriam removidas (com áudio + capas no storage):' : 'A remover:');
    lista.forEach((r) => {
      console.log(`  #${r.id} — ${r.name} — ${r.slug}`);
    });
    console.log('');

    if (dryRun) {
      console.log('Modo --dry-run: nada foi apagado. Para executar: node scripts/apagar-toda-radio.js --confirm\n');
      return;
    }

    if (!confirm) {
      console.error('Recusado: acrescente --confirm para apagar tudo, ou --dry-run para simular.\n');
      process.exit(1);
    }

    await client.query('BEGIN');
    const n = await deleteAllRadioPlaylistsWithStorage(client);
    await client.query('COMMIT');

    console.log(`OK — ${n} playlist(s) removida(s); faixas e ficheiros radio/audio e radio/covers tratados pelo storage.\n`);
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
