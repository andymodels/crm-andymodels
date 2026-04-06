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

export function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), API_REQUEST_MS);
  return fetch(url, { credentials: 'include', ...options, signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

export function throwIfHtmlOrCannotPost(raw, httpStatus) {
  const t = String(raw || '');
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
