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

/** Primeiro elemento de `model.media` (apenas para cartão da listagem). */
export function firstMediaEntry(model) {
  const arr = model && typeof model === 'object' && Array.isArray(model.media) ? model.media : [];
  return arr.length > 0 ? arr[0] : null;
}
