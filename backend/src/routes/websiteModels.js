/**
 * Proxy de teste: lista de modelos do site institucional (API pública).
 * GET /api/website/models
 */

const https = require('https');
const express = require('express');
const multer = require('multer');

const router = express.Router();

const websiteModelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 35 * 1024 * 1024, files: 40 },
});

/** Base do site (lista pública, admin). Override: WEBSITE_ORIGIN no .env (ex.: staging). */
function getWebsiteOrigin() {
  return String(process.env.WEBSITE_ORIGIN || 'https://www.andymodels.com')
    .trim()
    .replace(/\/$/, '');
}

/** Mesmo valor que o site usa em adminAuth: Bearer = ADMIN_SECRET (login devolve { token: config.adminSecret }). */
function websiteAdminBearerToken() {
  return String(
    process.env.WEBSITE_ADMIN_API_KEY ||
      process.env.WEBSITE_ADMIN_TOKEN ||
      process.env.ADMIN_SECRET ||
      '',
  ).trim();
}

/** Ative DEBUG_WEBSITE_PROXY=1 no Render/.env para ver URL, método e corpo (nunca o segredo em claro). */
function isDebugWebsiteProxy() {
  return String(process.env.DEBUG_WEBSITE_PROXY || '').trim() === '1';
}

function safeHeadersForLog(headers) {
  const h = { ...headers };
  if (h.Authorization) {
    const s = String(h.Authorization);
    h.Authorization = s.startsWith('Bearer ')
      ? `Bearer <redacted, ${s.length} chars>`
      : '<redacted>';
  }
  return h;
}

function logWebsiteProxyOutgoing(method, urlString, headers, bodyStr) {
  if (!isDebugWebsiteProxy()) return;
  const token = websiteAdminBearerToken();
  const bodyPreview =
    bodyStr.length > 6000 ? `${bodyStr.slice(0, 6000)}… (+${bodyStr.length - 6000} chars)` : bodyStr;
  console.log(
    '[website-proxy] outgoing',
    JSON.stringify(
      {
        method,
        url: urlString,
        headers: safeHeadersForLog(headers),
        bodyLength: Buffer.byteLength(bodyStr, 'utf8'),
        body: bodyPreview,
        adminBearerConfigured: Boolean(token),
        adminBearerLength: token ? token.length : 0,
      },
      null,
      0,
    ),
  );
}

function logWebsiteProxyResponse(statusCode, rawPreview) {
  if (!isDebugWebsiteProxy()) return;
  console.log('[website-proxy] response', JSON.stringify({ statusCode, rawPreview }));
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
 * Usa `fetch` quando existe (Node 18+): segue redirecionamentos (www, HTTPS).
 */
function websiteJsonRequest(method, urlString, bodyObj) {
  const rawM = String(method || 'PATCH').toUpperCase();
  const m = ['PATCH', 'PUT', 'POST'].includes(rawM) ? rawM : 'PATCH';
  const body = JSON.stringify(bodyObj ?? {});
  const token = websiteAdminBearerToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'AndyModels-CRM/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  logWebsiteProxyOutgoing(m, urlString, headers, body);

  if (typeof fetch === 'function') {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25_000);
    return fetch(urlString, {
      method: m,
      headers,
      body,
      redirect: 'follow',
      signal: ctrl.signal,
    })
      .then((res) =>
        res.text().then((raw) => {
          const preview =
            raw.length > 800 ? `${raw.slice(0, 800)}… (+${raw.length - 800} chars)` : raw;
          logWebsiteProxyResponse(res.status, preview);
          return { statusCode: res.status, raw };
        }),
      )
      .finally(() => clearTimeout(tid))
      .catch((e) => {
        if (e && e.name === 'AbortError') throw new Error('Timeout ao contactar o website.');
        throw e;
      });
  }

  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: m,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'User-Agent': 'AndyModels-CRM/1.0',
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;
    const req = https.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        const preview =
          raw.length > 800 ? `${raw.slice(0, 800)}… (+${raw.length - 800} chars)` : raw;
        logWebsiteProxyResponse(res.statusCode || 0, preview);
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

/**
 * Admin do site (PUT) compara featured/active com strings '1'/'0' como no multipart.
 */
function normalizeWebsiteModelPatchBody(body) {
  if (!body || typeof body !== 'object') return {};
  const out = { ...body };
  const to10 = (v) => {
    if (v === true || v === '1' || v === 1) return '1';
    if (v === false || v === '0' || v === 0) return '0';
    const n = Number(v);
    if (!Number.isNaN(n)) return n ? '1' : '0';
    return '0';
  };
  if (out.featured !== undefined && out.featured !== null) out.featured = to10(out.featured);
  if (out.active !== undefined && out.active !== null) out.active = to10(out.active);
  if (typeof out.creator === 'boolean') out.creator = out.creator ? 1 : 0;
  if (out.creator !== undefined && out.creator !== null && typeof out.creator !== 'boolean') {
    const n = Number(out.creator);
    if (!Number.isNaN(n)) out.creator = n ? 1 : 0;
  }
  if (out.slug == null || String(out.slug).trim() === '') delete out.slug;
  const torax = out.torax != null ? String(out.torax).trim() : '';
  if (torax && (out.chest == null || String(out.chest).trim() === '')) out.chest = torax;
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === undefined) delete out[k];
  }
  return out;
}

