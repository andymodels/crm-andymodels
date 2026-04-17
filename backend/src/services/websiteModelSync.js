/**
 * Cria/atualiza `website_model_id` no CRM via POST …/api/admin/models (site),
 * com fallback opcional por slug público (migração).
 */

const {
  getWebsiteOrigin,
  websiteJsonRequest,
  normalizeWebsiteModelPatchBody,
  fetchWebsiteJson,
} = require('./websiteHttpClient');

function parsePerfilSite(row) {
  let p = row?.perfil_site;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = {};
    }
  }
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function instagramUrlFromUsername(u) {
  const t = String(u ?? '').trim().replace(/^@/, '');
  if (!t) return '';
  return `https://instagram.com/${t}`;
}

function normalizeHttpUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function crmAtivoSiteTrue(v) {
  if (v === true || v === 1 || v === '1') return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 't' || s === 'true' || s === 'on';
}

/**
 * Espelha o contrato de `formToWebsiteModelPut` (frontend) a partir da linha `modelos`.
 */
function crmRowToWebsiteAdminCreatePayload(row) {
  const perfil = parsePerfilSite(row);
  const trim = (s) => (s != null ? String(s).trim() : '');
  const nomeCompleto = trim(row.nome);
  const nomeSite = trim(perfil.nome_site || row.nome);
  const baseCat = perfil.catMasculino ? 'men' : 'women';
  const categories = [baseCat];
  if (perfil.catCreators) categories.push('creators');

  let ig = trim(perfil.instagram != null ? perfil.instagram : row.instagram);
  if (ig) {
    if (!/^https?:\/\//i.test(ig)) {
      ig = instagramUrlFromUsername(ig);
    } else {
      try {
        const u = new URL(ig);
        if (u.hostname.replace(/^www\./, '').includes('instagram.com')) {
          u.hash = '';
          const host = u.hostname.replace(/^www\./, '');
          let path = u.pathname || '/';
          if (path !== '/' && path.length > 1) path = path.replace(/\/$/, '');
          ig = `https://${host}${path}${u.search || ''}`;
        }
      } catch {
        /* mantém */
      }
    }
  } else {
    ig = '';
  }

  const pi = trim(perfil.public_info);
  const bioText = trim(perfil.bio);
  const ativoSite = crmAtivoSiteTrue(row.ativo_site);

  const out = {
    name: nomeSite || nomeCompleto,
    bio: bioText,
    featured: perfil.featured ? '1' : '0',
    active: ativoSite ? '1' : '0',
    categories: JSON.stringify(categories),
    shoes: trim(row.medida_sapato) || null,
    hair: trim(row.medida_cabelo) || null,
    eyes: trim(row.medida_olhos) || null,
    waist: trim(row.medida_cintura) || null,
    instagram: ig,
    show_instagram: perfil.mostrar_instagram !== false ? '1' : '0',
    tiktok: trim(row.tiktok) || '',
    ...(() => {
      const v = trim(perfil.video_url);
      if (!v) return { youtube: '', video_url: '' };
      const n = normalizeHttpUrl(v);
      return { youtube: n, video_url: n };
    })(),
  };

  out.model_status = pi;
  out.public_info = pi;
  out.full_name = nomeCompleto;
  out.nome_civil = nomeCompleto;

  const dn = trim(row.data_nascimento);
  if (dn) {
    out.birth_date = dn;
    out.data_nascimento = dn;
  }

  if (baseCat === 'women') {
    out.height = trim(row.medida_altura) || null;
    out.bust = trim(row.medida_busto) || null;
    out.waist = trim(row.medida_cintura) || null;
    out.hips = trim(row.medida_quadril) || null;
    out.torax = '';
  } else {
    out.height = trim(row.medida_altura) || null;
    out.torax = trim(row.medida_torax) || null;
    out.waist = trim(row.medida_cintura) || null;
    out.bust = '';
    out.hips = '';
  }

  const slug = trim(perfil.slug_site);
  if (slug) out.slug = slug;

  const telefones = (Array.isArray(row.telefones) ? row.telefones : [])
    .map((x) => onlyDigits(String(x || '')))
    .filter((d) => d.length >= 8);
  const emails = (Array.isArray(row.emails) ? row.emails : [])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  out.telefones = telefones;
  out.emails = emails;
  out.telefone = telefones[0] || '';
  out.email = emails[0] || '';

  const cepDigits = onlyDigits(row.cep);
  out.endereco = {
    cep: cepDigits,
    logradouro: trim(row.logradouro),
    numero: trim(row.numero),
    complemento: trim(row.complemento),
    bairro: trim(row.bairro),
    cidade: trim(row.cidade),
    uf: trim(row.uf).toUpperCase().slice(0, 2),
  };
  out.cep = cepDigits || null;
  out.logradouro = trim(row.logradouro) || null;
  out.numero = trim(row.numero) || null;
  out.complemento = trim(row.complemento) || null;
  out.bairro = trim(row.bairro) || null;
  out.cidade = trim(row.cidade) || null;
  out.uf = trim(row.uf).toUpperCase().slice(0, 2) || null;

  const cpfD = onlyDigits(row.cpf).slice(0, 11);
  out.cpf = cpfD || '';
  out.rg = trim(row.rg) || '';
  out.passport = row.passaporte != null ? String(row.passaporte).trim() : '';

  const obs = row.observacoes != null ? String(row.observacoes) : '';
  out.observacoes = obs;
  out.notes = obs;

  out.formas_pagamento = Array.isArray(row.formas_pagamento) ? row.formas_pagamento : [];

  return normalizeWebsiteModelPatchBody(out);
}

