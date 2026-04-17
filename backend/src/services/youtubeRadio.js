/**
 * Andy Radio (CRM): links YouTube — extrair ID e URL de capa oficial (hqdefault).
 * Sem upload nem B2 para o áudio; capa é URL pública i.ytimg.com.
 */

const YT_ID_RE = /[a-zA-Z0-9_-]{11}/;

/**
 * @param {string} raw
 * @returns {string | null}
 */
function extractYoutubeVideoId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const tryFromUrl = (href) => {
    try {
      const u = new URL(href);
      const host = u.hostname.replace(/^www\./i, '').toLowerCase();

      if (host === 'youtu.be') {
        const seg = u.pathname.replace(/^\//, '').split('/')[0] || '';
        return YT_ID_RE.test(seg) ? seg.match(YT_ID_RE)[0] : null;
      }

      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        const v = u.searchParams.get('v');
        if (v && YT_ID_RE.test(v)) return v.match(YT_ID_RE)[0];

        const parts = u.pathname.split('/').filter(Boolean);
        const shortsIdx = parts.indexOf('shorts');
        if (shortsIdx >= 0 && parts[shortsIdx + 1] && YT_ID_RE.test(parts[shortsIdx + 1])) {
          return parts[shortsIdx + 1].match(YT_ID_RE)[0];
        }
        const embedIdx = parts.indexOf('embed');
        if (embedIdx >= 0 && parts[embedIdx + 1] && YT_ID_RE.test(parts[embedIdx + 1])) {
          return parts[embedIdx + 1].match(YT_ID_RE)[0];
        }
        const liveIdx = parts.indexOf('live');
        if (liveIdx >= 0 && parts[liveIdx + 1] && YT_ID_RE.test(parts[liveIdx + 1])) {
          return parts[liveIdx + 1].match(YT_ID_RE)[0];
        }
      }
    } catch {
      /* */
    }
    return null;
  };

  if (/^https?:\/\//i.test(s)) {
    const id = tryFromUrl(s);
    if (id) return id;
  } else {
    const id = tryFromUrl(`https://${s}`);
    if (id) return id;
  }

  const loose = s.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (loose && loose[1]) return loose[1];

  return null;
}

/**
 * @param {string} videoId
 * @returns {string}
 */
function youtubeThumbnailHqUrl(videoId) {
  const id = String(videoId || '').trim();
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * Metadados públicos via oEmbed (sem API key): título do vídeo e nome do canal (`author_name`).
 * Vídeos privados / restritos podem falhar — nesse caso devolve null.
 *
 * @param {string} videoId
 * @returns {Promise<{ title: string, author_name: string } | null>}
 */
async function fetchYoutubeOEmbedMeta(videoId) {
  const id = String(videoId || '').trim();
  if (!id) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const title = data.title != null ? String(data.title).trim() : '';
    const authorName = data.author_name != null ? String(data.author_name).trim() : '';
    if (!title && !authorName) return null;
    return {
      title: title || '',
      author_name: authorName || '',
    };
  } catch (e) {
    console.warn('[radio/youtube] oEmbed:', e?.message || e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  extractYoutubeVideoId,
  youtubeThumbnailHqUrl,
  fetchYoutubeOEmbedMeta,
};
