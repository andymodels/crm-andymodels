import {
  absolutizeWebsiteAssetUrl,
  normalizeHttpUrl,
  youtubeEmbedFromUrl,
  youtubeEmbedQueryParams,
  instagramEmbedUrl,
  vimeoEmbedFromUrl,
  isDirectVideoFileUrl,
  isInstagramMediaUrl,
} from '../utils/websiteMediaDisplay';
import { WebsiteMediaImg, mediaItemThumbOrUrl } from './WebsiteMediaImage';

/**
 * Conteúdo de vídeo para dentro de um pai `relative` com `aspect-ratio` (grelha do CRM).
 * Reutilizar a mesma lógica na página pública do site.
 *
 * Ecrã preto no front: quase sempre <video> ou <img> com URL de página YouTube/Instagram.
 * Usar iframe só para YouTube/Vimeo; Instagram → link (embed em iframe falha fora do Instagram).
 */
export default function WebsitePublicVideoEmbed({ url, item = null }) {
  const u = String(url || '').trim();
  const ytBase = youtubeEmbedFromUrl(u);
  const vm = vimeoEmbedFromUrl(u);
  const igEmb = instagramEmbedUrl(u);
  const directVid = isDirectVideoFileUrl(u);

  if (ytBase) {
    const src = `${ytBase}${ytBase.includes('?') ? '&' : '?'}${youtubeEmbedQueryParams()}`;
    return (
      <iframe
        title="YouTube"
        src={src}
        className="absolute inset-0 h-full w-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  if (vm) {
    const src = `${vm}${vm.includes('?') ? '&' : '?'}title=0&byline=0&portrait=0`;
    return (
      <iframe
        title="Vimeo"
        src={src}
        className="absolute inset-0 h-full w-full border-0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  if (igEmb) {
    const openIg = normalizeHttpUrl(u) || u;
    return (
      <a
        href={openIg}
        target="_blank"
        rel="noopener noreferrer"
        title={openIg}
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-purple-700 via-pink-600 to-amber-500 px-1.5 py-2 text-center text-white shadow-inner hover:opacity-95"
      >
        <span className="text-xs font-semibold">Instagram ↗</span>
        <span className="max-h-[40%] w-full overflow-hidden break-all text-left text-[9px] font-normal leading-tight text-white/95">
          {openIg}
        </span>
      </a>
    );
  }

  if (directVid) {
    return (
      <video
        src={absolutizeWebsiteAssetUrl(u)}
        className="absolute inset-0 h-full w-full object-cover object-top"
        controls
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  const { primary: thumbPrimary } = mediaItemThumbOrUrl(item || {});
  if (thumbPrimary && item) {
    return (
      <WebsiteMediaImg
        item={item}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
    );
  }

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center px-2 text-center text-xs font-semibold text-white shadow-inner ${
        isInstagramMediaUrl(u) ? 'bg-gradient-to-br from-purple-700 via-pink-600 to-amber-500' : 'bg-slate-600'
      }`}
    >
      {isInstagramMediaUrl(u) ? 'Instagram' : 'Vídeo'}
    </div>
  );
}
