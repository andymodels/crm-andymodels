/**
 * Composite e polaroid a partir de model.media (exclusivo).
 * — Sem images[], cover_image, caminhos /uploads/ ou fs.readFile local.
 * — Só type === 'image'; imagens via item.url (nunca thumb).
 * — Descarga sempre HTTP(S) com redirects (ex.: Backblaze B2).
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const sharp = require('sharp');

const router = express.Router();

const WEBSITE_ORIGIN = String(process.env.WEBSITE_ORIGIN || 'https://www.andymodels.com').replace(/\/$/, '');

/** URL absoluta (B2, CDN, path relativo ao site). */
function toAbsoluteUrl(u) {
  const s = u == null ? '' : String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${WEBSITE_ORIGIN}${s}`;
  return `${WEBSITE_ORIGIN}/${s}`;
}

/**
 * Itens type === 'image' com url, pela ordem de model.media.
 * @returns {{ url: string, mediaIndex: number }[]}
 */
function listImageEntriesInOrder(media) {
  if (!Array.isArray(media)) return [];
  const out = [];
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item || typeof item !== 'object' || item.type !== 'image') continue;
    const url = item.url != null ? String(item.url).trim() : '';
    if (!url) continue;
    out.push({ url, mediaIndex: i });
  }
  return out;
}

/**
 * Subconjunto: type === 'image' e polaroid === true (estrito), ordem do array.
 */
function listPolaroidImageEntriesInOrder(media) {
  if (!Array.isArray(media)) return [];
  const out = [];
  for (let i = 0; i < media.length; i++) {
    const item = media[i];
    if (!item || typeof item !== 'object' || item.type !== 'image') continue;
    if (item.polaroid !== true) continue;
    const url = item.url != null ? String(item.url).trim() : '';
    if (!url) continue;
    out.push({ url, mediaIndex: i });
  }
  return out;
}

/** ?indices=0,2,3 — posições entre as imagens (0 = primeira imagem, …). null/absent = todas. */
function parseImagePositionQuery(q) {
  if (q == null || String(q).trim() === '') return null;
  const parts = String(q)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const nums = parts.map((p) => parseInt(p, 10)).filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length ? new Set(nums) : null;
}

function filterByImagePositions(entries, positionSet) {
  if (!positionSet) return entries;
  return entries.filter((_, pos) => positionSet.has(pos));
}

function fetchUrlBuffer(urlString, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlString);
    } catch {
      reject(new Error('URL invalida'));
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      reject(new Error('So HTTP/HTTPS'));
      return;
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      urlString,
      {
        method: 'GET',
        headers: {
          Accept: 'image/*,*/*',
          'User-Agent': 'AndyModels-CRM-composite/1.0',
        },
        timeout: 60_000,
      },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirectsLeft > 0) {
          const nextUrl = new URL(loc, urlString).href;
          res.resume();
          fetchUrlBuffer(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Timeout ao descarregar imagem'));
    });
    req.end();
  });
}

const TILE_W = 320;
const TILE_H = Math.round((TILE_W * 4) / 3);
const GAP = 16;
const POLAROID_PAD = 20;
const POLAROID_BOTTOM_EXTRA = 28;

async function normalizeTile(buf, polaroidFrame) {
  const innerW = polaroidFrame ? TILE_W - POLAROID_PAD * 2 : TILE_W;
  const innerH = polaroidFrame ? TILE_H - POLAROID_PAD * 2 - POLAROID_BOTTOM_EXTRA : TILE_H;

  const resized = await sharp(buf)
    .rotate()
    .resize(innerW, innerH, { fit: 'cover', position: 'centre' })
    .toBuffer();

  if (!polaroidFrame) {
    return { buf: resized, w: TILE_W, h: TILE_H };
  }

  const framed = await sharp({
    create: {
      width: TILE_W,
      height: TILE_H,
      channels: 3,
      background: { r: 252, g: 252, b: 250 },
    },
  })
    .composite([{ input: resized, left: POLAROID_PAD, top: POLAROID_PAD }])
    .png()
    .toBuffer();

  return { buf: framed, w: TILE_W, h: TILE_H };
}

async function buildGridPng(entries, polaroidFrame) {
  if (entries.length === 0) {
    throw new Error(polaroidFrame ? 'Nenhum item polaroid em model.media.' : 'Nenhuma imagem em model.media (type image com url).');
  }

  const tiles = [];
  for (const { url } of entries) {
    const abs = toAbsoluteUrl(url);
    if (!/^https?:\/\//i.test(abs)) {
      throw new Error(`URL invalida apos resolver origem: ${url}`);
    }
    const raw = await fetchUrlBuffer(abs);
    const tile = await normalizeTile(raw, polaroidFrame);
    tiles.push(tile);
  }

  const n = tiles.length;
  const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);

  const cellW = TILE_W;
  const cellH = TILE_H;
  const canvasW = cols * cellW + (cols - 1) * GAP;
  const canvasH = rows * cellH + (rows - 1) * GAP;

  const composites = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const left = col * (cellW + GAP);
    const top = row * (cellH + GAP);
    composites.push({ input: tiles[i].buf, left, top });
  }

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: { r: 245, g: 245, b: 248 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

function getModelMedia(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return body.model && typeof body.model === 'object' && Array.isArray(body.model.media) ? body.model.media : null;
}

/**
 * Composite: todas as imagens (type image) ou subconjunto ?indices=0,1 (posições entre imagens).
 * Tiles sem moldura polaroid.
 */
router.post('/composite/render', async (req, res, next) => {
  try {
    const media = getModelMedia(req);
    if (!media) {
      return res.status(400).json({
        message: 'Envie { model: { media: [...] } } com itens type "image" e url.',
      });
    }
    let entries = listImageEntriesInOrder(media);
    const positions = parseImagePositionQuery(req.query.indices);
    entries = filterByImagePositions(entries, positions);
    const png = await buildGridPng(entries, false);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(png);
  } catch (e) {
    return next(e);
  }
});

/**
 * Polaroid: só itens type image com polaroid === true; todas com moldura polaroid.
 * Opcional ?indices= relativo a essa lista (primeira polaroid = 0, …).
 */
router.post('/composite/polaroid', async (req, res, next) => {
  try {
    const media = getModelMedia(req);
    if (!media) {
      return res.status(400).json({
        message: 'Envie { model: { media: [...] } } com itens type "image", polaroid true e url.',
      });
    }
    let entries = listPolaroidImageEntriesInOrder(media);
    const positions = parseImagePositionQuery(req.query.indices);
    entries = filterByImagePositions(entries, positions);
    const png = await buildGridPng(entries, true);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(png);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
module.exports.listImageEntriesInOrder = listImageEntriesInOrder;
module.exports.listPolaroidImageEntriesInOrder = listPolaroidImageEntriesInOrder;
module.exports.toAbsoluteUrl = toAbsoluteUrl;
module.exports.buildGridPng = buildGridPng;
module.exports.parseImagePositionQuery = parseImagePositionQuery;
module.exports.filterByImagePositions = filterByImagePositions;
