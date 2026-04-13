/**
 * Helpers para o front do andymodels.com (copiar para o projeto do site).
 * GET {CRM}/api/public/radio ou /api/public/radio/v2 — mesmo corpo JSON.
 *
 * Sempre que possível:
 *   fetch(url, { cache: 'no-store', credentials: 'omit' })
 * e evitar dados estáticos hardcoded da rádio.
 */

/** Capa da playlist: o CRM devolve `playlist_cover_url` e `cover_url` (iguais). */
export function playlistCoverArtUrl(playlist) {
  if (!playlist || typeof playlist !== 'object') return null;
  const u = playlist.playlist_cover_url ?? playlist.cover_url;
  if (u == null || String(u).trim() === '') return null;
  return String(u).trim();
}

/** Texto e link do curador (strings; vazio → o site decide o que mostrar). */
export function curatorDisplay(playlist) {
  if (!playlist || typeof playlist !== 'object') {
    return { name: '', instagramUrl: '' };
  }
  return {
    name: String(playlist.curator_name ?? '').trim(),
    instagramUrl: String(playlist.curator_instagram ?? '').trim(),
  };
}