/** Encaminha POST/PUT multipart ao site (campos de texto + ficheiros photos/gallery). */
async function forwardMultipartModelToWebsite(method, urlString, req) {
  const token = websiteAdminBearerToken();
  const fd = new FormData();
  for (const [key, val] of Object.entries(req.body || {})) {
    if (val === undefined || val === null) continue;
    fd.append(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
  }
  for (const f of req.files || []) {
    const field = f.fieldname || 'photos';
    const blob = new Blob([f.buffer], { type: f.mimetype || 'application/octet-stream' });
    fd.append(field, blob, f.originalname);
  }
  const headers = { Accept: 'application/json', 'User-Agent': 'AndyModels-CRM/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const m = String(method || 'PUT').toUpperCase();
  if (isDebugWebsiteProxy()) {
    console.log(
      '[website-proxy] outgoing',
      JSON.stringify({ method: m, url: urlString, multipartFiles: (req.files || []).length }, null, 0),
    );
  }
  if (typeof fetch !== 'function') {
    throw new Error('Multipart requer Node 18+ (fetch).');
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(urlString, { method: m, headers, body: fd, signal: ctrl.signal });
    const raw = await r.text();
    const preview = raw.length > 800 ? `${raw.slice(0, 800)}… (+${raw.length - 800} chars)` : raw;
    logWebsiteProxyResponse(r.status, preview);
    return { statusCode: r.status, raw };
  } finally {
    clearTimeout(tid);
  }
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

/** Resposta proxy admin → cliente CRM (401, JSON, vazio). attemptedUrl = URL completa do pedido ao site (para mensagens). */
function sendWebsiteAdminProxyResponse(res, statusCode, raw, attemptedUrl) {
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
    const isHtml = String(raw || '').includes('<');
    let pathHint = '';
    try {
      if (attemptedUrl) pathHint = new URL(attemptedUrl).pathname;
    } catch {
      pathHint = String(attemptedUrl || '').slice(0, 120);
    }
    const idMatch = attemptedUrl && String(attemptedUrl).match(/\/admin\/models\/([^/]+)/);
    const idHint = idMatch ? ` ID ${idMatch[1]}` : '';
    let msg;
    if (isHtml && statusCode === 404) {
      msg = `O site devolveu 404 (página HTML) ao guardar${idHint}. Pedido: ${pathHint || '?'}. Quase sempre o modelo já não existe nesse ID no admin do site (foi apagado) ou os dados estão desatualizados: volte à lista «Modelos no site», abra o modelo outra vez e salve. Se o site usar outro domínio, defina WEBSITE_ORIGIN no backend.`;
    } else if (isHtml) {
      msg = `O site devolveu HTML (HTTP ${statusCode}) em vez de JSON. Pedido: ${pathHint || '?'}. Verifique WEBSITE_ORIGIN e se o admin do site está acessível.`;
    } else {
      msg = raw ? String(raw).slice(0, 500) : 'Resposta invalida do website.';
    }
    return res.status(statusCode >= 400 ? statusCode : 502).json({ message: msg });
  }
  if (statusCode < 200 || statusCode >= 300) {
    return res.status(statusCode).json(data && typeof data === 'object' ? data : { message: String(data) });
  }
  return res.json(data != null ? data : { ok: true });
}

router.get('/website/models', async (_req, res, next) => {
  try {
    const listUrl = `${getWebsiteOrigin()}/api/models`;
    const { statusCode, raw } = await fetchWebsiteJson(listUrl);
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
    const url = `${getWebsiteOrigin()}/api/models/${encodeURIComponent(slug)}`;
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
 * Cria modelo no site: POST https://www.andymodels.com/api/admin/models
 * JSON ou multipart (photos/gallery), como o admin do site.
 */
router.post('/admin/models', websiteModelUpload.any(), async (req, res, next) => {
  try {
    const url = `${getWebsiteOrigin()}/api/admin/models`;
    const files = req.files || [];
    let statusCode;
    let raw;
    if (files.length > 0) {
      const result = await forwardMultipartModelToWebsite('POST', url, req);
      statusCode = result.statusCode;
      raw = result.raw;
    } else {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ message: 'Body invalido.' });
      }
      const payload = normalizeWebsiteModelPatchBody(req.body);
      if (isDebugWebsiteProxy()) {
        console.log('PAYLOAD ENVIADO:', payload);
      }
      const r = await websiteJsonRequest('POST', url, payload);
      statusCode = r.statusCode;
      raw = r.raw;
    }
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return res.status(504).json({ message: 'Timeout ao contactar o website.' });
    }
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
    const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(id)}/media`;
    const { statusCode, raw } = await patchWebsiteJson(url, { media: req.body.media });
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

/**
 * Atualiza modelo no site: PUT https://…/api/admin/models/:id (admin real do site).
 * — JSON: campos de texto + ordered_images (string JSON), featured/active como '1'/'0'.
 * — multipart: mesmos campos + ficheiros em photos ou gallery (multer.any no proxy).
 * PATCH no CRM repassa ao mesmo handler (o site não tem PATCH neste recurso).
 */
async function handleWebsiteAdminModelPut(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(id)}`;
    const files = req.files || [];
    let statusCode;
    let raw;
    if (files.length > 0) {
      const result = await forwardMultipartModelToWebsite('PUT', url, req);
      statusCode = result.statusCode;
      raw = result.raw;
    } else {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ message: 'Body invalido.' });
      }
      const payload = normalizeWebsiteModelPatchBody(req.body);
      if (isDebugWebsiteProxy()) {
        console.log('PAYLOAD ENVIADO:', payload);
      }
      const r = await websiteJsonRequest('PUT', url, payload);
      statusCode = r.statusCode;
      raw = r.raw;
    }
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return res.status(504).json({ message: 'Timeout ao contactar o website.' });
    }
    return next(e);
  }
}

router.put('/admin/models/:id', websiteModelUpload.any(), handleWebsiteAdminModelPut);
router.patch('/admin/models/:id', websiteModelUpload.any(), handleWebsiteAdminModelPut);

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
    const url = `${getWebsiteOrigin()}/api/applications/admin${q ? `?${q}` : ''}`;
    const { statusCode, raw } = await fetchWebsiteAdminJson(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
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
    const url = `${getWebsiteOrigin()}/api/applications/admin/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await patchWebsiteJson(url, body);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
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
    const url = `${getWebsiteOrigin()}/api/applications/admin/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await websiteDeleteRequest(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
