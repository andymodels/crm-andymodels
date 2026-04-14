/**
 * Capa automática Andy Radio: imagens no bucket B2 (ListObjectsV2 + sorteio).
 * Sem ficheiro JSON, sem estado em disco — memória: cache da lista (TTL) e última chave por faixa.
 * Capa final: só imagem (sem texto sobreposta).
 */

const crypto = require('crypto');
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

const COVER_PIXEL = 1000;

/** Processamento de ficheiro guardado (quadrado 1000×1000); o enquadramento 4:5 é só no frontend. */
async function saveCoverFromImageBuffer(imageBuffer) {
  const jpegBuf = await sharp(imageBuffer)
    .rotate()
    .resize(COVER_PIXEL, COVER_PIXEL, { fit: 'cover', position: 'top' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

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
    const publicUrl = await saveCoverFromImageBuffer(buf);

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
