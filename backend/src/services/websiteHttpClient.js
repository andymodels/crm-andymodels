/**
 * Cliente HTTP partilhado para o proxy CRM → API admin/pública do site.
 * Extraído de routes/websiteModels.js para reutilização (sync CRM, galeria → site).
 */

const https = require('https');

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
          console.log('RESPONSE STATUS:', res.status);
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
        const sc = res.statusCode || 0;
        console.log('RESPONSE STATUS:', sc);
        const preview =
          raw.length > 800 ? `${raw.slice(0, 800)}… (+${raw.length - 800} chars)` : raw;
        logWebsiteProxyResponse(sc, preview);
        resolve({ statusCode: sc, raw });
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
  if (out.show_instagram !== undefined && out.show_instagram !== null) out.show_instagram = to10(out.show_instagram);
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
  const r = await fetch(urlString, { method: m, headers, body: fd });
  console.log('RESPONSE STATUS:', r.status);
  const raw = await r.text();
  const preview = raw.length > 800 ? `${raw.slice(0, 800)}… (+${raw.length - 800} chars)` : raw;
  logWebsiteProxyResponse(r.status, preview);
  return { statusCode: r.status, raw };
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

function sendWebsiteAdminProxyResponse(res, statusCode, raw, attemptedUrl) {
  if (statusCode === 401) {
    const hasEnvToken = Boolean(websiteAdminBearerToken());
    return res.status(401).json({
      message: hasEnvToken
        ? 'Website recusou o Bearer (401). O valor no CRM tem de ser o mesmo ADMIN_SECRET do site (o token devolvido por POST /api/admin/auth/login).'
        : 'O backend do CRM não tem token admin do site. No Render (API): defina WEBSITE_ADMIN_TOKEN (recomendado) ou WEBSITE_ADMIN_API_KEY ou ADMIN_SECRET com o mesmo valor de ADMIN_SECRET do servidor do site → Save → Manual Deploy. Em local: backend/.env e reinicie.',
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

module.exports = {
  getWebsiteOrigin,
  websiteAdminBearerToken,
  fetchWebsiteAdminJson,
  fetchWebsiteJson,
  websiteJsonRequest,
  patchWebsiteJson,
  normalizeWebsiteModelPatchBody,
  forwardMultipartModelToWebsite,
  websiteDeleteRequest,
  sendWebsiteAdminProxyResponse,
};
