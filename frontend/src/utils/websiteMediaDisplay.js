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

/** Miniatura estática do YouTube a partir de qualquer URL YouTube/embed. */
export function youtubePosterFromAnyUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  let m = s.match(/youtube\.com\/embed\/([^?&/]+)/i);
  if (m) return `https://img.youtube.com/vi/${m[1].slice(0, 11)}/hqdefault.jpg`;
  m = s.match(/youtu\.be\/([^?&/]+)/i);
  if (m) return `https://img.youtube.com/vi/${m[1].slice(0, 11)}/hqdefault.jpg`;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, '')}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').slice(0, 11);
      return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
    }
    if (host.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return `https://img.youtube.com/vi/${v.slice(0, 11)}/hqdefault.jpg`;
      const embed = url.pathname.match(/\/embed\/([^/?]+)/);
      if (embed) return `https://img.youtube.com/vi/${embed[1].slice(0, 11)}/hqdefault.jpg`;
    }
  } catch {
    /* ignorar */
  }
  return '';
}

export function isInstagramMediaUrl(u) {
  return /instagram\.com\/(reel|p|tv|stories)\//i.test(String(u || ''));
}
