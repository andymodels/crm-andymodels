/**
 * Capas Andy Radio a partir do elenco: foto do cadastro (feminino), P&B, primeiro nome em laranja (rodapé).
 * Regra de upload de faixas (radio.js): capa embutida no MP3 primeiro; senão, modelo aleatória.
 */

const crypto = require('crypto');
const sharp = require('sharp');
const { pool } = require('../config/db');
const storage = require('./storage');
const { radioStorageKey } = require('./radioStoragePaths');

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

/** Primeiro token do nome, em maiúsculas (para overlay). */
function firstNameUpper(nome) {
  const s = String(nome || '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0].toUpperCase();
}

function fontSizeForFirstName(len) {
  if (len <= 10) return 40;
  if (len <= 16) return 32;
  if (len <= 22) return 26;
  return 22;
}

function truncateName(n, max = 36) {
  const t = String(n || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Primeiro nome em destaque na parte inferior (faixa escura), laranja + contorno — SVG compatível com librsvg.
 */
function buildOverlaySvg(displayName) {
  const raw = firstNameUpper(displayName);
  const name = escapeXml(truncateName(raw, 28));
  const fs = Math.min(48, Math.max(24, fontSizeForFirstName(raw.length)));
  const padX = 16;
  const barH = Math.min(200, fs + 52);
  const barY = COVER_H - barH;
  const cx = COVER_W / 2;
  const textY = COVER_H - (barH / 2) + fs * 0.32;
  return Buffer.from(
    `<svg width="${COVER_W}" height="${COVER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="35%" stop-color="rgba(0,0,0,0.55)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.78)"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${barY}" width="${COVER_W}" height="${barH}" fill="url(#bar)"/>
  <text x="${cx}" y="${textY}" text-anchor="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-size="${fs}" font-weight="700"
    fill="${ORANGE}"
    stroke="#0f172a"
    stroke-width="1.4"
    paint-order="stroke fill">${name}</text>
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

/** Elenco feminino no cadastro (várias grafias) + foto URL pública (campo pode ter espaços). */
const SQL_WHERE_FEMALE_URL = `
  ativo = TRUE
  AND (
    LOWER(TRIM(COALESCE(sexo, ''))) IN ('feminino', 'female', 'f', 'mulher', 'femenino')
    OR LOWER(TRIM(COALESCE(sexo, ''))) LIKE 'fem%'
  )
  AND TRIM(foto_perfil_base64) ~ '^https?://'
`;

async function pickRandomFemaleModel(client) {
  const q = `
    SELECT id, nome, TRIM(foto_perfil_base64) AS foto_url
    FROM modelos
    WHERE ${SQL_WHERE_FEMALE_URL}
    ORDER BY RANDOM()
    LIMIT 1
  `;
  const { rows } = client ? await client.query(q) : await pool.query(q);
  return rows[0] || null;
}

async function pickFemaleModelById(client, modeloId) {
  const q = `
    SELECT id, nome, TRIM(foto_perfil_base64) AS foto_url
    FROM modelos
    WHERE id = $1
      AND ativo = TRUE
      AND (
        LOWER(TRIM(COALESCE(sexo, ''))) IN ('feminino', 'female', 'f', 'mulher', 'femenino')
        OR LOWER(TRIM(COALESCE(sexo, ''))) LIKE 'fem%'
      )
      AND TRIM(foto_perfil_base64) ~ '^https?://'
  `;
  const { rows } = client ? await client.query(q, [modeloId]) : await pool.query(q, [modeloId]);
  return rows[0] || null;
}

/**
 * Gera JPEG de capa (P&B + primeiro nome em laranja no rodapé).
 */
async function renderCoverJpeg(imageBuffer, nomeDestaque) {
  const base = await sharp(imageBuffer)
    .rotate()
    .resize(COVER_W, COVER_H, { fit: 'cover', position: 'centre' })
    .grayscale()
    .toBuffer();

  const overlaySvg = buildOverlaySvg(nomeDestaque);
  const overlayPng = await sharp(overlaySvg, { density: 144 })
    .resize(COVER_W, COVER_H)
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: overlayPng, left: 0, top: 0, blend: 'over' }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/**
 * Grava ficheiro em radio/covers e devolve URL pública.
 */
async function saveCoverJpeg(buffer) {
  const rel = radioStorageKey('.jpg');
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
 * Gera capa P&B + nome (primeiro token em maiúsculas no rodapé); devolve URL pública ou falha.
 * Sem `modelo_id`: escolhe uma modelo feminina aleatória com foto URL.
 */
async function generateFemaleModelCoverUrl(options = {}) {
  const modeloId = options.modelo_id != null ? Number(options.modelo_id) : null;
  let m;
  if (Number.isFinite(modeloId)) {
    m = await pickFemaleModelById(null, modeloId);
    if (!m) return { ok: false, reason: 'modelo_nao_encontrado_ou_nao_feminino' };
  } else {
    m = await pickRandomFemaleModel(null);
    if (!m) return { ok: false, reason: 'sem_modelos_femininos_com_foto' };
  }
  try {
    const img = await fetchImageBuffer(m.foto_url);
    const jpeg = await renderCoverJpeg(img, m.nome);
    const { publicUrl } = await saveCoverJpeg(jpeg);
    return { ok: true, publicUrl, modelo_id: m.id, modelo_nome: m.nome };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

module.exports = {
  pickRandomFemaleModel,
  pickFemaleModelById,
  fetchImageBuffer,
  renderCoverJpeg,
  saveCoverJpeg,
  autoCoverFromModelEnabled,
  generateFemaleModelCoverUrl,
  firstNameUpper,
  ORANGE,
};
