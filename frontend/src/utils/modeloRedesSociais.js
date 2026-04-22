import { normalizeHttpUrl } from './websiteMediaDisplay';

const IG_PREFIX = 'https://www.instagram.com/';
const TT_PREFIX = 'https://www.tiktok.com/@';

/** Extrai o nome de utilizador para o campo «só username» a partir do valor guardado. */
export function instagramUsernameFromStored(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^@/, '');
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`);
    if (!u.hostname.replace(/^www\./, '').includes('instagram.com')) return s;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    const reserved = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore']);
    if (reserved.has(parts[0].toLowerCase())) return s;
    return parts[0] || '';
  } catch {
    return s;
  }
}

/** Guarda URL normalizada (prefixo oficial + username ou URL completa). */
export function instagramUrlFromUsername(username) {
  const raw = String(username || '')
    .trim()
    .replace(/^@/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.hostname.replace(/^www\./, '').includes('instagram.com')) {
        u.hash = '';
        let path = u.pathname || '/';
        if (path !== '/' && path.length > 1) path = path.replace(/\/$/, '');
        return `https://www.instagram.com${path}${u.search || ''}`;
      }
      return raw;
    } catch {
      return raw;
    }
  }
  const bare = raw
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\/?/i, '')
    .split(/[/?#]/)[0];
  if (!bare) return '';
  if (!/^[\w.]+$/.test(bare)) return '';
  return `${IG_PREFIX}${bare}`;
}

/** Valor para o formulário a partir da BD ou API. */
export function instagramDisplayFromStored(raw) {
  const u = instagramUsernameFromStored(raw);
  if (u && !/^https?:\/\//i.test(u)) {
    const built = instagramUrlFromUsername(u);
    if (built) return built;
  }
  const s = String(raw || '').trim();
  if (!s) return '';
  return instagramUrlFromUsername(s) || s;
}

export function tiktokUsernameFromStored(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^@/, '');
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`);
    if (!u.hostname.replace(/^www\./, '').includes('tiktok.com')) return s;
    const parts = u.pathname.split('/').filter(Boolean);
    const first = parts[0] || '';
    if (first.toLowerCase() === 'v' || first.toLowerCase() === 't' || first.includes('video')) return s;
    if (first.startsWith('@')) return first.slice(1);
    return first || s;
  } catch {
    return s;
  }
}

export function tiktokUrlFromUsername(username) {
  const t = String(username || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^(https?:\/\/)?(www\.)?tiktok\.com\/@?/i, '');
  if (!t) return '';
  const bare = t.split(/[/?#]/)[0];
  if (!bare) return '';
  return `${TT_PREFIX}${bare}`;
}

/** Canal / perfil YouTube (não confundir com URL de vídeo da galeria). */
export function youtubeCanalNormalize(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      u.hash = '';
      return u.toString().replace(/\/$/, '');
    } catch {
      return s.slice(0, 2000);
    }
  }
  if (/^[\w-]{3,}\/?$/i.test(s) && !s.includes('.')) {
    return `https://www.youtube.com/@${s.replace(/^@/, '').replace(/\/$/, '')}`;
  }
  return normalizeHttpUrl(s).replace(/\/$/, '');
}

export function outrasRedesSociaisSanitizeList(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((x) => x.slice(0, 800));
}

export function outrasRedesSociaisToFormList(row, perfil) {
  const raw = row?.outras_redes_sociais ?? perfil?.outras_redes_sociais;
  if (Array.isArray(raw)) {
    const list = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    return list.length ? list : [''];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const o = JSON.parse(raw);
      if (Array.isArray(o)) {
        const list = o.map((x) => String(x ?? '').trim()).filter(Boolean);
        return list.length ? list : [''];
      }
    } catch {
      return [raw.trim()];
    }
  }
  return [''];
}
