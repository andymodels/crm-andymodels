/**
 * Gestão da Andy Radio no CRM: playlists, faixas, uploads (incl. múltiplos MP3).
 * Metadados: music-metadata (duração, título/artista ID3, capa embutida APIC → gravada primeiro; senão modelo aleatória).
 */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const mm = require('music-metadata');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('../services/storage');
const radioCover = require('../services/radioCoverFromModelo');

const router = express.Router();

const MAX_TRACKS_PER_PLAYLIST = 50;
const MAX_BULK = 25;

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: MAX_BULK },
});

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'playlist';
}

async function uniqueSlug(base, excludeId) {
  let slug = slugify(base);
  let n = 0;
  for (;;) {
    const trySlug = n === 0 ? slug : `${slug}-${n}`;
    const r = excludeId
      ? await pool.query(`SELECT id FROM radio_playlists WHERE slug = $1 AND id <> $2`, [trySlug, excludeId])
      : await pool.query(`SELECT id FROM radio_playlists WHERE slug = $1`, [trySlug]);
    if (r.rows.length === 0) return trySlug;
    n += 1;
    if (n > 200) return `${slugify(base)}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

function baseTitleFromFilename(originalname) {
  const base = path.basename(originalname || 'faixa', path.extname(originalname || ''));
  return base.replace(/[_-]+/g, ' ').trim() || 'Faixa';
}

async function parseAudioMeta(buffer, mimetype, fallbackTitle) {
  let durationSec = null;
  let title = fallbackTitle;
  let artist = '';
  /** Buffer da imagem embutida (APIC / capa do MP3), se existir. */
  let embeddedCoverBuffer = null;
  try {
    const metadata = await mm.parseBuffer(buffer, mimetype || 'audio/mpeg', { duration: true });
    if (metadata.format.duration != null && Number.isFinite(metadata.format.duration)) {
      durationSec = Math.round(metadata.format.duration);
    }
    if (metadata.common.title) {
      const t = String(metadata.common.title).trim();
      if (t) title = t;
    }
    const a =
      metadata.common.artist ||
      (Array.isArray(metadata.common.artists) && metadata.common.artists[0]) ||
      metadata.common.albumartist ||
      '';
    if (a) artist = String(a).trim();
    const pics = metadata.common?.picture;
    if (Array.isArray(pics) && pics.length > 0) {
      const pic = pics[0];
      if (pic?.data && pic.data.length) {
        embeddedCoverBuffer = Buffer.from(pic.data);
      }
    }
  } catch (e) {
    console.warn('[radio] parseBuffer:', e?.message || e);
  }
  return { durationSec, title, artist, embeddedCoverBuffer };
}

/** Grava capa extraída do ficheiro de áudio (cores originais, JPEG). */
async function saveEmbeddedCoverFromBuffer(imageBuffer) {
  const processed = await sharp(imageBuffer)
    .rotate()
    .resize(1200, 1600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const rel = `radio/covers/id3-${crypto.randomUUID()}.jpg`;
  await storage.saveFile({
    buffer: processed,
    relativePath: rel,
    contentType: 'image/jpeg',
  });
  return storage.getPublicUrl(rel);
}

async function countTracks(playlistId) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM radio_tracks WHERE playlist_id = $1`, [
    playlistId,
  ]);
  return rows[0]?.c ?? 0;
}

