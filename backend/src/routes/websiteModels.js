/**
 * Proxy de teste: lista de modelos do site institucional (API pública).
 * GET /api/website/models
 */

const https = require('https');
const express = require('express');

const router = express.Router();

const WEBSITE_ORIGIN = 'https://www.andymodels.com';
const WEBSITE_MODELS_LIST_URL = `${WEBSITE_ORIGIN}/api/models`;

/** Mesmo valor que o site usa em adminAuth: Bearer = ADMIN_SECRET (login devolve { token: config.adminSecret }). */
function websiteAdminBearerToken() {
  return String(
    process.env.WEBSITE_ADMIN_API_KEY ||
      process.env.WEBSITE_ADMIN_TOKEN ||
      process.env.ADMIN_SECRET ||
      '',
  ).trim();
}

/** GET com Bearer admin do site (ex.: inscrições). */
function fetchWebsiteAdminJson(url) {
  return new Promise((resolve, reject) => {
    const token = websiteAdminBearerToken();
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'AndyModels-CRM/1.0',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.get(url, { headers }, (res) => {
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
  });
}

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

/**
 * PATCH/PUT JSON para o website (media, modelo, etc.).
 * Nunca repassa o Authorization do browser (JWT do CRM).
 */
function websiteJsonRequest(method, urlString, bodyObj) {
  const m = String(method || 'PATCH').toUpperCase();
  const body = JSON.stringify(bodyObj ?? {});
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: m === 'PUT' ? 'PUT' : 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'User-Agent': 'AndyModels-CRM/1.0',
      },
    };
    const token = websiteAdminBearerToken();
    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
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

function patchWebsiteJson(urlString, bodyObj) {
  return websiteJsonRequest('PATCH', urlString, bodyObj);
}

function websiteDeleteRequest(urlString) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AndyModels-CRM/1.0',
      },
    };
    const token = websiteAdminBearerToken();
    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
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
    req.end();
  });
}

/** Resposta proxy admin → cliente CRM (401, JSON, vazio). */
function sendWebsiteAdminProxyResponse(res, statusCode, raw) {
  if (statusCode === 401) {
    const hasEnvToken = Boolean(websiteAdminBearerToken());
    return res.status(401).json({
      message: hasEnvToken
        ? 'Website recusou o Bearer (401). O valor no CRM tem de ser o mesmo ADMIN_SECRET do site (o token devolvido por POST /api/admin/auth/login).'
        : 'O backend do CRM não tem token admin do site. No Render (API): defina ADMIN_SECRET ou WEBSITE_ADMIN_API_KEY com o mesmo valor de ADMIN_SECRET do servidor do site → Save → Manual Deploy. Em local: backend/.env e reinicie.',
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
 * (Registado antes de /admin/models/:id para evitar ambiguidade.)
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
    const { statusCode, raw } = await patchWebsiteJson(url, { media: req.body.media });
    return sendWebsiteAdminProxyResponse(res, statusCode, raw);
  } catch (e) {
    return next(e);
  }
});

/**
 * Atualiza modelo no site: PATCH https://www.andymodels.com/api/admin/models/:id
 * Body repassado (ex.: model_status, city — nomes da API pública GET /api/models/:slug).
 */
router.patch('/admin/models/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Body invalido.' });
    }
    const url = `${WEBSITE_ORIGIN}/api/admin/models/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await patchWebsiteJson(url, req.body);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw);
  } catch (e) {
    return next(e);
  }
});

/**
 * Inscrições do site: GET https://www.andymodels.com/api/applications/admin?category=&status=
 * (Bearer = ADMIN_SECRET no servidor CRM, igual ao site.)
 */
router.get('/website/applications/admin', async (req, res, next) => {
  try {
    const qs = new URLSearchParams();
    const cat = String(req.query.category || '').trim();
    const st = String(req.query.status || '').trim();
    if (cat) qs.set('category', cat);
    if (st) qs.set('status', st);
    const q = qs.toString();
    const url = `${WEBSITE_ORIGIN}/api/applications/admin${q ? `?${q}` : ''}`;
    const { statusCode, raw } = await fetchWebsiteAdminJson(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw);
  } catch (e) {
    return next(e);
  }
});

/**
 * PATCH https://www.andymodels.com/api/applications/admin/:id — body: { status } e/ou { notes }
 */
router.patch('/website/applications/admin/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Body invalido.' });
    }
    const body = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) body.status = req.body.status;
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) body.notes = req.body.notes;
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ message: 'Body deve incluir status e/ou notes.' });
    }
    const url = `${WEBSITE_ORIGIN}/api/applications/admin/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await patchWebsiteJson(url, body);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw);
  } catch (e) {
    return next(e);
  }
});

/**
 * DELETE https://www.andymodels.com/api/applications/admin/:id
 */
router.delete('/website/applications/admin/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const url = `${WEBSITE_ORIGIN}/api/applications/admin/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await websiteDeleteRequest(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
