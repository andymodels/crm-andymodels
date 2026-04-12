/**
 * Capas Andy Radio a partir do elenco: foto do cadastro (feminino), P&B, nome em laranja.
 */

const crypto = require('crypto');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('./storage');

const COVER_W = 600;
const COVER_H = 800;
const ORANGE = '#ea580c';

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fontSizeForName(n) {
  const len = String(n || '').length;
  if (len <= 18) return 32;
  if (len <= 28) return 26;
  if (len <= 40) return 22;
  return 18;
}

function truncateName(n, max = 42) {
  const t = String(n || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildOverlaySvg(displayName) {
  const fs = fontSizeForName(displayName);
  const name = escapeXml(truncateName(displayName, 44));
  return Buffer.from(
    `<svg width="${COVER_W}" height="${COVER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="andyRadioFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(0,0,0)" stop-opacity="0"/>
      <stop offset="50%" stop-color="rgb(0,0,0)" stop-opacity="0"/>
      <stop offset="100%" stop-color="rgb(0,0,0)" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="${COVER_W}" height="${COVER_H}" fill="url(#andyRadioFade)"/>
  <text x="${COVER_W / 2}" y="${COVER_H - 42}" text-anchor="middle"
    font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
    font-size="${fs}" font-weight="700" fill="${ORANGE}">${name}</text>
</svg>`,
    'utf8',
  );
}

async function fetchImageBuffer(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('URL da foto inválida.');
  if (typeof fetch !== 'function') throw new Error('fetch não disponível (Node 18+ necessário).');
  const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
  if (!r.ok) throw new Error(`Foto HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Uma linha aleatória: modelo feminino ativo com foto URL pública.
 */
async function pickRandomFemaleModel(client) {
  const q = `
    SELECT id, nome, foto_perfil_base64 AS foto_url
    FROM modelos
    WHERE ativo = TRUE
      AND LOWER(TRIM(sexo)) = 'feminino'
      AND foto_perfil_base64 ~ '^https?://'
    ORDER BY RANDOM()
    LIMIT 1
  `;
  const { rows } = client ? await client.query(q) : await pool.query(q);
  return rows[0] || null;
}

/**
 * Modelo feminino com **menos capas** já usadas nesta playlist (equilibra entre todas).
 * Assim 15 faixas com 5 modelos → ~3 cada; evita a mesma cara em todas quando há várias no cadastro.
 * Se só existir 1 modelo elegível, só ela pode aparecer (limite do elenco no CRM).
 */
async function pickFemaleModelLeastUsedInPlaylist(playlistId, client) {
  if (playlistId == null || !Number.isFinite(Number(playlistId))) {
    return pickRandomFemaleModel(client);
  }
  const pid = Number(playlistId);
  const q = `
    SELECT m.id, m.nome, m.foto_perfil_base64 AS foto_url,
      COALESCE((
        SELECT COUNT(*)::int FROM radio_tracks t
        WHERE t.playlist_id = $1 AND t.cover_modelo_id = m.id
      ), 0) AS uso_nesta_playlist
    FROM modelos m
    WHERE m.ativo = TRUE
      AND LOWER(TRIM(m.sexo)) = 'feminino'
      AND m.foto_perfil_base64 ~ '^https?://'
    ORDER BY uso_nesta_playlist ASC, RANDOM()
    LIMIT 1
  `;
  const { rows } = client ? await client.query(q, [pid]) : await pool.query(q, [pid]);
  return rows[0] || null;
}

async function pickFemaleModelById(client, modeloId) {
  const q = `
    SELECT id, nome, foto_perfil_base64 AS foto_url
    FROM modelos
    WHERE id = $1
      AND ativo = TRUE
      AND LOWER(TRIM(sexo)) = 'feminino'
      AND foto_perfil_base64 ~ '^https?://'
  `;
  const { rows } = client ? await client.query(q, [modeloId]) : await pool.query(q, [modeloId]);
  return rows[0] || null;
}

/**
 * Gera JPEG de capa (P&B + nome laranja em destaque).
 */
async function renderCoverJpeg(imageBuffer, nomeDestaque) {
  const base = await sharp(imageBuffer)
    .rotate()
    .resize(COVER_W, COVER_H, { fit: 'cover', position: 'centre' })
    .grayscale()
    .toBuffer();

  const overlay = buildOverlaySvg(nomeDestaque);
  return sharp(base).composite([{ input: overlay, left: 0, top: 0 }]).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

/**
 * Grava ficheiro em radio/covers e devolve URL pública.
 */
async function saveCoverJpeg(buffer) {
  const rel = `radio/covers/andy-${crypto.randomUUID()}.jpg`;
  await storage.saveFile({
    buffer,
    relativePath: rel,
    contentType: 'image/jpeg',
  });
  return { relativePath: rel, publicUrl: storage.getPublicUrl(rel) };
}

function autoCoverFromModelEnabled() {
  const v = String(process.env.RADIO_COVER_AUTO_MODEL || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Gera capa P&B + nome laranja; devolve URL pública ou falha.
 */
async function generateFemaleModelCoverUrl(options = {}) {
  const modeloId = options.modelo_id != null ? Number(options.modelo_id) : null;
  const playlistId = options.playlist_id != null ? Number(options.playlist_id) : null;
  let m;
  if (Number.isFinite(modeloId)) {
    m = await pickFemaleModelById(null, modeloId);
    if (!m) return { ok: false, reason: 'modelo_nao_encontrado_ou_nao_feminino' };
  } else {
    m = await pickFemaleModelLeastUsedInPlaylist(playlistId, null);
    if (!m) return { ok: false, reason: 'sem_modelos_femininos_com_foto' };
  }
  try {
    const img = await fetchImageBuffer(m.foto_url);
    /** Nome completo do cadastro (modelos.nome), igual à referência do site — não vem do ficheiro MP3. */
    const jpeg = await renderCoverJpeg(img, m.nome);
    const { publicUrl } = await saveCoverJpeg(jpeg);
    return { ok: true, publicUrl, modelo_id: m.id, modelo_nome: m.nome };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

module.exports = {
  pickRandomFemaleModel,
  pickFemaleModelLeastUsedInPlaylist,
  pickFemaleModelById,
  fetchImageBuffer,
  renderCoverJpeg,
  saveCoverJpeg,
  autoCoverFromModelEnabled,
  generateFemaleModelCoverUrl,
  ORANGE,
};
