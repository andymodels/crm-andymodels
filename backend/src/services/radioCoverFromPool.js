/**
 * Capa automática Andy Radio a partir de imagesPool.json: sorteio simples de URL.
 * Sem tabela modelos, sem outras tabelas — só ficheiros JSON + estado da última URL por faixa.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('./storage');
const { radioStorageKey } = require('./radioStoragePaths');

const POOL_PATH = process.env.RADIO_IMAGE_POOL_PATH
  ? path.resolve(process.env.RADIO_IMAGE_POOL_PATH)
  : path.join(__dirname, '../data/imagesPool.json');
const STATE_PATH = path.join(__dirname, '../data/radioCoverPoolLast.json');

function poolCoverEnabled() {
  const v = String(process.env.RADIO_COVER_IMAGE_POOL || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function normalizePoolUrls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u));
}

async function loadImagePool() {
  try {
    const text = await fs.readFile(POOL_PATH, 'utf8');
    const data = JSON.parse(text);
    return normalizePoolUrls(data);
  } catch (e) {
    console.warn('[radio/pool] imagesPool.json:', e?.message || e);
    return [];
  }
}

async function readState() {
  try {
    const text = await fs.readFile(STATE_PATH, 'utf8');
    const o = JSON.parse(text);
    if (o && typeof o.byTrackId === 'object' && o.byTrackId !== null) return o;
    return { byTrackId: {} };
  } catch {
    return { byTrackId: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Escolhe URL aleatória; se `excludeUrl` existir no pool com mais de um item, evita repetir.
 */
function pickRandomUrl(urls, excludeUrl) {
  if (!urls.length) return null;
  const ex = excludeUrl != null ? String(excludeUrl).trim() : '';
  let candidates = ex ? urls.filter((u) => String(u).trim() !== ex) : urls.slice();
  if (candidates.length === 0) candidates = urls.slice();
  const i = crypto.randomInt(0, candidates.length);
  return candidates[i];
}

async function fetchImageBuffer(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('URL inválida.');
  if (typeof fetch !== 'function') throw new Error('fetch não disponível (Node 18+).');
  const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
  if (!r.ok) throw new Error(`Imagem HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Do path do ficheiro na URL: "ana_silva_123.jpg" → primeiro token antes de _/- → "ANA".
 */
function firstNameFromPoolUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw.split('?')[0];
  }
  const base = path.basename(pathname);
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
async function saveCoverFromImageBuffer(imageBuffer, poolImageUrl) {
  const basePipeline = sharp(imageBuffer)
    .rotate()
    .resize(COVER_PIXEL, COVER_PIXEL, { fit: 'cover', position: 'centre' });
  const { data: resizedBuf, info } = await basePipeline.toBuffer({ resolveWithObject: true });
  const w = info.width || COVER_PIXEL;
  const h = info.height || COVER_PIXEL;

  const label = poolImageUrl != null ? firstNameFromPoolUrl(poolImageUrl) : '';
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
 * Descarrega uma imagem do pool, grava em storage, atualiza a faixa e o estado «última URL».
 */
async function applyCoverForTrack(trackId) {
  const id = Number(trackId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'track_id_invalido' };

  const urls = await loadImagePool();
  if (!urls.length) return { ok: false, reason: 'pool_vazio' };

  const state = await readState();
  const tid = String(id);
  const lastUrl = state.byTrackId[tid] != null ? String(state.byTrackId[tid]).trim() : '';
  const chosen = pickRandomUrl(urls, lastUrl || null);
  if (!chosen) return { ok: false, reason: 'sorteio_invalido' };

  try {
    const buf = await fetchImageBuffer(chosen);
    const publicUrl = await saveCoverFromImageBuffer(buf, chosen);

    state.byTrackId[tid] = chosen;
    await writeState(state);

    const { rows } = await pool.query(
      `UPDATE radio_tracks SET cover_url = $1, cover_modelo_id = NULL, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [publicUrl, id],
    );
    if (!rows.length) return { ok: false, reason: 'faixa_nao_encontrada' };
    return { ok: true, row: rows[0], pool_url: chosen };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

module.exports = {
  poolCoverEnabled,
  loadImagePool,
  applyCoverForTrack,
  POOL_PATH,
};
