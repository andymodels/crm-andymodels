/**
 * Gestão da Andy Radio no CRM: playlists, faixas, uploads (incl. múltiplos MP3).
 * Capas de faixas só automáticas (ID3 → iTunes/Deezer → pool B2). Capa da playlist: upload manual opcional (POST .../playlists/:id/cover).
 */

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const mm = require('music-metadata');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('../services/storage');
const { radioStorageKey } = require('../services/radioStoragePaths');
const radioCoverPool = require('../services/radioCoverFromPool');
const radioExternalCover = require('../services/radioTrackCoverExternal');
const youtubeRadio = require('../services/youtubeRadio');
const router = express.Router();

/**
 * Debug: rastrear URLs de capa (BD: `cover_url`). Sem cache no servidor — cada upload gera novo path.
 * Campos alinhados ao pedido de diagnóstico: recebida → gravada → devolvida.
 */
function logRadioCoverImage(event, payload) {
  const line = {
    scope: 'radio_cover',
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  console.log('[radio/cover]', JSON.stringify(line));
}

const MAX_TRACKS_PER_PLAYLIST = 50;
const MAX_BULK = 50;

/** Tamanho máximo por ficheiro de áudio (DJ sets); alinhar com validação no frontend. */
const RADIO_MAX_AUDIO_BYTES = 250 * 1024 * 1024;

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RADIO_MAX_AUDIO_BYTES, files: MAX_BULK },
});

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

function normalizeCuratorName(raw) {
  return raw != null ? String(raw).trim().slice(0, 200) : '';
}

/** Resposta API: espelha `cover_url` como `playlist_cover_url` (contrato alinhado ao site). */
function playlistRowOut(row) {
  if (!row || typeof row !== 'object') return row;
  const cover =
    row.cover_url != null && String(row.cover_url).trim() !== '' ? String(row.cover_url).trim() : null;
  return { ...row, cover_url: cover, playlist_cover_url: cover };
}

