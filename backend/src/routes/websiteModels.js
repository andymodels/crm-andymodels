/**
 * Proxy de teste: lista de modelos do site institucional (API pública).
 * GET /api/website/models
 */

const express = require('express');
const multer = require('multer');
const { pool } = require('../config/db');
const {
  getWebsiteOrigin,
  fetchWebsiteAdminJson,
  fetchWebsiteJson,
  websiteJsonRequest,
  patchWebsiteJson,
  normalizeWebsiteModelPatchBody,
  forwardMultipartModelToWebsite,
  websiteDeleteRequest,
  sendWebsiteAdminProxyResponse,
} = require('../services/websiteHttpClient');
const router = express.Router();

const websiteModelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MODEL_UPLOAD_MAX_FILE_BYTES) || 150 * 1024 * 1024,
    files: Number(process.env.MODEL_UPLOAD_MAX_FILES) || 200,
  },
});

/** Extrai array de modelos das várias formas que o admin do site devolve. */
function adminModelsListArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.models)) return parsed.models;
    if (Array.isArray(parsed.data)) return parsed.data;
  }
  return null;
}

/** Valor booleano de `ativo_site` na tabela `modelos` (Postgres pode devolver t/f). */
function crmAtivoSiteTrue(v) {
  if (v === true || v === 1 || v === '1') return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 't' || s === 'true' || s === 'on';
}

/** Alinha com o front público: `active` / `featured` como flags (evita modelo ativo no site sumir na lista CRM). */
function websitePublicActiveTruthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === 'on';
}

function websitePublicFeaturedTruthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === 'on';
}

/** Lista admin: `active` visível se o site OU o CRM (`ativo_site`) indicar publicado — não esconder quem está ativo no site. */
function mergeCrmAtivoSiteIntoAdminModelsList(parsed, rows) {
  const map = new Map();
  for (const row of rows) {
    const wid = Number(row.website_model_id);
    if (Number.isNaN(wid) || wid <= 0) continue;
    map.set(wid, crmAtivoSiteTrue(row.ativo_site));
  }
  const arr = adminModelsListArray(parsed);
  if (!Array.isArray(arr)) return;
  for (const m of arr) {
    const id = m?.id != null ? Number(m.id) : NaN;
    if (Number.isNaN(id) || id <= 0 || !map.has(id)) continue;
    const crmOn = map.get(id);
    const siteOn = websitePublicActiveTruthy(m.active);
    const merged = siteOn || crmOn;
    m.active = merged;
    if (m.model && typeof m.model === 'object') m.model.active = merged;
  }
}

/** Detalhe admin: mesmo contrato que a lista (`active` / `featured` booleanos). */
function normalizeAdminModelDetailForCrm(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const strip = ['ativo_no_site', 'status', 'show_on_home', 'is_active'];
  const o = { ...obj };
  for (const k of strip) {
    if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k];
  }
  o.active = websitePublicActiveTruthy(o.active);
  if (o.featured !== undefined && o.featured !== null) o.featured = websitePublicFeaturedTruthy(o.featured);
  if (o.model && typeof o.model === 'object') {
    const m = { ...o.model };
    for (const k of strip) {
      if (Object.prototype.hasOwnProperty.call(m, k)) delete m[k];
    }
    if (m.active !== undefined && m.active !== null) m.active = websitePublicActiveTruthy(m.active);
    if (m.featured !== undefined && m.featured !== null) m.featured = websitePublicFeaturedTruthy(m.featured);
    o.model = m;
  }
  return o;
}

/** Lista admin GET /api/admin/models: `active` / `featured` como booleanos; remove aliases que confundem o CRM. */
function normalizeAdminModelsListForCrm(data) {
  const strip = ['ativo_no_site', 'status', 'show_on_home', 'is_active'];
  const clean = (m) => {
    if (!m || typeof m !== 'object') return;
    for (const k of strip) {
      if (Object.prototype.hasOwnProperty.call(m, k)) delete m[k];
    }
    m.active = websitePublicActiveTruthy(m.active);
    m.featured = websitePublicFeaturedTruthy(m.featured);
    if (m.model && typeof m.model === 'object') {
      for (const k of strip) {
        if (Object.prototype.hasOwnProperty.call(m.model, k)) delete m.model[k];
      }
      if (m.model.active !== undefined) m.model.active = websitePublicActiveTruthy(m.model.active);
      if (m.model.featured !== undefined) m.model.featured = websitePublicFeaturedTruthy(m.model.featured);
    }
  };
  const arr = adminModelsListArray(data);
  if (!Array.isArray(arr)) return data;
  for (const m of arr) clean(m);
  return data;
}