function extractWebsiteModelIdFromCreateResponse(raw) {
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const id = data.id ?? data.model?.id ?? data.data?.id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function createWebsiteModelOnSite(row) {
  const url = `${getWebsiteOrigin()}/api/admin/models`;
  const payload = crmRowToWebsiteAdminCreatePayload(row);
  const { statusCode, raw } = await websiteJsonRequest('POST', url, payload);
  return { statusCode, raw, id: extractWebsiteModelIdFromCreateResponse(raw) };
}

async function fetchPublicModelIdBySlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return null;
  const url = `${getWebsiteOrigin()}/api/models/${encodeURIComponent(s)}`;
  const { statusCode, raw } = await fetchWebsiteJson(url);
  if (statusCode < 200 || statusCode >= 300 || !raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const d =
    data && typeof data === 'object' && data.model && typeof data.model === 'object' ? data.model : data;
  const n = Number(d && d.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Garante `website_model_id` na linha CRM (POST admin ou fallback slug).
 * @returns {{ row: object, error?: string }}
 */
async function syncWebsiteModelIdIntoRow(pool, row) {
  const id = Number(row.id);
  if (Number.isNaN(id) || id <= 0) return { row, error: 'ID invalido.' };

  const existing = Number(row.website_model_id);
  if (Number.isFinite(existing) && existing > 0) {
    const fresh = await pool.query('SELECT * FROM modelos WHERE id = $1', [id]);
    return { row: fresh.rows[0] || row };
  }

  let wid = null;
  let lastRaw = '';
  let lastStatus = 0;

  try {
    const created = await createWebsiteModelOnSite(row);
    lastRaw = created.raw;
    lastStatus = created.statusCode;
    wid = created.id;
    if (created.statusCode >= 200 && created.statusCode < 300 && !wid) {
      console.warn('[websiteModelSync] POST admin/models sem id na resposta:', String(lastRaw).slice(0, 400));
    }
  } catch (e) {
    console.error('[websiteModelSync] POST admin/models failed:', e.message);
  }

  if (!wid) {
    const perfil = parsePerfilSite(row);
    const slug = String(perfil.slug_site || '').trim();
    if (slug) {
      try {
        wid = await fetchPublicModelIdBySlug(slug);
      } catch (e) {
        console.error('[websiteModelSync] slug fallback failed:', e.message);
      }
    }
  }

  if (!wid) {
    return {
      row,
      error: `Nao foi possivel criar ou resolver o modelo no site (HTTP ${lastStatus}).`,
    };
  }

  const result = await pool.query(
    'UPDATE modelos SET website_model_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [wid, id],
  );
  return { row: result.rows[0] || row };
}

module.exports = {
  crmRowToWebsiteAdminCreatePayload,
  extractWebsiteModelIdFromCreateResponse,
  createWebsiteModelOnSite,
  syncWebsiteModelIdIntoRow,
};
