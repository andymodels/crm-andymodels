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

/** PATCH JSON para o website (ex.: atualizar media). Repassa Authorization do pedido ao CRM se existir; senão usa env. */
function patchWebsiteJson(urlString, bodyObj, req) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'User-Agent': 'AndyModels-CRM/1.0',
      },
    };
    const incomingAuth = req && typeof req.get === 'function' ? String(req.get('authorization') || '').trim() : '';
    if (incomingAuth) {
      options.headers.Authorization = incomingAuth;
    } else {
      const token = String(process.env.WEBSITE_ADMIN_API_KEY || process.env.WEBSITE_ADMIN_TOKEN || '').trim();
      if (token) {
        options.headers.Authorization = `Bearer ${token}`;
      }
    }
    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(25_000, () => {
      req.destroy(new Error('Timeout ao contactar o website.'));
    });
    req.write(body);
    req.end();
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

/**
 * Atualiza apenas media do modelo no site: PATCH https://www.andymodels.com/api/admin/models/:id/media
 * Body: { media: [...] } — repassado sem outros campos.
 */
router.patch('/admin/models/:id/media', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    if (!req.body || typeof req.body !== 'object' || !('media' in req.body)) {
      return res.status(400).json({ message: 'Body deve incluir o campo media.' });
    }
    const url = `${WEBSITE_ORIGIN}/api/admin/models/${encodeURIComponent(id)}/media`;
    const { statusCode, raw } = await patchWebsiteJson(url, { media: req.body.media }, req);
    if (statusCode === 401) {
      const hasEnvToken = String(process.env.WEBSITE_ADMIN_API_KEY || process.env.WEBSITE_ADMIN_TOKEN || '').trim();
      const hasIncoming = String(req.get('authorization') || '').trim();
      return res.status(401).json({
        message: hasIncoming
          ? 'Website recusou o token enviado (401). Verifique credenciais no servidor do site.'
          : hasEnvToken
            ? 'Website recusou WEBSITE_ADMIN_API_KEY / WEBSITE_ADMIN_TOKEN (401). Confirme o valor no painel do site.'
            : 'Website exige autenticacao (401). Defina WEBSITE_ADMIN_API_KEY no backend ou envie o header Authorization no pedido.',
      });
    }
    if (statusCode === 204) {
      return res.status(204).end();
    }
    if (String(raw || '').trim() === '' && statusCode >= 200 && statusCode < 300) {
      return res.json({ ok: true });
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(statusCode >= 400 ? statusCode : 502).json({
        message: raw ? String(raw).slice(0, 500) : 'Resposta invalida do website.',
      });
    }
    if (statusCode < 200 || statusCode >= 300) {
      return res.status(statusCode).json(data && typeof data === 'object' ? data : { message: String(data) });
    }
    return res.json(data != null ? data : { ok: true });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