/** GET /api/models (público): garantir `active` e `featured` booleanos na resposta JSON. */
function normalizeWebsitePublicModelsPayload(data) {
  if (data == null) return data;
  const normOne = (m) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
    return {
      ...m,
      active: websitePublicActiveTruthy(m.active),
      featured: websitePublicFeaturedTruthy(m.featured),
    };
  };
  if (Array.isArray(data)) return data.map(normOne);
  if (typeof data === 'object' && Array.isArray(data.models)) {
    return { ...data, models: data.models.map(normOne) };
  }
  if (typeof data === 'object' && Array.isArray(data.data)) {
    return { ...data, data: data.data.map(normOne) };
  }
  return data;
}

/**
 * Lista admin no site (inclui modelos inativos). GET …/api/admin/models
 * Usada pelo CRM em «Modelos no site» e «Website → Home» (ordem: filtro no cliente: category/categoria home, featured, home_order).
 * O CRM não tem tabela modelos local; o proxy repassa query params ao site.
 */
router.get('/admin/models', async (req, res, next) => {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query || {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.set(k, String(v));
    }
    const qstr = qs.toString();
    const url = `${getWebsiteOrigin()}/api/admin/models${qstr ? `?${qstr}` : ''}`;
    const { statusCode, raw } = await fetchWebsiteAdminJson(url);
    if (statusCode < 200 || statusCode >= 300 || !raw || !String(raw).trim()) {
      return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
    }
    if (pool) {
      try {
        const r = await pool.query(
          'SELECT website_model_id, ativo_site FROM modelos WHERE website_model_id IS NOT NULL',
        );
        mergeCrmAtivoSiteIntoAdminModelsList(data, r.rows);
      } catch {
        /* lista do site mantém-se */
      }
    }
    return res.status(statusCode).json(normalizeAdminModelsListForCrm(data));
  } catch (e) {
    return next(e);
  }
});

/**
 * Detalhe admin por id numérico. GET …/api/admin/models/:id
 * Permite carregar ficha de modelo inativo (API pública pode devolver 404).
 */
router.get('/admin/models/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await fetchWebsiteAdminJson(url);
    let getLog;
    try {
      getLog = raw ? JSON.parse(raw) : raw;
    } catch {
      getLog = raw;
    }
    console.log('GET RESPONSE SITE → CRM:', JSON.stringify(getLog, null, 2));
    if (statusCode >= 200 && statusCode < 300 && raw && getLog && typeof getLog === 'object') {
      const wid = Number(id);
      if (!Number.isNaN(wid) && wid > 0 && pool) {
        try {
          const crm = await pool.query(
            'SELECT perfil_site, ativo_site FROM modelos WHERE website_model_id = $1 ORDER BY id DESC LIMIT 1',
            [wid],
          );
          const row = crm.rows[0];
          if (row) {
            const crmOn = crmAtivoSiteTrue(row.ativo_site);
            const siteOn = websitePublicActiveTruthy(
              getLog.active != null ? getLog.active : getLog.model && getLog.model.active,
            );
            const mergedActive = siteOn || crmOn;
            getLog.active = mergedActive;
            if (getLog.model && typeof getLog.model === 'object') getLog.model.active = mergedActive;
          }
          if (row) {
            return res.status(statusCode).json(normalizeAdminModelDetailForCrm(getLog));
          }
        } catch {
          /* ignora — devolve resposta do site */
        }
      }
    }
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

/**
 * Apaga modelo no site: DELETE …/api/admin/models/:id
 */
router.delete('/admin/models/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(id)}`;
    const { statusCode, raw } = await websiteDeleteRequest(url);
    return sendWebsiteAdminProxyResponse(res, statusCode, raw, url);
  } catch (e) {
    return next(e);
  }
});

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
    return res.json(normalizeWebsitePublicModelsPayload(data));
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
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const one = { ...data };
      if (one.active !== undefined) one.active = websitePublicActiveTruthy(one.active);
      if (one.featured !== undefined) one.featured = websitePublicFeaturedTruthy(one.featured);
      return res.json(one);
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
      console.log('POST BODY FINAL (admin models):', JSON.stringify(payload));
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
      console.log('PUT PAYLOAD CRM → SITE:', JSON.stringify(req.body, null, 2));
      const result = await forwardMultipartModelToWebsite('PUT', url, req);
      statusCode = result.statusCode;
      raw = result.raw;
    } else {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ message: 'Body invalido.' });
      }
      const payload = normalizeWebsiteModelPatchBody(req.body);
      console.log('PUT BODY FINAL:', JSON.stringify(payload));
      const r = await websiteJsonRequest('PUT', url, payload);
      statusCode = r.statusCode;
      raw = r.raw;
    }
    let putResponseLog;
    try {
      putResponseLog = raw ? JSON.parse(raw) : raw;
    } catch {
      putResponseLog = raw;
    }
    console.log('PUT RESPONSE SITE:', JSON.stringify(putResponseLog, null, 2));
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
