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

/**
 * Nome da modelo em destaque no centro (estilo “título”), laranja + contorno — SVG compatível com librsvg.
 */
function buildOverlaySvg(displayName) {
  const raw = String(displayName || '').trim();
  const name = escapeXml(truncateName(raw, 34));
  const fs = Math.min(48, Math.max(24, fontSizeForName(raw) + 6));
  const cx = COVER_W / 2;
  const cy = COVER_H / 2;
  const padX = 20;
  const boxW = COVER_W - padX * 2;
  const boxH = Math.min(160, fs + 48);
  const boxY = cy - boxH / 2;
  const textY = cy + fs * 0.28;
  return Buffer.from(
    `<svg width="${COVER_W}" height="${COVER_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${padX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="14" fill="rgba(0,0,0,0.58)"/>
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

/**
 * Menos usos na playlist + não repetir a mesma modelo da **última faixa** quando há alternativa.
 * Lista todas as elegíveis em JS (evita empates RANDOM() sempre à mesma).
 */
/**
 * @param excludeModeloId — modelo a evitar em sequência (faixa anterior no lote).
 * @param useExcludeOnly — se true, `excludeModeloId` veio do pedido (lote); não ler «última faixa» do BD (evita confundir com a faixa 36).
 */
async function pickFemaleModelLeastUsedInPlaylist(playlistId, client, excludeModeloId, useExcludeOnly) {
  if (playlistId == null || !Number.isFinite(Number(playlistId))) {
    return pickRandomFemaleModel(client);
  }
  const pid = Number(playlistId);
  const q = `
    SELECT m.id, m.nome, TRIM(m.foto_perfil_base64) AS foto_url
    FROM modelos m
    WHERE m.ativo = TRUE
      AND (
        LOWER(TRIM(COALESCE(m.sexo, ''))) IN ('feminino', 'female', 'f', 'mulher', 'femenino')
        OR LOWER(TRIM(COALESCE(m.sexo, ''))) LIKE 'fem%'
      )
      AND TRIM(m.foto_perfil_base64) ~ '^https?://'
    ORDER BY m.id ASC
  `;
  const { rows: elegiveis } = await client ? await client.query(q) : await pool.query(q);
  if (!elegiveis.length) return null;
  if (elegiveis.length === 1) return elegiveis[0];

  const usageSql = `SELECT cover_modelo_id, COUNT(*)::int AS c
         FROM radio_tracks
         WHERE playlist_id = $1 AND cover_modelo_id IS NOT NULL
         GROUP BY cover_modelo_id`;
  const { rows: usageRows } = await client ? await client.query(usageSql, [pid]) : await pool.query(usageSql, [pid]);
  const uso = new Map(usageRows.map((r) => [Number(r.cover_modelo_id), r.c]));

  let ultimaFaixaModeloId = null;
  if (useExcludeOnly) {
    ultimaFaixaModeloId =
      excludeModeloId != null && Number.isFinite(Number(excludeModeloId)) ? Number(excludeModeloId) : null;
  } else {
    const lastSql = `SELECT cover_modelo_id FROM radio_tracks
         WHERE playlist_id = $1
         ORDER BY sort_order DESC, id DESC
         LIMIT 1`;
    const { rows: lastRows } = await client ? await client.query(lastSql, [pid]) : await pool.query(lastSql, [pid]);
    ultimaFaixaModeloId =
      lastRows[0]?.cover_modelo_id != null ? Number(lastRows[0].cover_modelo_id) : null;
  }

  let minUso = Infinity;
  for (const m of elegiveis) {
    const c = uso.get(m.id) || 0;
    if (c < minUso) minUso = c;
  }
  let candidatos = elegiveis.filter((m) => (uso.get(m.id) || 0) === minUso);
  if (candidatos.length > 1 && ultimaFaixaModeloId != null) {
    const semRepetirSeguida = candidatos.filter((m) => m.id !== ultimaFaixaModeloId);
    if (semRepetirSeguida.length > 0) candidatos = semRepetirSeguida;
  }
  return candidatos[Math.floor(Math.random() * candidatos.length)];
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
 * Gera JPEG de capa (P&B + nome laranja em destaque).
 */
async function renderCoverJpeg(imageBuffer, nomeDestaque) {
  const base = await sharp(imageBuffer)
    .rotate()
    .resize(COVER_W, COVER_H, { fit: 'cover', position: 'centre' })
    .grayscale()
    .toBuffer();

  const overlaySvg = buildOverlaySvg(nomeDestaque);
  /** Rasterizar SVG → PNG (density) para o texto laranja aparecer de forma fiável com librsvg. */
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
  const useExcludeOnly = Object.prototype.hasOwnProperty.call(options, 'exclude_modelo_id');
  const excludeModeloId =
    useExcludeOnly && options.exclude_modelo_id != null && Number.isFinite(Number(options.exclude_modelo_id))
      ? Number(options.exclude_modelo_id)
      : useExcludeOnly
        ? null
        : undefined;
  let m;
  if (Number.isFinite(modeloId)) {
    m = await pickFemaleModelById(null, modeloId);
    if (!m) return { ok: false, reason: 'modelo_nao_encontrado_ou_nao_feminino' };
  } else {
    m = await pickFemaleModelLeastUsedInPlaylist(
      playlistId,
      null,
      excludeModeloId,
      useExcludeOnly,
    );
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