/** URL de capa da playlist; vazio ou null → null na BD. */
function normalizePlaylistCoverUrlFromBody(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/** URL do Instagram do curador; vazio permitido. */
function normalizeCuratorInstagram(raw) {
  let s = raw != null ? String(raw).trim() : '';
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  return s.slice(0, 500);
}

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
  const rel = radioStorageKey('.jpg');
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

/** Bloqueia segunda faixa com o mesmo título e artista na mesma playlist (schema sem track_id externo). */
async function assertNoDuplicateTrackInPlaylist(playlistId, finalTitle, finalArtist) {
  const { rows } = await pool.query(
    `SELECT id FROM radio_tracks WHERE playlist_id = $1 AND title = $2 AND artist = $3 LIMIT 1`,
    [playlistId, finalTitle, finalArtist],
  );
  if (rows.length) {
    const e = new Error('Já existe uma faixa com o mesmo título e artista nesta playlist.');
    e.code = 'RADIO_DUPLICATE_TRACK';
    e.statusCode = 409;
    throw e;
  }
}

async function assertNoDuplicateYoutubeInPlaylist(playlistId, videoId) {
  const { rows } = await pool.query(
    `SELECT id, youtube_url FROM radio_tracks WHERE playlist_id = $1 AND youtube_url IS NOT NULL AND TRIM(youtube_url) <> ''`,
    [playlistId],
  );
  for (const r of rows) {
    const existing = youtubeRadio.extractYoutubeVideoId(r.youtube_url);
    if (existing && existing === videoId) {
      const e = new Error('Este vídeo do YouTube já está nesta playlist.');
      e.code = 'RADIO_DUPLICATE_YOUTUBE';
      e.statusCode = 409;
      throw e;
    }
  }
}

function trackRowApiOut(row) {
  if (!row) return row;
  const vid = row.youtube_url ? youtubeRadio.extractYoutubeVideoId(row.youtube_url) : null;
  return {
    ...row,
    audio_url: row.audio_storage_path ? storage.getPublicUrl(row.audio_storage_path) : null,
    youtube_video_id: vid || null,
  };
}

/**
 * Faixa só com link YouTube (sem ficheiro de áudio no storage).
 */
async function createTrackFromYoutubeUrl(playlistId, rawUrl, overrides = {}) {
  const videoId = youtubeRadio.extractYoutubeVideoId(rawUrl);
  if (!videoId) {
    const e = new Error(
      'URL do YouTube inválida. Use um link youtu.be, youtube.com/watch?v=… ou /shorts/…',
    );
    e.code = 'RADIO_YOUTUBE_URL_INVALID';
    e.statusCode = 400;
    throw e;
  }

  const finalTitle = String(overrides.title != null ? overrides.title : '').trim().slice(0, 500) || 'YouTube';
  const finalArtist = String(overrides.artist != null ? overrides.artist : '').trim().slice(0, 500);
  await assertNoDuplicateYoutubeInPlaylist(playlistId, videoId);

  const youtubeUrlStored = String(rawUrl).trim().slice(0, 2000);
  const coverUrl = youtubeRadio.youtubeThumbnailHqUrl(videoId);
  const sortOrder = await nextSortOrder(playlistId);

  const { rows } = await pool.query(
    `INSERT INTO radio_tracks (
       playlist_id, title, artist, audio_storage_path, cover_url, cover_modelo_id, youtube_url, duration_sec, sort_order, active, updated_at
     ) VALUES ($1, $2, $3, NULL, $4, NULL, $5, NULL, $6, TRUE, NOW())
     RETURNING *`,
    [playlistId, finalTitle, finalArtist, coverUrl, youtubeUrlStored, sortOrder],
  );
  const row = rows[0];
  logRadioCoverImage('track_insert_youtube', {
    playlist_id: playlistId,
    track_id: row.id,
    cover_source: 'youtube_hqdefault',
    image_url_received: coverUrl,
    image_url_saved: row.cover_url || null,
    image_url_returned: row.cover_url || null,
    youtube_video_id: videoId,
  });
  return row;
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

  const finalTitle = String(overrides.title || title).slice(0, 500);
  const finalArtist = String(overrides.artist != null ? overrides.artist : artist).slice(0, 500);
  await assertNoDuplicateTrackInPlaylist(playlistId, finalTitle, finalArtist);

  /**
   * Capas automáticas (sem upload manual): ID3 → iTunes/Deezer → pool de imagens no B2 (ListObjects + sorteio).
   * O pool aplica-se após INSERT; a última chave B2 usada fica só em memória por faixa.
   */
  let coverUrl = null;
  let coverModeloId = null;
  let coverSource = 'none';

  if (embeddedCoverBuffer && embeddedCoverBuffer.length > 0) {
    try {
      coverUrl = await saveEmbeddedCoverFromBuffer(embeddedCoverBuffer);
      coverModeloId = null;
      coverSource = 'id3_embedded';
    } catch (e) {
      console.warn('[radio] capa embutida (ID3) inválida ou falha ao gravar:', e?.message || e);
    }
  }

  if (coverUrl == null) {
    try {
      const extBuf = await radioExternalCover.fetchOfficialArtworkBuffer(artist, title);
      if (extBuf && extBuf.length > 0) {
        coverUrl = await saveEmbeddedCoverFromBuffer(extBuf);
        coverModeloId = null;
        coverSource = 'external_store';
      }
    } catch (e) {
      console.warn('[radio] capa externa (iTunes/Deezer):', e?.message || e);
    }
  }

  const audioRel = radioStorageKey(safeExt);
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
      finalTitle,
      finalArtist,
      audioRel,
      coverUrl,
      coverModeloId,
      durationSec,
      sortOrder,
    ],
  );
  let row = rows[0];
  /** Metadados do sorteio do pool (para logs). */
  let poolApplyResult = null;

  if (
    coverUrl == null &&
    !overrides.skip_auto_model_cover &&
    radioCoverPool.poolCoverEnabled()
  ) {
    poolApplyResult = await radioCoverPool.applyCoverForTrack(row.id);
    if (poolApplyResult.ok && poolApplyResult.row) {
      row = poolApplyResult.row;
      coverUrl = row.cover_url || null;
      coverModeloId = null;
      coverSource = 'image_pool';
    } else if (poolApplyResult && !poolApplyResult.ok) {
      const r = poolApplyResult.reason;
      if (r !== 'storage_nao_b2') {
        console.warn('[radio] capa automática (pool B2):', r);
      }
    }
  }

  let imageReceived = null;
  if (coverSource === 'id3_embedded') imageReceived = '(apic_buffer_in_mp3)';
  else if (coverSource === 'external_store') imageReceived = '(itunes_or_deezer_artwork)';
  else if (coverSource === 'image_pool') imageReceived = poolApplyResult?.pool_key || '(b2_pool_key)';
  else imageReceived = coverUrl || null;
  logRadioCoverImage('track_insert_cover', {
    playlist_id: playlistId,
    track_id: row.id,
    cover_source: coverSource,
    image_url_received: imageReceived,
    image_url_saved: row.cover_url || null,
    image_url_returned: row.cover_url || null,
  });
  return row;
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
    max_audio_file_bytes: RADIO_MAX_AUDIO_BYTES,
    max_audio_file_mb: Math.floor(RADIO_MAX_AUDIO_BYTES / (1024 * 1024)),
    youtube_tracks: true,
    /** Faixas: ID3 → iTunes/Deezer (RADIO_COVER_EXTERNAL) → imagens no B2 (RADIO_COVER_IMAGE_POOL + prefixo opcional). Sem upload manual. */
    cover_pipeline: ['id3_embedded', 'external_store', 'image_pool'],
    cover_embedded_first: true,
    cover_external_api: radioExternalCover.externalCoverEnabled(),
    cover_fallback_image_pool: radioCoverPool.poolCoverEnabled(),
  });
});

