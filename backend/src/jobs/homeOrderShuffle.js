/**
 * Embaralha automaticamente a ordem dos modelos da categoria «home» no site (PUT home_order / campo detetado).
 * Sem UI: corre em background no processo da API (setInterval).
 *
 * Variáveis:
 * - HOME_ORDER_SHUFFLE_ENABLED — «1»/«true» (defeito) ou «0»/«false» para desligar
 * - HOME_ORDER_SHUFFLE_INTERVAL_MS — intervalo em ms (defeito: 2 horas)
 * - HOME_ORDER_SHUFFLE_FIRST_DELAY_MS — atraso antes da 1.ª execução (defeito: 90s)
 */

const https = require('https');

const ORDER_FIELD_CANDIDATES = [
  'home_order',
  'featured_order',
  'order',
  'sort_order',
  'position',
  'display_order',
];

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

function extractWebsiteModelsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.models)) return data.models;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.rows)) return data.rows;
  }
  return [];
}

function strLower(v) {
  return String(v ?? '').trim().toLowerCase();
}

/** Alinhado ao CRM WebsiteHomeOrderPage: category/categoria home, categories, home_order≥1, featured. */
function isHomeCategoryModel(m) {
  if (!m || typeof m !== 'object') return false;
  if (strLower(m.category) === 'home' || strLower(m.categoria) === 'home') return true;
  const lists = [m.categories, m.categorias].filter(Array.isArray);
  for (const arr of lists) {
    if (arr.some((x) => strLower(x) === 'home')) return true;
  }
  const ho = Number(m.home_order);
  if (Number.isFinite(ho) && ho >= 1) return true;
  if (m.featured === true || m.featured === 1 || m.featured === '1') return true;
  if (m.destaque_home === true || m.destaque_home === 1 || m.destaque_home === '1') return true;
  return false;
}

/** Modelos da grelha «home»: categoria `home` (ou `categories` contém «home»). */
function isHomeGridModel(m) {
  return isHomeCategoryModel(m);
}

function detectOrderField(sample) {
  if (!sample || typeof sample !== 'object') return 'home_order';
  if (Object.prototype.hasOwnProperty.call(sample, 'home_order')) return 'home_order';
  for (const k of ORDER_FIELD_CANDIDATES) {
    if (k === 'home_order') continue;
    if (Object.prototype.hasOwnProperty.call(sample, k) && sample[k] != null && String(sample[k]).trim() !== '') {
      return k;
    }
  }
  return 'home_order';
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function envBool(name, defaultTrue) {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (v === '' || v === undefined) return defaultTrue;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultTrue;
}

function parseIntervalMs(fallback) {
  const n = Number(String(process.env.HOME_ORDER_SHUFFLE_INTERVAL_MS || '').trim());
  return Number.isFinite(n) && n >= 60_000 ? n : fallback;
}

function parseFirstDelayMs(fallback) {
  const n = Number(String(process.env.HOME_ORDER_SHUFFLE_FIRST_DELAY_MS || '').trim());
  return Number.isFinite(n) && n >= 5_000 ? n : fallback;
}

async function runHomeOrderShuffleOnce() {
  const token = websiteAdminBearerToken();
  if (!token) {
    console.warn('[home-shuffle] ignorado: sem WEBSITE_ADMIN_TOKEN / WEBSITE_ADMIN_API_KEY / ADMIN_SECRET.');
    return;
  }

  const listUrl = `${getWebsiteOrigin()}/api/admin/models?limit=500`;
  const { statusCode, raw } = await fetchWebsiteAdminJson(listUrl);
  if (statusCode === 401) {
    console.warn('[home-shuffle] ignorado: website devolveu 401 (Bearer).');
    return;
  }
  if (statusCode < 200 || statusCode >= 300) {
    console.warn(`[home-shuffle] falha ao listar modelos: HTTP ${statusCode}`);
    return;
  }

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    console.warn('[home-shuffle] resposta do site não é JSON.');
    return;
  }

  const arr = extractWebsiteModelsArray(parsed);
  const homeModels = arr.filter(isHomeGridModel);
  if (homeModels.length < 2) {
    console.log(
      `[home-shuffle] sem ação: ${homeModels.length} modelo(s) na categoria «home» (mín. 2 para embaralhar).`,
    );
    return;
  }

  const field = detectOrderField(homeModels[0]);
  shuffleInPlace(homeModels);

  let ok = 0;
  for (let i = 0; i < homeModels.length; i += 1) {
    const m = homeModels[i];
    const id = m?.id;
    if (id == null) continue;
    const body = {
      featured: '1',
      [field]: i + 1,
    };
    const url = `${getWebsiteOrigin()}/api/admin/models/${encodeURIComponent(String(id))}`;
    const r = await websiteJsonRequest('PUT', url, body);
    if (r.statusCode >= 200 && r.statusCode < 300) {
      ok += 1;
    } else {
      console.warn(`[home-shuffle] PUT modelo ${id} falhou: HTTP ${r.statusCode}`);
    }
  }

  console.log(`[home-shuffle] ordem aleatória aplicada: ${ok}/${homeModels.length} modelos (campo ${field}).`);
}

let intervalId = null;
let firstTimer = null;

function startHomeOrderShuffle() {
  if (!envBool('HOME_ORDER_SHUFFLE_ENABLED', true)) {
    console.log('[home-shuffle] desativado (HOME_ORDER_SHUFFLE_ENABLED=0).');
    return;
  }

  const intervalMs = parseIntervalMs(2 * 60 * 60 * 1000);
  const firstDelayMs = parseFirstDelayMs(90_000);

  const tick = () => {
    runHomeOrderShuffleOnce().catch((e) => {
      console.warn('[home-shuffle] erro:', e?.message || e);
    });
  };

  console.log(
    `[home-shuffle] ativo: primeira execução em ${Math.round(firstDelayMs / 1000)}s, depois a cada ${Math.round(intervalMs / 60000)} min.`,
  );

  firstTimer = setTimeout(() => {
    tick();
    intervalId = setInterval(tick, intervalMs);
  }, firstDelayMs);
}

module.exports = { startHomeOrderShuffle, runHomeOrderShuffleOnce };
