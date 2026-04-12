/**
 * API pública para o site Andy (AndyRadio) — sem autenticação.
 * GET /api/public/radio/v2 — playlists ativas + faixas com URLs absolutas.
 */

const express = require('express');
const { pool } = require('../config/db');
const storage = require('../services/storage');

const router = express.Router();

function mapTrackRow(t, playlistMeta) {
  const url = storage.getPublicUrl(t.audio_storage_path);
  return {
    id: t.id,
    title: t.title,
    artist: t.artist || '',
    filename: String(t.audio_storage_path || '').split('/').pop() || '',
    url,
    cover_url: t.cover_url || null,
    duration_sec: t.duration_sec != null ? Number(t.duration_sec) : null,
    position: t.sort_order,
    playlist_id: playlistMeta.id,
    playlist_slug: playlistMeta.slug,
  };
}

/**
 * Contrato para o front do site: playlists ordenadas, cada uma com tracks[].
 * Inclui `tracks_flat` com todas as faixas (ordem: playlist, depois faixa) para compatível com fila única.
 */
router.get('/public/radio/v2', async (req, res, next) => {
  if (!pool) {
    return res.status(503).json({ message: 'Base de dados indisponível.' });
  }
  try {
    const { rows: playlists } = await pool.query(
      `SELECT id, name, slug, description, cover_url, sort_order, active, status, auto_next_playlist
       FROM radio_playlists
       WHERE active = TRUE AND status = 'published'
       ORDER BY sort_order ASC, id ASC`,
    );

    const outPlaylists = [];
    const tracksFlat = [];

    for (const p of playlists) {
      const { rows: tracks } = await pool.query(
        `SELECT id, playlist_id, title, artist, audio_storage_path, cover_url, duration_sec, sort_order, active
         FROM radio_tracks
         WHERE playlist_id = $1 AND active = TRUE
         ORDER BY sort_order ASC, id ASC`,
        [p.id],
      );
      const meta = {
        id: p.id,
        slug: p.slug,
      };
      const mapped = tracks.map((t) => mapTrackRow(t, meta));
      mapped.forEach((t) => tracksFlat.push(t));
      outPlaylists.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description || '',
        cover_url: p.cover_url || null,
        position: p.sort_order,
        /** Se true, o player do site pode passar à playlist seguinte quando esta terminar (última faixa). */
        auto_next_playlist: p.auto_next_playlist !== false,
        tracks: mapped,
      });
    }

    return res.json({
      version: 2,
      generated_at: new Date().toISOString(),
      playlists: outPlaylists,
      tracks_flat: tracksFlat,
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