// ——— Playlists ———

/** CRM: mais recentes primeiro: sort_order 0 = topo (novo entra com 0; resto incrementa). Desempate: created_at DESC. */
router.get('/radio/playlists', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM radio_tracks t WHERE t.playlist_id = p.id) AS track_count
       FROM radio_playlists p
       ORDER BY p.sort_order ASC, p.created_at DESC, p.id DESC`,
    );
    return res.json(rows.map(playlistRowOut));
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
    let sortOrderVal = Number(req.body?.sort_order);
    const hasExplicitSort = Number.isFinite(sortOrderVal);
    if (!hasExplicitSort) {
      sortOrderVal = 0;
    }
    const active = req.body?.active === false ? false : true;
    const status = req.body?.status === 'draft' ? 'draft' : 'published';
    const cover_url = null;
    const auto_next_playlist = req.body?.auto_next_playlist === false ? false : true;
    const curator_name = normalizeCuratorName(req.body?.curator_name);
    const curator_instagram = normalizeCuratorInstagram(req.body?.curator_instagram);

    let rows;
    if (!hasExplicitSort) {
      await pool.query('BEGIN');
      try {
        await pool.query(`UPDATE radio_playlists SET sort_order = sort_order + 1, updated_at = NOW()`);
        const ins = await pool.query(
          `INSERT INTO radio_playlists (name, slug, description, cover_url, sort_order, active, status, auto_next_playlist, curator_name, curator_instagram, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           RETURNING *`,
          [
            name,
            slug,
            description,
            cover_url,
            0,
            active,
            status,
            auto_next_playlist,
            curator_name,
            curator_instagram,
          ],
        );
        rows = ins.rows;
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
    } else {
      const ins = await pool.query(
        `INSERT INTO radio_playlists (name, slug, description, cover_url, sort_order, active, status, auto_next_playlist, curator_name, curator_instagram, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING *`,
        [
          name,
          slug,
          description,
          cover_url,
          sortOrderVal,
          active,
          status,
          auto_next_playlist,
          curator_name,
          curator_instagram,
        ],
      );
      rows = ins.rows;
    }
    const created = rows[0];
    logRadioCoverImage('playlist_create', {
      playlist_id: created.id,
      image_url_received: cover_url,
      image_url_saved: created.cover_url || null,
      image_url_returned: created.cover_url || null,
    });
    return res.status(201).json(playlistRowOut(created));
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
    let cover_url = p.cover_url;
    const bodyHasCover =
      req.body &&
      (Object.prototype.hasOwnProperty.call(req.body, 'cover_url') ||
        Object.prototype.hasOwnProperty.call(req.body, 'playlist_cover_url'));
    if (bodyHasCover) {
      const raw = Object.prototype.hasOwnProperty.call(req.body, 'cover_url')
        ? req.body.cover_url
        : req.body.playlist_cover_url;
      cover_url = normalizePlaylistCoverUrlFromBody(raw);
    }
    const sort_order = req.body?.sort_order != null ? Number(req.body.sort_order) : p.sort_order;
    const active = req.body?.active != null ? Boolean(req.body.active) : p.active;
    const status = req.body?.status === 'draft' || req.body?.status === 'published' ? req.body.status : p.status;
    const auto_next_playlist =
      req.body?.auto_next_playlist != null ? Boolean(req.body.auto_next_playlist) : p.auto_next_playlist;
    const curator_name =
      req.body?.curator_name !== undefined ? normalizeCuratorName(req.body.curator_name) : normalizeCuratorName(p.curator_name);
    const curator_instagram =
      req.body?.curator_instagram !== undefined
        ? normalizeCuratorInstagram(req.body.curator_instagram)
        : normalizeCuratorInstagram(p.curator_instagram);

    const { rows } = await pool.query(
      `UPDATE radio_playlists SET
         name = $1, slug = $2, description = $3, cover_url = $4, sort_order = $5, active = $6, status = $7,
         auto_next_playlist = $8, curator_name = $9, curator_instagram = $10, updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [
        name,
        slug,
        description,
        cover_url,
        Number.isFinite(sort_order) ? sort_order : 0,
        active,
        status,
        auto_next_playlist,
        curator_name,
        curator_instagram,
        id,
      ],
    );
    const out = rows[0];
    return res.json(playlistRowOut(out));
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
    return res.json(rows.map((t) => trackRowApiOut(t)));
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
    return res.status(201).json(trackRowApiOut(row));
  } catch (e) {
    if (e && e.statusCode === 409 && e.code === 'RADIO_DUPLICATE_TRACK') {
      return res.status(409).json({ message: e.message, code: e.code });
    }
    return next(e);
  }
});

