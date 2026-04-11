import { useEffect, useState } from 'react';

/**
 * URLs exatamente como vêm do backend (B2). Sem replace, sem paths locais.
 * Ordem: `thumb` se existir, senão `url`. Em caso de erro ao carregar `thumb`, tenta `url`.
 */
export function mediaItemThumbOrUrl(item) {
  if (item == null) return { thumb: '', url: '', primary: '' };
  if (typeof item === 'string') {
    const s = String(item).trim();
    return { thumb: '', url: s, primary: s };
  }
  const thumb = item.thumb != null ? String(item.thumb).trim() : '';
  const url = item.url != null ? String(item.url).trim() : '';
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
          return { type: 'image', url, thumb: url };
        }
        if (entry && typeof entry === 'object') {
          const url = entry.url != null ? String(entry.url).trim() : '';
          const thumb = entry.thumb != null ? String(entry.thumb).trim() : '';
          const type = entry.type != null ? String(entry.type).trim() : 'image';
          if (!url && !thumb) return null;
          return {
            type: type || 'image',
            url: url || thumb,
            thumb: thumb || url,
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
  return rest.map((url) => ({ type: 'image', url, thumb: url }));
}

/**
 * URL para o cartão da listagem (miniatura): igual ao site — thumb depois url do primeiro `image`.
 * @deprecated Preferir `buildMediaItems` + lógica explícita no cartão
 */
export function firstMediaEntry(model) {
  const mediaItems = buildMediaItems(model);
  return mediaItems.find((m) => m.type === 'image') || null;
}