async function nextSortOrder(playlistId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM radio_tracks WHERE playlist_id = $1`,
    [playlistId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Grava uma faixa a partir de buffer de áudio; opcionalmente sobrescreve título/artista.
 */
async function createTrackFromAudioBuffer(playlistId, buffer, originalname, mimetype, overrides = {}) {
  const ext = path.extname(originalname || '') || '.mp3';
  const safeExt = /^\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(ext) ? ext.toLowerCase() : '.mp3';
  const fallbackTitle = overrides.title || baseTitleFromFilename(originalname);

  const { durationSec, title, artist, embeddedCoverBuffer } = await parseAudioMeta(
    buffer,
    mimetype,
    fallbackTitle,
  );

  /** 1) Capa embutida no MP3 (ID3). 2) Senão, modelo feminina aleatória (P&B + nome no rodapé), se activo. */
  let coverUrl = null;
  let coverModeloId = null;
  if (overrides.cover_url != null) {
    coverUrl = overrides.cover_url;
    coverModeloId =
      overrides.cover_modelo_id != null && overrides.cover_modelo_id !== undefined
        ? overrides.cover_modelo_id
        : null;
  } else if (embeddedCoverBuffer && embeddedCoverBuffer.length > 0) {
    try {
      coverUrl = await saveEmbeddedCoverFromBuffer(embeddedCoverBuffer);
      coverModeloId = null;
    } catch (e) {
      console.warn('[radio] capa embutida (ID3) inválida ou falha ao gravar:', e?.message || e);
    }
  }
  if (
    coverUrl == null &&
    !overrides.skip_auto_model_cover &&
    radioCover.autoCoverFromModelEnabled()
  ) {
    const gen = await radioCover.generateFemaleModelCoverUrl();
    if (gen.ok) {
      coverUrl = gen.publicUrl;
      coverModeloId = gen.modelo_id != null ? gen.modelo_id : null;
    } else {
      console.warn('[radio] capa automática (modelo aleatório):', gen.reason);
    }
  }

  const audioRel = `radio/audio/${playlistId}/${crypto.randomUUID()}${safeExt}`;
  await storage.saveFile({
    buffer,
    relativePath: audioRel,
    contentType: mimetype || 'audio/mpeg',
  });

  const sortOrder = await nextSortOrder(playlistId);
  const { rows } = await pool.query(
    `INSERT INTO radio_tracks (
       playlist_id, title, artist, audio_storage_path, cover_url, cover_modelo_id, duration_sec, sort_order, active, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
     RETURNING *`,
    [
      playlistId,
      String(overrides.title || title).slice(0, 500),
      String(overrides.artist != null ? overrides.artist : artist).slice(0, 500),
      audioRel,
      coverUrl,
      coverModeloId,
      durationSec,
      sortOrder,
    ],
  );
  return rows[0];
}

function playlistFullPayload(currentCount) {
  return {
    message: `Limite de ${MAX_TRACKS_PER_PLAYLIST} faixas por playlist. Esta playlist já tem ${currentCount} faixa(s). Apague ou mova faixas antes de adicionar mais.`,
    code: 'RADIO_PLAYLIST_FULL',
    max_tracks_per_playlist: MAX_TRACKS_PER_PLAYLIST,
    current_tracks: currentCount,
  };
}

router.get('/radio/meta', (_req, res) => {
  return res.json({
    max_tracks_per_playlist: MAX_TRACKS_PER_PLAYLIST,
    max_bulk_audio_files: MAX_BULK,
    /** Capa: primeiro ID3 no MP3; senão modelo aleatória (desligar: RADIO_COVER_AUTO_MODEL=0). */
    cover_embedded_first: true,
    cover_fallback_random_model: radioCover.autoCoverFromModelEnabled(),
  });
});

// ——— Playlists ———

router.get('/radio/playlists', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM radio_tracks t WHERE t.playlist_id = p.id) AS track_count
       FROM radio_playlists p
       ORDER BY p.sort_order ASC, p.id ASC`,
    );
    return res.json(rows);
  } catch (e) {
    return next(e);
  }
});

