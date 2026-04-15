/**
 * Proxy para a API Instagram do site institucional: GET /api/instagram (público no site),
 * POST/PATCH/DELETE com Bearer = ADMIN_SECRET (igual aos outros proxies do website).
 */

const https = require('https');
const express = require('express');
const multer = require('multer');

const router = express.Router();

const instagramUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 4 },
});

function getWebsiteOrigin() {
  return String(process.env.WEBSITE_ORIGIN || 'https://www.andymodels.com')
    .trim()
    .replace(/\/$/, '');
}

function websiteAdminBearerToken() {
  return String(
    process.env.WEBSITE_ADMIN_TOKEN ||
      process.env.WEBSITE_ADMIN_API_KEY ||
      process.env.ADMIN_SECRET ||
      '',
  ).trim();
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
    if (token) options.headers.Authorization = `Bearer ${token}`;
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

function websiteJsonRequest(method, urlString, bodyObj) {
  const m = String(method || 'PATCH').toUpperCase();
  const body = JSON.stringify(bodyObj ?? {});
  const token = websiteAdminBearerToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'AndyModels-CRM/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (typeof fetch !== 'function') {
    return Promise.reject(new Error('JSON proxy requer Node 18+ (fetch).'));
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 60_000);
  return fetch(urlString, {
    method: m,
    headers,
    body,
    redirect: 'follow',
    signal: ctrl.signal,
  })
    .then((res) =>
      res.text().then((raw) => ({
        statusCode: res.status,
        raw,
      })),
    )
    .finally(() => clearTimeout(tid))
    .catch((e) => {
      if (e && e.name === 'AbortError') throw new Error('Timeout ao contactar o website.');
      throw e;
    });
}

async function forwardMultipartToSite(method, urlString, req) {
  const token = websiteAdminBearerToken();
  const fd = new FormData();
  for (const [key, val] of Object.entries(req.body || {})) {
    if (val === undefined || val === null) continue;
    fd.append(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
  }
  const files = req.files || (req.file ? [req.file] : []);
  for (const f of files) {
    const field = f.fieldname || 'image';
    const blob = new Blob([f.buffer], { type: f.mimetype || 'application/octet-stream' });
    fd.append(field, blob, f.originalname);
  }
  const headers = { Accept: 'application/json', 'User-Agent': 'AndyModels-CRM/1.0' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (typeof fetch !== 'function') {
    throw new Error('Multipart requer Node 18+ (fetch).');
  }
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(urlString, {
      method: String(method || 'POST').toUpperCase(),
      headers,
      body: fd,
      signal: ctrl.signal,
    });
    const raw = await r.text();
    return { statusCode: r.status, raw };
  } finally {
    clearTimeout(tid);
  }
}

function sendWebsiteAdminProxyResponse(res, statusCode, raw, attemptedUrl) {
  if (statusCode === 401) {
    const hasEnvToken = Boolean(websiteAdminBearerToken());
    return res.status(401).json({
      message: hasEnvToken
        ? 'Website recusou o Bearer (401). Defina o mesmo ADMIN_SECRET do site no CRM.'
        : 'Defina WEBSITE_ADMIN_TOKEN ou WEBSITE_ADMIN_API_KEY ou ADMIN_SECRET no backend do CRM (igual ao site).',
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
    const msg = isHtml
      ? `O site devolveu HTML (HTTP ${statusCode}) em vez de JSON. ${pathHint}`
      : raw
        ? String(raw).slice(0, 500)
        : 'Resposta invalida do website.';
    return res.status(statusCode >= 400 ? statusCode : 502).json({ message: msg });
  }
  if (statusCode < 200 || statusCode >= 300) {
    return res.status(statusCode).json(data && typeof data === 'object' ? data : { message: String(data) });
  }
  return res.json(data != null ? data : { ok: true });
}

/** Lista pública de posts (como no site). */
router.get('/website/instagram', async (req, res, next) => {
  try {
    const url = `${getWebsiteOrigin()}/api/instagram`;
    const { statusCode, raw } = await fetchWebsiteJson(url);
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

/** Criar post: multipart url (+ opcional image). */
router.post('/website/instagram', instagramUpload.any(), async (req, res, next) => {
  try {
    const url = `${getWebsiteOrigin()}/api/instagram`;
    const result = await forwardMultipartToSite('POST', url, req);
    return sendWebsiteAdminProxyResponse(res, result.statusCode, result.raw, url);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return res.status(504).json({ message: 'Timeout ao contactar o website.' });
    }
    return next(e);
  }
});

/** Atualizar só position. */
router.patch('/website/instagram/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'ID invalido.' });
    const url = `${getWebsiteOrigin()}/api/instagram/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await websiteJsonRequest('PATCH', url, req.body || {});
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

router.delete('/website/instagram/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'ID invalido.' });
    const url = `${getWebsiteOrigin()}/api/instagram/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await websiteDeleteRequest(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

/** Imagem: multipart (campo image) ou JSON { image_url }. */
router.post(
  '/website/instagram/:id/image',
  (req, res, next) => {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
      return instagramUpload.single('image')(req, res, next);
    }
    return express.json({ limit: '2mb' })(req, res, next);
  },
  async (req, res, next) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ message: 'ID invalido.' });
      const base = `${getWebsiteOrigin()}/api/instagram/${encodeURIComponent(id)}/image`;
      if (req.file && req.file.buffer) {
        req.files = [req.file];
        console.log(
          '[website/instagram/image]',
          JSON.stringify({
            scope: 'instagram_image_proxy',
            event: 'multipart_forward',
            ts: new Date().toISOString(),
            instagram_id: id,
            image_url_received: {
              type: 'multipart_file',
              field: 'image',
              originalname: req.file.originalname || null,
              size: req.file.buffer?.length ?? null,
            },
            note: 'CRM não grava; encaminha ficheiro ao site.',
          }),
        );
        const result = await forwardMultipartToSite('POST', base, req);
        return sendWebsiteAdminProxyResponse(res, result.statusCode, result.raw, base);
      }
      const imageUrl = req.body && req.body.image_url != null ? String(req.body.image_url).trim() : '';
      if (!imageUrl) {
        return res.status(400).json({ message: 'Envie image (ficheiro) ou image_url no JSON.' });
      }
      console.log(
        '[website/instagram/image]',
        JSON.stringify({
          scope: 'instagram_image_proxy',
          event: 'json_image_url_forward',
          ts: new Date().toISOString(),
          instagram_id: id,
          image_url_received: imageUrl,
          note: 'CRM não grava; reencaminha ao site. image_url_saved/returned ficam no website.',
        }),
      );
      const { statusCode, raw } = await websiteJsonRequest('POST', base, { image_url: imageUrl });
      try {
        const preview = String(raw || '').slice(0, 500);
        console.log(
          '[website/instagram/image]',
          JSON.stringify({
            scope: 'instagram_image_proxy',
            event: 'site_response_preview',
            instagram_id: id,
            statusCode,
            response_preview: preview,
          }),
        );
      } catch (_e) {
        /* */
      }
      return sendWebsiteAdminProxyResponse(res, statusCode, raw, base);
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = router;