router.post('/radio/playlists/:id/tracks/youtube', express.json(), async (req, res, next) => {
  try {
    const playlistId = Number(req.params.id);
    if (!Number.isFinite(playlistId)) return res.status(400).json({ message: 'ID inválido.' });
    const rawUrl = req.body?.youtube_url != null ? String(req.body.youtube_url) : '';
    if (!rawUrl.trim()) {
      return res.status(400).json({ message: 'Indique youtube_url com o link do vídeo.' });
    }

    const p = await pool.query(`SELECT id FROM radio_playlists WHERE id = $1`, [playlistId]);
    if (!p.rows.length) return res.status(404).json({ message: 'Playlist não encontrada.' });

    const n = await countTracks(playlistId);
    if (n >= MAX_TRACKS_PER_PLAYLIST) {
      return res.status(400).json(playlistFullPayload(n));
    }

    const overrides = {
      title: req.body?.title != null ? String(req.body.title).trim() : undefined,
      artist: req.body?.artist != null ? String(req.body.artist).trim() : undefined,
    };
    const row = await createTrackFromYoutubeUrl(playlistId, rawUrl, overrides);
    return res.status(201).json(trackRowApiOut(row));
  } catch (e) {
    if (e && e.statusCode === 409 && e.code === 'RADIO_DUPLICATE_YOUTUBE') {
      return res.status(409).json({ message: e.message, code: e.code });
    }
    if (e && e.statusCode === 400 && e.code === 'RADIO_YOUTUBE_URL_INVALID') {
      return res.status(400).json({ message: e.message, code: e.code });
    }
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
        created.push(trackRowApiOut(row));
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
    const sort_order = req.body?.sort_order != null ? Number(req.body.sort_order) : t.sort_order;
    const active = req.body?.active != null ? Boolean(req.body.active) : t.active;

    if (!title) return res.status(400).json({ message: 'Título inválido.' });

    const { rows } = await pool.query(
      `UPDATE radio_tracks SET title = $1, artist = $2, sort_order = $3, active = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [title, artist, Number.isFinite(sort_order) ? sort_order : 0, active, trackId],
    );
    return res.json(trackRowApiOut(rows[0]));
  } catch (e) {
    return next(e);
  }
});

/**
 * Nova capa a partir do pool de imagens no B2 (sorteio; não repete a última chave por faixa em memória).
 * POST /api/radio/tracks/:trackId/cover/regenerate-model
 */
router.post('/radio/tracks/:trackId/cover/regenerate-model', express.json(), async (req, res, next) => {
  try {
    const trackId = Number(req.params.trackId);
    if (!Number.isFinite(trackId)) return res.status(400).json({ message: 'ID inválido.' });
    const curTr = await pool.query(
      `SELECT youtube_url FROM radio_tracks WHERE id = $1`,
      [trackId],
    );
    const yu = curTr.rows[0]?.youtube_url;
    if (yu != null && String(yu).trim() !== '') {
      return res.status(400).json({
        message: 'Faixas do YouTube usam a capa oficial do vídeo; não é possível gerar capa do pool.',
      });
    }
    if (!radioCoverPool.poolCoverEnabled()) {
      return res.status(503).json({ message: 'Pool de capas desligado (RADIO_COVER_IMAGE_POOL).' });
    }
    const result = await radioCoverPool.applyCoverForTrack(trackId);
    if (!result.ok) {
      if (result.reason === 'faixa_nao_encontrada') {
        return res.status(404).json({ message: 'Faixa não encontrada.' });
      }
      if (result.reason === 'storage_nao_b2') {
        return res.status(503).json({
          message: 'Pool de capas no bucket requer STORAGE_DRIVER=b2 e credenciais B2.',
        });
      }
      if (result.reason === 'pool_vazio') {
        return res.status(400).json({
          message:
            'Nenhuma imagem (.jpg/.jpeg/.png/.webp) no bucket com o prefixo configurado (RADIO_B2_COVER_POOL_PREFIX).',
        });
      }
      return res.status(500).json({ message: result.reason || 'Falha ao gerar capa.' });
    }
    const cover_url = result.row.cover_url != null ? String(result.row.cover_url) : '';
    return res.json({ trackId, cover_url });
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

/** Capa da playlist (imagem enviada pelo CRM) — independente das capas automáticas das faixas. */
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
    const rel = radioStorageKey(safe);
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
    const out = rows[0];
    logRadioCoverImage('playlist_cover_upload', {
      playlist_id: id,
      image_url_received: {
        type: 'multipart_file',
        field: 'cover',
        originalname: f.originalname || null,
        size: f.buffer?.length ?? null,
        mimetype: f.mimetype || null,
      },
      previous_cover_url: cur.rows[0].cover_url || null,
      image_url_saved: out.cover_url || null,
      image_url_returned: out.cover_url || null,
    });
    return res.json(playlistRowOut(out));
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
