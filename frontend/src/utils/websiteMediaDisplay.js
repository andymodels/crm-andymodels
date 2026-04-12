/**
 * Miniaturas e URLs de ficheiros do site institucional no CRM.
 * O browser resolve caminhos relativos contra o domínio do CRM — é preciso prefixar a origem pública do site.
 */

const DEFAULT_ORIGIN = 'https://www.andymodels.com';

export function getWebsitePublicOrigin() {
  const raw = import.meta.env.VITE_WEBSITE_ORIGIN;
  const s = raw != null && String(raw).trim() ? String(raw).trim() : DEFAULT_ORIGIN;
  return s.replace(/\/$/, '');
}

/** Garante https:// para parsing (Instagram/YouTube colados sem protocolo). */
export function normalizeHttpUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

/** Caminho relativo ou URL absoluta de asset do site → URL absoluta para <img src>. */
export function absolutizeWebsiteAssetUrl(u) {
  const t = String(u || '').trim();
  if (!t) return '';
  if (/^blob:/i.test(t) || /^data:/i.test(t)) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('//')) return `https:${t}`;
  const base = getWebsitePublicOrigin();
  return `${base}${t.startsWith('/') ? '' : '/'}${t}`;
}

/** ID de vídeo YouTube (watch, embed, shorts, youtu.be). */
export function extractYoutubeVideoId(u) {
  const str = String(u || '').trim();
  if (!str) return null;
  const withProto = normalizeHttpUrl(str);
  try {
    const url = new URL(withProto);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split(/[/?#]/)[0];
      return id ? id.slice(0, 11) : null;
    }
    if (!host.includes('youtube.com')) return null;
    const v = url.searchParams.get('v');
    if (v) return v.slice(0, 11);
    let m = url.pathname.match(/\/embed\/([^/?]+)/);
    if (m) return m[1].slice(0, 11);
    m = url.pathname.match(/\/shorts\/([^/?]+)/);
    if (m) return m[1].slice(0, 11);
    m = url.pathname.match(/\/live\/([^/?]+)/);
    if (m) return m[1].slice(0, 11);
  } catch {
    /* ignorar */
  }
  return null;
}

/** Miniatura estática do YouTube (nunca usar a URL da página /shorts ou /watch como <img src>). */
export function youtubePosterFromAnyUrl(u) {
  const id = extractYoutubeVideoId(u);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
}

/** URL de iframe embed do YouTube. */
export function youtubeEmbedFromUrl(u) {
  const id = extractYoutubeVideoId(u);
  return id ? `https://www.youtube.com/embed/${id}` : '';
}

/** Query string recomendada para iframes no site público (evita alguns casos de ecrã preto / reprodução bloqueada). */
export function youtubeEmbedQueryParams() {
  return 'rel=0&modestbranding=1&playsinline=1';
}

/** Vimeo: player embed (evitar usar URL da página como <video src>). */
export function vimeoEmbedFromUrl(u) {
  const str = String(u || '').trim();
  if (!str) return '';
  try {
    const url = new URL(normalizeHttpUrl(str));
    const host = url.hostname.replace(/^www\./, '');
    if (!host.includes('vimeo.com')) return '';
    const m = url.pathname.match(/\/(?:video\/)?(\d+)/);
    return m ? `https://player.vimeo.com/video/${m[1]}` : '';
  } catch {
    return '';
  }
}

/** iframe embed do Instagram (reel, reels, post, tv). */
export function instagramEmbedUrl(raw) {
  const s = normalizeHttpUrl(String(raw || '').trim());
  if (!s) return '';
  try {
    const url = new URL(s);
    if (!url.hostname.includes('instagram.com')) return '';
    let path = url.pathname.replace(/\/$/, '');
    path = path.replace(/^\/reels\//, '/reel/');
    if (path.endsWith('/embed')) return `https://www.instagram.com${path}`;
    if (!/\/(reel|p|tv)\//i.test(path)) return '';
    return `https://www.instagram.com${path}/embed`;
  } catch {
    return '';
  }
}

/** Ficheiro de vídeo hospedado (URL direta) — não usar como <img>. */
export function isDirectVideoFileUrl(u) {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u || ''));
}

export function isInstagramMediaUrl(u) {
  return /instagram\.com\/(reel|reels|p|tv|stories)\//i.test(String(u || ''));
}

/**
 * URL do perfil público no site institucional (nova aba no CRM).
 * `VITE_WEBSITE_MODEL_PATH` = segmento entre domínio e o slug (predef.: modelo → …/modelo/meu-slug).
 */
export function getWebsiteModelPublicUrl(slug) {
  const s = String(slug || '').trim();
  if (!s) return '';
  const base = getWebsitePublicOrigin();
  const segment = String(import.meta.env.VITE_WEBSITE_MODEL_PATH || 'modelo')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return `${base}/${segment}/${encodeURIComponent(s)}`;
}
