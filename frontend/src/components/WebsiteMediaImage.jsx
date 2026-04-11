import { useEffect, useState } from 'react';
import {
  absolutizeWebsiteAssetUrl,
  youtubePosterFromAnyUrl,
} from '../utils/websiteMediaDisplay';

function absolutizePair(url, thumb) {
  const u = absolutizeWebsiteAssetUrl(String(url || '').trim());
  const th = absolutizeWebsiteAssetUrl(String(thumb || '').trim());
  return { url: u || th, thumb: th || u };
}

/**
 * Ordem: thumb → url. Caminhos relativos do site são absolutizados para o domínio público (VITE_WEBSITE_ORIGIN).
 * Vídeo: URLs de embed do YouTube não servem como <img>; usa-se poster do YouTube quando não há thumb.
 */
export function mediaItemThumbOrUrl(item) {
  if (item == null) return { thumb: '', url: '', primary: '' };
  if (typeof item === 'string') {
    const s = absolutizeWebsiteAssetUrl(String(item).trim());
    return { thumb: '', url: s, primary: s };
  }
  const type = item.type != null ? String(item.type).trim() : 'image';
  let thumb = item.thumb != null ? String(item.thumb).trim() : '';
  let url = item.url != null ? String(item.url).trim() : '';

  if (type === 'video' && !thumb) {
    thumb = youtubePosterFromAnyUrl(url) || '';
  }

  thumb = absolutizeWebsiteAssetUrl(thumb);
  url = absolutizeWebsiteAssetUrl(url);

  const primary = thumb || url;
  return { thumb, url, primary };
}

export function WebsiteMediaImg({ item, className = '', alt = '', ...rest }) {
  const { primary, thumb, url } = mediaItemThumbOrUrl(item);
  const [src, setSrc] = useState(primary);
  useEffect(() => {
    setSrc(primary);
  }, [primary]);

  if (!primary) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        if (thumb && url && src === thumb) setSrc(url);
      }}
      {...rest}
    />
  );
}

/**
 * Mesma lógica do site (ModelPage): se `media` tem itens, usa-os; senão
 * monta a partir de `cover_image` + `images` (URLs planas → objetos tipo imagem).
 */
export function buildMediaItems(model) {
  if (!model || typeof model !== 'object') return [];
  if (Array.isArray(model.media) && model.media.length > 0) {
    return model.media
      .map((entry) => {
        if (typeof entry === 'string') {
          const url = entry.trim();
          if (!url) return null;
          const abs = absolutizeWebsiteAssetUrl(url);
          return { type: 'image', url: abs, thumb: abs };
        }
        if (entry && typeof entry === 'object') {
          const rawUrl = entry.url != null ? String(entry.url).trim() : '';
          const rawThumb = entry.thumb != null ? String(entry.thumb).trim() : '';
          const type = entry.type != null ? String(entry.type).trim() : 'image';
          if (!rawUrl && !rawThumb) return null;
          const pair = absolutizePair(rawUrl || rawThumb, rawThumb || rawUrl);
          return {
            type: type || 'image',
            url: pair.url,
            thumb: pair.thumb,
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  const rest = [model.cover_image, ...(Array.isArray(model.images) ? model.images : [])]
    .filter(Boolean)
    .map((u) => String(u).trim())
    .filter(Boolean);
  return rest.map((u) => {
    const abs = absolutizeWebsiteAssetUrl(u);
    return { type: 'image', url: abs, thumb: abs };
  });
}

/**
 * URL para o cartão da listagem (miniatura): igual ao site — thumb depois url do primeiro `image`.
 * @deprecated Preferir `buildMediaItems` + lógica explícita no cartão
 */
export function firstMediaEntry(model) {
  const mediaItems = buildMediaItems(model);
  return mediaItems.find((m) => m.type === 'image') || null;
}
