/**
 * Importa modelos do site para a tabela `modelos` do CRM.
 * Ordem: GET /api/admin/models (com token) — ids garantidos; fallback GET /api/models + detalhe por slug.
 * Não copia mídia/base64 — apenas metadados e website_model_id.
 */

const { insertModeloRow } = require('../utils/modeloInsert');
const { isValidCPF } = require('../utils/brValidators');
const { fetchWebsiteAdminJson, fetchWebsiteJson, getWebsiteOrigin } = require('./websiteHttpClient');
const { fetchPublicModelIdBySlug } = require('./websiteModelSync');

function extractModelsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['models', 'data', 'items', 'results', 'records']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

function str(v) {
  return v != null ? String(v).trim() : '';
}

function websitePublicBool(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === 't' || s === 'on';
}

/**
 * Resolve id numérico do modelo no site (lista admin, lista pública ou objeto nested).
 */
function parseWebsiteModelNumericId(m) {
  if (!m || typeof m !== 'object') return null;
  const candidates = [
    m.id,
    m.model_id,
    m.modelId,
    m.numeric_id,
    m?.model?.id,
    m?.model?.model_id,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const n = Number(String(c).trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function cpfPlaceholderForWebsiteId(wid, salt = 0) {
  const n = Number(wid);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mixed = (n * 10007 + salt * 13) % 1000000000;
  let s9 = String(mixed).padStart(9, '0');
  if (/^(\d)\1{8}$/.test(s9)) {
    s9 = '000000001';
  }
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += parseInt(s9[i], 10) * (10 - i);
  }
  let d1 = sum % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  const s10 = s9 + d1;
  sum = 0;
  for (let i = 0; i < 10; i += 1) {
    sum += parseInt(s10[i], 10) * (11 - i);
  }
  let d2 = sum % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  const out = s10 + d2;
  return isValidCPF(out) ? out : null;
}

function categoriesToFlags(m) {
  const cats = Array.isArray(m.categories) ? m.categories.map((c) => String(c).toLowerCase()) : [];
  const cat = String(m.category || '').toLowerCase();
  const has = (x) => cats.some((c) => c.includes(x)) || cat === x;
  const men = has('men') || has('masculino');
  const women = has('women') || has('feminino');
  return {
    catMasculino: men,
    catFeminino: women || (!men && !women),
    catCreators: has('creators'),
  };
}

function unwrapPublicModel(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.model && typeof m.model === 'object') return { ...m, ...m.model };
  return m;
}

function buildPerfilSite(mRaw, slug) {
  const m = unwrapPublicModel(mRaw) || {};
  const flags = categoriesToFlags(m);
  const bio = str(m.bio);
  const nomeSite = str(m.name || m.nome) || slug || 'Modelo';
  return {
    nome_site: nomeSite,
    bio,
    featured: websitePublicBool(m.featured),
    catFeminino: flags.catFeminino,
    catMasculino: flags.catMasculino,
    catCreators: flags.catCreators,
    mostrar_instagram: true,
    video_url: str(m.video_url || m.youtube || ''),
    public_info: str(m.public_info || m.model_status || ''),
    slug_site: slug,
    instagram: str(m.instagram),
  };
}

function mapMedidas(mRaw) {
  const m = unwrapPublicModel(mRaw) || {};
  return {
    medida_altura: str(m.height || m.medida_altura),
    medida_busto: str(m.bust || m.medida_busto),
    medida_torax: str(m.torax || m.chest || m.medida_torax),
    medida_cintura: str(m.waist || m.medida_cintura),
    medida_quadril: str(m.hips || m.medida_quadril),
    medida_sapato: str(m.shoes || m.medida_sapato),
    medida_cabelo: str(m.hair || m.medida_cabelo),
    medida_olhos: str(m.eyes || m.medida_olhos),
  };
}

/**
 * Carrega lista de modelos: prioriza admin (ids); se vazio ou indisponível, usa API pública.
 */
async function loadWebsiteModelsList() {
  const origin = getWebsiteOrigin();
  const adminUrl = `${origin}/api/admin/models`;
  const publicUrl = `${origin}/api/models`;

  let list = [];
  let listSource = 'none';
  let adminHttpStatus = null;
  let publicHttpStatus = null;
  let parseNote = null;

  const adminRes = await fetchWebsiteAdminJson(adminUrl);
  adminHttpStatus = adminRes.statusCode;
  if (adminRes.statusCode >= 200 && adminRes.statusCode < 300 && adminRes.raw && String(adminRes.raw).trim()) {
    try {
      const data = JSON.parse(adminRes.raw);
      list = extractModelsArray(data);
      if (list.length > 0) {
        listSource = 'admin';
      }
    } catch (e) {
      parseNote = `Resposta admin nao e JSON: ${e.message}`;
    }
  }

  if (list.length === 0) {
    const pubRes = await fetchWebsiteJson(publicUrl);
    publicHttpStatus = pubRes.statusCode;
    if (pubRes.statusCode >= 200 && pubRes.statusCode < 300 && pubRes.raw && String(pubRes.raw).trim()) {
      try {
        const data = JSON.parse(pubRes.raw);
        list = extractModelsArray(data);
        if (list.length > 0) {
          listSource = 'public';
        }
      } catch (e) {
        parseNote = parseNote || `Resposta publica nao e JSON: ${e.message}`;
      }
    }
  }

  return {
    list,
    listSource,
    adminHttpStatus,
    publicHttpStatus,
    parseNote,
    origin,
  };
}

/**
 * @returns {Promise<object>}
 */
async function runImportModelsFromWebsite(pool) {
  const {
    list: rawList,
    listSource,
    adminHttpStatus,
    publicHttpStatus,
    parseNote,
    origin,
  } = await loadWebsiteModelsList();

  const totalReceived = rawList.length;
  const imported = [];
  const skipped = [];
  const errors = [];

  if (totalReceived === 0) {
    const hint = [
      parseNote,
      adminHttpStatus === 401 ? 'Admin do site recusou token (401). Defina WEBSITE_ADMIN_TOKEN igual ao ADMIN_SECRET do site para listar com ids.' : null,
      publicHttpStatus != null && (publicHttpStatus < 200 || publicHttpStatus >= 300)
        ? `GET publico /api/models retornou HTTP ${publicHttpStatus}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
    errors.push({
      message: `Nenhum modelo na lista do site (${origin}). ${hint || 'Verifique WEBSITE_ORIGIN.'}`,
    });
    return {
      imported: 0,
      skipped: 0,
      total_received: 0,
      list_source: listSource,
      admin_http_status: adminHttpStatus,
      public_http_status: publicHttpStatus,
      imported_details: [],
      errors,
    };
  }

  for (const item of rawList) {
    const m = unwrapPublicModel(item);
    if (!m || typeof m !== 'object') {
      errors.push({ message: 'Item invalido na lista (nao objeto).' });
      continue;
    }

    let wid = parseWebsiteModelNumericId(m);
    const slug = str(m.slug || m.slug_site);

    if (wid == null && slug) {
      try {
        wid = await fetchPublicModelIdBySlug(slug);
      } catch (e) {
        errors.push({ slug, message: `Falha ao obter id por slug: ${e.message || String(e)}` });
        continue;
      }
    }

    if (wid == null || wid <= 0) {
      errors.push({
        slug: slug || undefined,
        name: str(m.name || m.nome),
        message:
          'ID numerico do modelo no site nao encontrado (lista sem id; use token admin ou slug valido em GET /api/models/:slug).',
      });
      continue;
    }

    const dup = await pool.query('SELECT id FROM modelos WHERE website_model_id = $1 LIMIT 1', [wid]);
    if (dup.rows.length > 0) {
      skipped.push(wid);
      continue;
    }

    const nome = str(m.name || m.nome) || slug || `Modelo #${wid}`;
    const flags = categoriesToFlags(m);
    const sexo = flags.catMasculino ? 'Masculino' : 'Feminino';
    const perfilSite = buildPerfilSite(m, slug);
    const med = mapMedidas(m);

    let cpf = null;
    for (let salt = 0; salt < 16; salt += 1) {
      const cand = cpfPlaceholderForWebsiteId(wid, salt);
      if (!cand) continue;
      const taken = await pool.query('SELECT id FROM modelos WHERE cpf = $1 LIMIT 1', [cand]);
      if (taken.rows.length === 0) {
        cpf = cand;
        break;
      }
    }
    if (!cpf) {
      errors.push({ website_model_id: wid, slug, message: 'Nao foi possivel gerar CPF placeholder unico.' });
      continue;
    }

    const email = `importado.site.${wid}@placeholder.crm`;
    const telefones = ['11999999999'];

    const body = {
      nome,
      cpf,
      telefone: telefones[0],
      email,
      telefones,
      emails: [email],
      chave_pix: '',
      banco_dados: '',
      emite_nf_propria: false,
      observacoes: `Importado automaticamente do site (${origin}) em ${new Date().toISOString().slice(0, 10)}. Completar CPF, contactos e dados reais.`,
      ativo: true,
      data_nascimento: '1990-01-01',
      formas_pagamento: [],
      origem_cadastro: 'importacao_site',
      status_cadastro: 'aprovado',
      sexo,
      ativo_site: websitePublicBool(m.active),
      website_model_id: wid,
      instagram: str(m.instagram),
      tiktok: str(m.tiktok),
      perfil_site: perfilSite,
      ...med,
    };

    try {
      const row = await insertModeloRow(pool, body);
      imported.push({ id: row.id, website_model_id: wid, nome });
    } catch (e) {
      const msg = e.code === '23505' ? 'CPF ou dado unico duplicado.' : e.message || String(e);
      errors.push({ website_model_id: wid, slug, message: msg });
    }
  }

  return {
    imported: imported.length,
    skipped: skipped.length,
    total_received: totalReceived,
    list_source: listSource,
    admin_http_status: adminHttpStatus,
    public_http_status: publicHttpStatus,
    imported_details: imported,
    errors,
  };
}

module.exports = { runImportModelsFromWebsite, loadWebsiteModelsList };
