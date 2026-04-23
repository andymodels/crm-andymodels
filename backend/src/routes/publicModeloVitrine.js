/**
 * Pré-visualização pública da vitrine (link «secreto»): não exige login CRM.
 * O token JWT autoriza ler só uma ficha e expira (predef.: 365d).
 */
const express = require('express');
const { pool } = require('../config/db');
const { verifyModeloPreviewToken } = require('../utils/auth');
const { fetchWebsiteAdminJson, getWebsiteOrigin } = require('../services/websiteHttpClient');

const router = express.Router();

function parsePerfilSite(row) {
  let p = row.perfil_site;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = {};
    }
  }
  return p && typeof p === 'object' ? p : {};
}

function stripInternalFieldsMedia(items) {
  if (!Array.isArray(items)) return [];
  return items.map((entry) => {
    if (entry == null) return entry;
    if (typeof entry === 'string') return entry;
    if (typeof entry !== 'object') return entry;
    const { internal_note: _n, admin_note: _a, ...rest } = entry;
    return rest;
  });
}

/** Mesmo segmento que o front (`VITE_WEBSITE_MODEL_PATH`), para o cliente montar URL pública quando ativo. */
function websiteModelPublicSegment() {
  return String(process.env.WEBSITE_MODEL_PUBLIC_PATH || 'modelo')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

router.get('/public/modelo-vitrine', async (req, res, next) => {
  try {
    const token = String(req.query.t || '').trim();
    if (!token) {
      return res.status(400).json({ message: 'Indique o token na query (?t=).' });
    }
    let modeloId;
    try {
      modeloId = verifyModeloPreviewToken(token);
    } catch {
      return res.status(401).json({ message: 'Link invalido ou expirado.' });
    }

    const result = await pool.query('SELECT * FROM modelos WHERE id = $1', [modeloId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Modelo nao encontrado.' });
    }
    const row = result.rows[0];
    const perfil = parsePerfilSite(row);

    const slug = String(perfil.slug_site || '').trim();
    const nomeExibicao = String(perfil.nome_site || row.nome || '').trim() || 'Modelo';
    const bio = perfil.bio != null ? String(perfil.bio).trim() : '';
    const videoUrl = perfil.video_url != null ? String(perfil.video_url).trim() : '';

    const ativoNaVitrine =
      row.ativo_site === true ||
      row.ativo_site === 1 ||
      row.ativo_site === '1' ||
      String(row.ativo_site || '').toLowerCase() === 't';

    const wid = row.website_model_id != null ? Number(row.website_model_id) : NaN;
    let media = [];

    if (Number.isFinite(wid) && wid > 0) {
      const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(String(wid))}`;
      const { statusCode, raw } = await fetchWebsiteAdminJson(url);
      if (statusCode >= 200 && statusCode < 300 && raw) {
        try {
          const data = JSON.parse(raw);
          const m = data.media ?? data.model?.media;
          if (Array.isArray(m) && m.length > 0) media = m;
        } catch {
          /* fallback CRM */
        }
      }
    }

    if (media.length === 0 && Array.isArray(perfil.apiMedia)) {
      media = perfil.apiMedia;
    }

    media = stripInternalFieldsMedia(media);

    const websiteOrigin = getWebsiteOrigin().replace(/\/$/, '');
    const segment = websiteModelPublicSegment();
    const urlVitrinePublica =
      slug && ativoNaVitrine ? `${websiteOrigin}/${segment}/${encodeURIComponent(slug)}` : null;

    res.json({
      modelo_id: modeloId,
      nome_exibicao: nomeExibicao,
      slug,
      bio,
      video_url: videoUrl,
      instagram:
        perfil.instagram != null
          ? String(perfil.instagram).trim()
          : row.instagram != null
            ? String(row.instagram).trim()
            : '',
      ativo_na_vitrine: ativoNaVitrine,
      url_vitrine_publica: urlVitrinePublica,
      website_origin: websiteOrigin,
      website_model_path_segment: segment,
      media,
      medidas: {
        medida_altura: row.medida_altura != null ? String(row.medida_altura).trim() : '',
        medida_busto: row.medida_busto != null ? String(row.medida_busto).trim() : '',
        medida_torax: row.medida_torax != null ? String(row.medida_torax).trim() : '',
        medida_cintura: row.medida_cintura != null ? String(row.medida_cintura).trim() : '',
        medida_quadril: row.medida_quadril != null ? String(row.medida_quadril).trim() : '',
        medida_sapato: row.medida_sapato != null ? String(row.medida_sapato).trim() : '',
        medida_cabelo: row.medida_cabelo != null ? String(row.medida_cabelo).trim() : '',
        medida_olhos: row.medida_olhos != null ? String(row.medida_olhos).trim() : '',
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