router.post('/radio/playlists', express.json(), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Nome da playlist é obrigatório.' });
    const description = String(req.body?.description ?? '').trim();
    const slug = await uniqueSlug(req.body?.slug || name);
    const sortOrder = Number(req.body?.sort_order);
    const active = req.body?.active === false ? false : true;
    const status = req.body?.status === 'draft' ? 'draft' : 'published';
    const cover_url = req.body?.cover_url != null ? String(req.body.cover_url).trim() || null : null;
    const auto_next_playlist = req.body?.auto_next_playlist === false ? false : true;

    const { rows } = await pool.query(
      `INSERT INTO radio_playlists (name, slug, description, cover_url, sort_order, active, status, auto_next_playlist, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        name,
        slug,
        description,
        cover_url,
        Number.isFinite(sortOrder) ? sortOrder : 0,
        active,
        status,
        auto_next_playlist,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    return next(e);
  }
});

router.patch('/radio/playlists/reorder', express.json(), async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'Envie ids: [ id, ... ] na ordem desejada.' });
    }
    await pool.query('BEGIN');
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const id = Number(ids[i]);
        if (!Number.isFinite(id)) continue;
        await pool.query(`UPDATE radio_playlists SET sort_order = $1, updated_at = NOW() WHERE id = $2`, [i, id]);
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

router.put('/radio/playlists/:id', express.json(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'ID inválido.' });
    const cur = await pool.query(`SELECT * FROM radio_playlists WHERE id = $1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Playlist não encontrada.' });
    const p = cur.rows[0];

    const name = req.body?.name != null ? String(req.body.name).trim() : p.name;
    if (!name) return res.status(400).json({ message: 'Nome inválido.' });
    let slug = p.slug;
    if (req.body?.slug != null && String(req.body.slug).trim()) {
      slug = await uniqueSlug(req.body.slug, id);
    } else if (req.body?.name != null && String(req.body.name).trim() !== p.name) {
      slug = await uniqueSlug(name, id);
    }
    const description = req.body?.description != null ? String(req.body.description) : p.description;
    const cover_url = req.body?.cover_url !== undefined ? (req.body.cover_url ? String(req.body.cover_url) : null) : p.cover_url;
    const sort_order = req.body?.sort_order != null ? Number(req.body.sort_order) : p.sort_order;
    const active = req.body?.active != null ? Boolean(req.body.active) : p.active;
    const status = req.body?.status === 'draft' || req.body?.status === 'published' ? req.body.status : p.status;
    const auto_next_playlist =
      req.body?.auto_next_playlist != null ? Boolean(req.body.auto_next_playlist) : p.auto_next_playlist;

    const { rows } = await pool.query(
      `UPDATE radio_playlists SET
         name = $1, slug = $2, description = $3, cover_url = $4, sort_order = $5, active = $6, status = $7,
         auto_next_playlist = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        name,
        slug,
        description,
        cover_url,
        Number.isFinite(sort_order) ? sort_order : 0,
        active,
        status,
        auto_next_playlist,
        id,
      ],
    );
    return res.json(rows[0]);
  } catch (e) {
    return next(e);
  }
});

router.delete('/radio/playlists/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'ID inválido.' });
    const { rows: tracks } = await pool.query(
      `SELECT audio_storage_path, cover_url FROM radio_tracks WHERE playlist_id = $1`,
      [id],
    );
    await pool.query(`DELETE FROM radio_playlists WHERE id = $1`, [id]);
    for (const t of tracks) {
      try {
        if (t.audio_storage_path) await storage.removeFile(t.audio_storage_path);
      } catch (_e) {
        /* ficheiro já ausente */
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
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

router.get('/radio/playlists/:id/tracks', async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    if (!Number.isFinite(playlistId)) return res.status(400).json({ message: 'ID inválido.' });
    const { rows } = await pool.query(
      `SELECT * FROM radio_tracks WHERE playlist_id = $1 ORDER BY sort_order ASC, id ASC`,
      [playlistId],
    );
    const mapped = rows.map((t) => ({
      ...t,
      audio_url: storage.getPublicUrl(t.audio_storage_path),
    }));
    return res.json(mapped);
  } catch (e) {
    return next(e);
  }
});

router.post('/radio/playlists/:id/tracks', audioUpload.single('audio'), async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    if (!Number.isFinite(playlistId)) return res.status(400).json({ message: 'ID inválido.' });
    const f = req.file;
    if (!f || !f.buffer) return res.status(400).json({ message: 'Envie o ficheiro de áudio no campo audio.' });

    const p = await pool.query(`SELECT id FROM radio_playlists WHERE id = $1`, [playlistId]);
    if (!p.rows.length) return res.status(404).json({ message: 'Playlist não encontrada.' });

    const n = await countTracks(playlistId);
    if (n >= MAX_TRACKS_PER_PLAYLIST) {
      return res.status(400).json(playlistFullPayload(n));
    }

    const overrides = {
      title: req.body?.title ? String(req.body.title).trim() : undefined,
      artist: req.body?.artist != null ? String(req.body.artist).trim() : undefined,
    };
    const row = await createTrackFromAudioBuffer(playlistId, f.buffer, f.originalname, f.mimetype, overrides);
    return res.status(201).json({
      ...row,
      audio_url: storage.getPublicUrl(row.audio_storage_path),
    });
  } catch (e) {
    return next(e);
  }
});

router.post('/radio/playlists/:id/tracks/bulk', audioUpload.array('audio', MAX_BULK), async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    if (!Number.isFinite(playlistId)) return res.status(400).json({ message: 'ID inválido.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: 'Envie um ou mais ficheiros no campo audio.' });

    const p = await pool.query(`SELECT id FROM radio_playlists WHERE id = $1`, [playlistId]);
    if (!p.rows.length) return res.status(404).json({ message: 'Playlist não encontrada.' });

    const n0 = await countTracks(playlistId);
    if (n0 + files.length > MAX_TRACKS_PER_PLAYLIST) {
      const room = Math.max(0, MAX_TRACKS_PER_PLAYLIST - n0);
      return res.status(400).json({
        message: `Esta playlist tem ${n0} faixa(s); o limite é ${MAX_TRACKS_PER_PLAYLIST}. Só cabem mais ${room} ficheiro(s) neste envio (selecionou ${files.length}). Reduza a seleção ou apague faixas.`,
        code: 'RADIO_PLAYLIST_FULL',
        max_tracks_per_playlist: MAX_TRACKS_PER_PLAYLIST,
        current_tracks: n0,
        selected_files: files.length,
        room_left: room,
      });
    }

    const created = [];
    const errors = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      try {
        const row = await createTrackFromAudioBuffer(playlistId, f.buffer, f.originalname, f.mimetype, {});
        created.push({ ...row, audio_url: storage.getPublicUrl(row.audio_storage_path) });
      } catch (err) {
        errors.push({ file: f.originalname, error: String(err?.message || err) });
      }
    }
    return res.status(201).json({ created: created.length, tracks: created, errors });
  } catch (e) {
    return next(e);
  }
});

router.patch('/radio/tracks/:trackId', express.json(), async (req, res, next) => {
  try {
    const trackId = Number(req.params.trackId);
    if (!Number.isFinite(trackId)) return res.status(400).json({ message: 'ID inválido.' });
    const cur = await pool.query(`SELECT * FROM radio_tracks WHERE id = $1`, [trackId]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Faixa não encontrada.' });
    const t = cur.rows[0];

    const title = req.body?.title != null ? String(req.body.title).trim() : t.title;
    const artist = req.body?.artist != null ? String(req.body.artist) : t.artist;
    const cover_url =
      req.body?.cover_url !== undefined ? (req.body.cover_url ? String(req.body.cover_url).trim() : null) : t.cover_url;
    const sort_order = req.body?.sort_order != null ? Number(req.body.sort_order) : t.sort_order;
    const active = req.body?.active != null ? Boolean(req.body.active) : t.active;
    let cover_modelo_id = t.cover_modelo_id;
    if (req.body?.cover_url !== undefined) {
      const newU = cover_url ? String(cover_url).trim() : null;
      const oldU = t.cover_url ? String(t.cover_url).trim() : null;
      if (newU !== oldU) cover_modelo_id = null;
    }

    if (!title) return res.status(400).json({ message: 'Título inválido.' });

    const { rows } = await pool.query(
      `UPDATE radio_tracks SET title = $1, artist = $2, cover_url = $3, cover_modelo_id = $4, sort_order = $5, active = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [title, artist, cover_url, cover_modelo_id, Number.isFinite(sort_order) ? sort_order : 0, active, trackId],
    );
    return res.json({ ...rows[0], audio_url: storage.getPublicUrl(rows[0].audio_storage_path) });
  } catch (e) {
    return next(e);
  }
});

