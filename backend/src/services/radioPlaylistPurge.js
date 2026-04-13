/**
 * Apagar playlists de rádio com limpeza de ficheiros no storage (áudio + capas).
 * Usado pelo script CLI, pela migração única ao arrancar, e pode ser reutilizado nas rotas.
 */

const storage = require('./storage');

async function listTestPlaylistsByCriteria(client, explicitIds) {
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

/** Todas as playlists de rádio (para scripts de limpeza total). */
async function listAllRadioPlaylistIds(client) {
  const { rows } = await client.query(
    `SELECT id, name, slug FROM radio_playlists ORDER BY id`,
  );
  return rows;
}

/**
 * Apaga todas as playlists de rádio, faixas e ficheiros (áudio + capas) no storage actual (local ou B2).
 * Executar com o mesmo STORAGE_DRIVER / credenciais B2 onde os ficheiros foram gravados.
 */
async function deleteAllRadioPlaylistsWithStorage(client) {
  const lista = await listAllRadioPlaylistIds(client);
  for (const r of lista) {
    await deletePlaylistWithStorage(client, r.id);
  }
  return lista.length;
}

/** Igual a DELETE /api/radio/playlists/:id + capa da playlist. */
async function deletePlaylistWithStorage(client, id) {
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

module.exports = {
  listTestPlaylistsByCriteria,
  listAllRadioPlaylistIds,
  deleteAllRadioPlaylistsWithStorage,
  deletePlaylistWithStorage,
};
