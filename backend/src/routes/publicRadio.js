/**
 * API pública para o site Andy (AndyRadio) — sem autenticação.
 * GET /api/radio, /api/public/radio e /api/public/radio/v2 — mesmo JSON.
 * Cada playlist: cover_url, playlist_cover_url (alias), curator_name, curator_instagram.
 */

const express = require('express');
const { pool } = require('../config/db');
const storage = require('../services/storage');

const router = express.Router();

function mapTrackRow(t, playlistMeta) {
  const url = storage.getPublicUrl(t.audio_storage_path);
  const modeloNome =
    t.modelo_nome != null && String(t.modelo_nome).trim() !== '' ? String(t.modelo_nome).trim() : null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist || '',
    filename: String(t.audio_storage_path || '').split('/').pop() || '',
    url,
    cover_url: t.cover_url || null,
    modelo_nome: modeloNome,
    cover_modelo_id: t.cover_modelo_id != null ? Number(t.cover_modelo_id) : null,
    duration_sec: t.duration_sec != null ? Number(t.duration_sec) : null,
    position: t.sort_order,
    playlist_id: playlistMeta.id,
    playlist_slug: playlistMeta.slug,
  };
}

async function sendPublicRadio(req, res, next) {
  if (!pool) {
    return res.status(503).json({ message: 'Base de dados indisponível.' });
  }
  try {
    const crmPublicBase = String(process.env.PUBLIC_APP_URL || '')
      .trim()
      .replace(/\/$/, '');
    const pathForUrl = String(req.originalUrl || '').split('?')[0] || '/api/public/radio';
    const selfUrl =
      crmPublicBase !== ''
        ? `${crmPublicBase}${pathForUrl}`
        : `${req.protocol}://${req.get('host')}${pathForUrl}`;

    const { rows: playlists } = await pool.query(
      `SELECT id, name, slug, description, cover_url, sort_order, active, status, auto_next_playlist,
              curator_name, curator_instagram
       FROM radio_playlists
       WHERE active = TRUE AND status = 'published'
       ORDER BY sort_order ASC, id ASC`,
    );

    const outPlaylists = [];
    const tracksFlat = [];

    for (const p of playlists) {
      const { rows: tracks } = await pool.query(
        `SELECT t.id, t.playlist_id, t.title, t.artist, t.audio_storage_path, t.cover_url, t.cover_modelo_id,
                t.duration_sec, t.sort_order, t.active, m.nome AS modelo_nome
         FROM radio_tracks t
         LEFT JOIN modelos m ON m.id = t.cover_modelo_id
         WHERE t.playlist_id = $1 AND t.active = TRUE
         ORDER BY t.sort_order ASC, t.id ASC`,
        [p.id],
      );
      const meta = {
        id: p.id,
        slug: p.slug,
      };
      const mapped = tracks.map((t) => mapTrackRow(t, meta));
      mapped.forEach((t) => tracksFlat.push(t));

      const curatorName = p.curator_name != null ? String(p.curator_name).trim() : '';
      const curatorIg = p.curator_instagram != null ? String(p.curator_instagram).trim() : '';
      const coverRaw = p.cover_url != null && String(p.cover_url).trim() !== '' ? String(p.cover_url).trim() : null;

      outPlaylists.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description || '',
        /** Capa da playlist (URL pública). */
        cover_url: coverRaw,
        /** Alias explícito para o site — mesmo valor que `cover_url`. */
        playlist_cover_url: coverRaw,
        curator_name: curatorName || '',
        curator_instagram: curatorIg || '',
        position: p.sort_order,
        auto_next_playlist: p.auto_next_playlist !== false,
        tracks: mapped,
      });
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    return res.json({
      version: 2,
      crm_public_base: crmPublicBase || null,
      radio_json_url: selfUrl,
      generated_at: new Date().toISOString(),
      playlists: outPlaylists,
      tracks_flat: tracksFlat,
    });
  } catch (e) {
    return next(e);
  }
}

/** Alias curto para o site (mesmo JSON que /api/public/radio). */
router.get('/radio', sendPublicRadio);
router.get('/public/radio', sendPublicRadio);
router.get('/public/radio/v2', sendPublicRadio);

/**
 * Lista única de faixas (ordem: playlists publicadas, depois faixas por sort_order).
 */
router.get('/public/radio/tracks-only', async (req, res, next) => {
  if (!pool) {
    return res.status(503).json({ message: 'Base de dados indisponível.' });
  }
  try {
    const { rows: playlists } = await pool.query(
      `SELECT id, name, slug, sort_order
       FROM radio_playlists
       WHERE active = TRUE AND status = 'published'
       ORDER BY sort_order ASC, id ASC`,
    );

    const tracks = [];
    for (const p of playlists) {
      const { rows: tr } = await pool.query(
        `SELECT t.id, t.playlist_id, t.title, t.artist, t.audio_storage_path, t.cover_url, t.cover_modelo_id,
                t.duration_sec, t.sort_order, m.nome AS modelo_nome
         FROM radio_tracks t
         LEFT JOIN modelos m ON m.id = t.cover_modelo_id
         WHERE t.playlist_id = $1 AND t.active = TRUE
         ORDER BY t.sort_order ASC, t.id ASC`,
        [p.id],
      );
      const meta = { id: p.id, slug: p.slug };
      for (const t of tr) {
        tracks.push(mapTrackRow(t, meta));
      }
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    return res.json({
      version: 1,
      source: 'crm',
      tracks,
    });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
