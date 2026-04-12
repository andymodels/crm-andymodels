const rawApi = import.meta.env.VITE_API_URL;
const trimmed =
  rawApi !== undefined && rawApi !== null ? String(rawApi).trim() : '';
const DEV_PROXY_PORT = import.meta.env.VITE_DEV_PROXY_PORT || '3030';

const useViteProxy =
  import.meta.env.DEV &&
  (trimmed === '' ||
    trimmed === `http://localhost:${DEV_PROXY_PORT}` ||
    trimmed === `http://127.0.0.1:${DEV_PROXY_PORT}` ||
    trimmed === 'http://localhost:3001' ||
    trimmed === 'http://127.0.0.1:3001' ||
    trimmed === 'http://localhost:3002' ||
    trimmed === 'http://127.0.0.1:3002');
const API_URL = useViteProxy
  ? ''
  : trimmed !== ''
    ? trimmed.replace(/\/$/, '')
    : '';

/** Rotas Express montadas em `/api` (ver backend/src/app.js). */
export const API_BASE = API_URL ? `${API_URL}/api` : '/api';

export const API_REQUEST_MS = 25_000;
/** Upload em lote (ex.: vários MP3 na Rádio) — o servidor pode demorar minutos; 25s cortava o pedido com «Fetch is aborted». */
export const API_REQUEST_MS_BULK = 10 * 60 * 1000;

export function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { credentials: 'include', ...options, signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

/**
 * Rotas protegidas do CRM: envia cookie de sessão (`credentials: 'include'`) como o resto da app.
 * Opcional: `sessionStorage.crm_api_token` com JWT para `Authorization: Bearer` (ex.: domínio sem cookie).
 * Opcional: `timeoutMs` — tempo máximo antes de abortar (predef.: API_REQUEST_MS). Uploads grandes: usar API_REQUEST_MS_BULK.
 */
export function fetchWithAuth(url, options = {}) {
  const { timeoutMs, ...rest } = options;
  const headers = new Headers(rest.headers ?? {});
  try {
    if (typeof sessionStorage !== 'undefined') {
      const t = sessionStorage.getItem('crm_api_token');
      if (t && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${String(t).trim()}`);
    }
  } catch {
    /* ignore */
  }
  const ms = timeoutMs != null ? Number(timeoutMs) : API_REQUEST_MS;
  return fetchWithTimeout(
    url,
    {
      ...rest,
      headers,
      credentials: 'include',
    },
    ms,
  );
}

export function throwIfHtmlOrCannotPost(raw, httpStatus) {
  const t = String(raw || '');
  const trimmed = t.trim();
  /** JSON válido (erros da API, proxy do site) pode conter `<` dentro de `message` — não tratar como página HTML. */
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return;
    } catch {
      /* continuar: não era JSON completo */
    }
  }
  if (!t.includes('<') && !/cannot\s+post/i.test(t)) return;
  const m = t.match(/Cannot POST\s+([^\s<]+)/i);
  if (m) {
    throw new Error(
      `A porta do backend não é a deste CRM (pedido ${m[1]} foi recusado). Feche o outro programa nessa porta ou alinhe PORT no backend/.env com VITE_DEV_PROXY_PORT no frontend/.env e reinicie.`,
    );
  }
  throw new Error(
    `Resposta inválida (HTML) do servidor (HTTP ${httpStatus}). Confirme que corre "npm run dev" na pasta backend deste projeto.`,
  );
}
