/**
 * Proxy de teste: lista de modelos do site institucional (API pública).
 * GET /api/website/models
 */

const https = require('https');
const express = require('express');

const router = express.Router();

const WEBSITE_ORIGIN = 'https://www.andymodels.com';
const WEBSITE_MODELS_LIST_URL = `${WEBSITE_ORIGIN}/api/models`;

function fetchWebsiteJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { Accept: 'application/json', 'User-Agent': 'AndyModels-CRM/1.0' } },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, raw });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(25_000, () => {
      req.destroy(new Error('Timeout ao contactar o website.'));
    });
  });
}

router.get('/website/models', async (_req, res, next) => {
  try {
    const { statusCode, raw } = await fetchWebsiteJson(WEBSITE_MODELS_LIST_URL);
    if (statusCode < 200 || statusCode >= 300) {
      return res.status(statusCode >= 400 ? statusCode : 502).json({
        message: `Website retornou HTTP ${statusCode}.`,
      });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ message: 'Resposta do website não é JSON válido.' });
    }
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

/** Detalhe público por slug: GET https://www.andymodels.com/api/models/:slug */
router.get('/website/models/:slug', async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ message: 'Slug invalido.' });
    }
    const url = `${WEBSITE_ORIGIN}/api/models/${encodeURIComponent(slug)}`;
    const { statusCode, raw } = await fetchWebsiteJson(url);
    if (statusCode === 404) {
      return res.status(404).json({ message: 'Modelo nao encontrado no website.' });
    }
    if (statusCode < 200 || statusCode >= 300) {
      return res.status(statusCode >= 400 ? statusCode : 502).json({
        message: `Website retornou HTTP ${statusCode}.`,
      });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ message: 'Resposta do website não é JSON válido.' });
    }
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