router.patch('/radio/playlists/:playlistId/tracks/reorder', express.json(), async (req, res, next) => {
  try {
    const playlistId = Number(req.params.playlistId);
    if (!Number.isFinite(playlistId)) return res.status(400).json({ message: 'ID inválido.' });
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'Envie ids: [ id, ... ] na ordem desejada.' });
    }
    await pool.query('BEGIN');
    try {
      for (let i = 0; i < ids.length; i += 1) {
        const tid = Number(ids[i]);
        if (!Number.isFinite(tid)) continue;
        await pool.query(
          `UPDATE radio_tracks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND playlist_id = $3`,
          [i, tid, playlistId],
        );
      }
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

router.delete('/radio/tracks/:trackId', async (req, res, next) => {
  try {
    const trackId = Number(req.params.trackId);
    if (!Number.isFinite(trackId)) return res.status(400).json({ message: 'ID inválido.' });
    const cur = await pool.query(`SELECT audio_storage_path, cover_url FROM radio_tracks WHERE id = $1`, [trackId]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Faixa não encontrada.' });
    const t = cur.rows[0];
    await pool.query(`DELETE FROM radio_tracks WHERE id = $1`, [trackId]);
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
    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

router.post('/radio/playlists/:id/cover', coverUpload.single('cover'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'ID inválido.' });
    const f = req.file;
    if (!f?.buffer) return res.status(400).json({ message: 'Envie cover (imagem).' });

    const cur = await pool.query(`SELECT id, cover_url FROM radio_playlists WHERE id = $1`, [id]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Playlist não encontrada.' });
    const oldCover = cur.rows[0].cover_url ? storage.relativePathFromPublicUrl(cur.rows[0].cover_url) : null;

    const ext = path.extname(f.originalname || '').toLowerCase() || '.jpg';
    const safe = ext === '.png' ? '.png' : '.jpg';
    const rel = `radio/covers/pl-${id}-${crypto.randomUUID()}${safe}`;
    await storage.saveFile({
      buffer: f.buffer,
      relativePath: rel,
      contentType: safe === '.png' ? 'image/png' : 'image/jpeg',
    });
    const cover_url = storage.getPublicUrl(rel);
    const { rows } = await pool.query(`UPDATE radio_playlists SET cover_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [
      cover_url,
      id,
    ]);
    if (oldCover) {
      try {
        await storage.removeFile(oldCover);
      } catch (_e) {
        /* */
      }
    }
    return res.json(rows[0]);
  } catch (e) {
    return next(e);
  }
});

router.post('/radio/tracks/:trackId/cover', coverUpload.single('cover'), async (req, res, next) => {
  try {
    const trackId = Number(req.params.trackId);
    if (!Number.isFinite(trackId)) return res.status(400).json({ message: 'ID inválido.' });
    const f = req.file;
    if (!f?.buffer) return res.status(400).json({ message: 'Envie cover (imagem).' });

    const cur = await pool.query(`SELECT id, cover_url FROM radio_tracks WHERE id = $1`, [trackId]);
    if (!cur.rows.length) return res.status(404).json({ message: 'Faixa não encontrada.' });
    const oldCover = cur.rows[0].cover_url ? storage.relativePathFromPublicUrl(cur.rows[0].cover_url) : null;

    const ext = path.extname(f.originalname || '').toLowerCase() || '.jpg';
    const safe = ext === '.png' ? '.png' : '.jpg';
    const rel = `radio/covers/tr-${trackId}-${crypto.randomUUID()}${safe}`;
    await storage.saveFile({
      buffer: f.buffer,
      relativePath: rel,
      contentType: safe === '.png' ? 'image/png' : 'image/jpeg',
    });
    const cover_url = storage.getPublicUrl(rel);
    const { rows } = await pool.query(
      `UPDATE radio_tracks SET cover_url = $1, cover_modelo_id = NULL, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [cover_url, trackId],
    );
    if (oldCover) {
      try {
        await storage.removeFile(oldCover);
      } catch (_e) {
        /* */
      }
    }
    return res.json({ ...rows[0], audio_url: storage.getPublicUrl(rows[0].audio_storage_path) });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
