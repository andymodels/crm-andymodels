/**
 * Migração única: remove playlists de teste (mesmos critérios que apagar-radio-playlists-teste.js).
 * Corre depois de initDb na subida do servidor. Não volta a correr após gravar o patch.
 *
 * Desativar: RADIO_SKIP_PURGE_TEST_ON_BOOT=1
 */

const { pool } = require('../config/db');
const { listTestPlaylistsByCriteria, deletePlaylistWithStorage } = require('../services/radioPlaylistPurge');

const PATCH_ID = 'radio_purge_test_playlists_v1';

async function purgeRadioTestPlaylistsOnce() {
  if (!pool || String(process.env.RADIO_SKIP_PURGE_TEST_ON_BOOT || '').trim() === '1') return;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _crm_schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const done = await client.query(`SELECT 1 FROM _crm_schema_patches WHERE id = $1`, [PATCH_ID]);
    if (done.rows.length > 0) return;

    const lista = await listTestPlaylistsByCriteria(client, null);

    if (lista.length === 0) {
      await client.query(`INSERT INTO _crm_schema_patches (id) VALUES ($1)`, [PATCH_ID]);
      return;
    }

    console.log(`[radio] Migração única: a remover ${lista.length} playlist(s) de teste…`);
    await client.query('BEGIN');
    try {
      for (const r of lista) {
        await deletePlaylistWithStorage(client, r.id);
      }
      await client.query(`INSERT INTO _crm_schema_patches (id) VALUES ($1)`, [PATCH_ID]);
      await client.query('COMMIT');
      console.log(`[radio] Playlists de teste removidas: ${lista.map((x) => x.id).join(', ')}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    console.warn('[radio] purge test playlists (ignorado):', e.message || e);
  } finally {
    client.release();
  }
}

module.exports = { purgeRadioTestPlaylistsOnce };
