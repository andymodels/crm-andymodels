/**
 * Capa automática Andy Radio: imagens no bucket B2 (ListObjectsV2 + sorteio).
 * Sem ficheiro JSON, sem estado em disco — memória: cache da lista (TTL) e última chave por faixa.
 */

const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('./storage');
const { radioStorageKey } = require('./radioStoragePaths');

const DEFAULT_CACHE_MS = 5 * 60 * 1000;

/** Última chave B2 usada por faixa (evitar repetir no sorteio seguinte). */
const lastPoolKeyByTrackId = new Map();

let _keysCache = null;
let _keysCacheAt = 0;

function poolCoverEnabled() {
  const v = String(process.env.RADIO_COVER_IMAGE_POOL || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function poolListCacheTtlMs() {
  const raw = String(process.env.RADIO_B2_COVER_POOL_CACHE_MS || '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_CACHE_MS;
}

async function getCachedPoolKeys() {
  const ttl = poolListCacheTtlMs();
  const now = Date.now();
  if (ttl > 0 && _keysCache && now - _keysCacheAt < ttl) {
    return _keysCache;
  }
  const keys = await storage.listB2RadioCoverPoolKeys();
  _keysCache = keys;
  _keysCacheAt = now;
  return keys;
}

/**
 * Escolhe chave aleatória; se `excludeKey` existir e houver mais do que um candidato, evita repetir.
 */
function pickRandomKey(keys, excludeKey) {
  if (!keys.length) return null;
  const ex = excludeKey != null ? String(excludeKey).trim() : '';
  let candidates = ex ? keys.filter((k) => String(k).trim() !== ex) : keys.slice();
  if (candidates.length === 0) candidates = keys.slice();
  const i = crypto.randomInt(0, candidates.length);
  return candidates[i];
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Do nome do ficheiro na chave: "ana_silva_123.jpg" → primeiro token → "ANA". */
function firstNameFromPoolKey(key) {
  const base = path.basename(String(key || '').replace(/\\/g, '/'));
  const noExt = base.replace(/\.[^.]+$/i, '');
  if (!noExt) return '';
  const token = noExt.split(/[_\s-]+/)[0] || noExt;
  const t = String(token).trim();
  if (!t) return '';
  return t.toUpperCase().slice(0, 32);
}

const COVER_PIXEL = 1000;

function buildFooterNameSvg(width, height, displayName) {
  const name = escapeXml(displayName);
  const fs = Math.min(56, Math.max(28, Math.floor(width / 9)));
  const pad = Math.max(28, Math.floor(fs * 0.55));
  const cx = width / 2;
  const textY = height - pad;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${cx}" y="${textY}" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fs}" font-weight="700"
    fill="#ffffff"
    stroke="#0f172a"
    stroke-width="1.6"
    paint-order="stroke fill">${name}</text>
</svg>`,
    'utf8',
  );
}

/** Capa quadrada 1:1 (1000×1000), preenchida com crop central; opcional nome no rodapé. */
async function saveCoverFromImageBuffer(imageBuffer, poolSourceKey) {
  const basePipeline = sharp(imageBuffer)
    .rotate()
    .resize(COVER_PIXEL, COVER_PIXEL, { fit: 'cover', position: 'centre' });
  const { data: resizedBuf, info } = await basePipeline.toBuffer({ resolveWithObject: true });
  const w = info.width || COVER_PIXEL;
  const h = info.height || COVER_PIXEL;

  const label = poolSourceKey != null ? firstNameFromPoolKey(poolSourceKey) : '';
  let jpegBuf;
  if (label) {
    const overlaySvg = buildFooterNameSvg(w, h, label);
    const overlayPng = await sharp(overlaySvg, { density: 144 }).resize(w, h).png().toBuffer();
    jpegBuf = await sharp(resizedBuf)
      .composite([{ input: overlayPng, left: 0, top: 0, blend: 'over' }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } else {
    jpegBuf = await sharp(resizedBuf).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }

  const rel = radioStorageKey('.jpg');
  await storage.saveFile({
    buffer: jpegBuf,
    relativePath: rel,
    contentType: 'image/jpeg',
  });
  return storage.getPublicUrl(rel);
}

/**
 * Descarrega uma imagem do bucket (chave B2), grava capa processada, atualiza a faixa e a memória «última chave».
 */
async function applyCoverForTrack(trackId) {
  const id = Number(trackId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'track_id_invalido' };

  if (storage.driver() !== 'b2') {
    return { ok: false, reason: 'storage_nao_b2' };
  }

  let keys;
  try {
    keys = await getCachedPoolKeys();
  } catch (e) {
    console.warn('[radio/pool] ListObjects B2:', e?.message || e);
    return { ok: false, reason: String(e?.message || e) };
  }

  if (!keys.length) return { ok: false, reason: 'pool_vazio' };

  const tid = String(id);
  const lastKey = lastPoolKeyByTrackId.get(tid) != null ? String(lastPoolKeyByTrackId.get(tid)).trim() : '';
  const chosen = pickRandomKey(keys, lastKey || null);
  if (!chosen) return { ok: false, reason: 'sorteio_invalido' };

  try {
    const buf = await storage.readFileBuffer(chosen);
    const publicUrl = await saveCoverFromImageBuffer(buf, chosen);

    lastPoolKeyByTrackId.set(tid, chosen);

    const { rows } = await pool.query(
      `UPDATE radio_tracks SET cover_url = $1, cover_modelo_id = NULL, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [publicUrl, id],
    );
    if (!rows.length) return { ok: false, reason: 'faixa_nao_encontrada' };
    return { ok: true, row: rows[0], pool_key: chosen };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

module.exports = {
  poolCoverEnabled,
  applyCoverForTrack,
};
