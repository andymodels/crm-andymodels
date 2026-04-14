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

/** Nomes como gravados no CRM (`GET …/api/public/radio` ou playlist no CRM). */
export function curatorDisplay(playlist) {
  if (!playlist || typeof playlist !== 'object') {
    return { name: '', instagramUrl: '' };
  }
  return {
    name: String(playlist.curator_name ?? '').trim(),
    instagramUrl: String(playlist.curator_instagram ?? '').trim(),
  };
}

/** Há curador para mostrar (evitar bloco vazio no layout). */
export function hasCuratorInPlaylist(playlist) {
  return curatorDisplay(playlist).name.length > 0;
}
