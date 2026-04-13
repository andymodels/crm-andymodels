/**
 * Capa oficial a partir de metadados (artista + título): iTunes Search API → Deezer API público.
 * Sem cache em memória — cada chamada faz pedidos HTTP novos.
 */

function externalCoverEnabled() {
  const v = String(process.env.RADIO_COVER_EXTERNAL || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * Descarrega bytes JPEG/PNG de uma arte encontrada (iTunes primeiro, depois Deezer).
 * @returns {Promise<Buffer|null>}
 */
async function fetchOfficialArtworkBuffer(artist, title) {
  if (!externalCoverEnabled()) return null;
  const a = String(artist || '').trim();
  const t = String(title || '').trim();
  if (a.length + t.length < 2) return null;

  const fromItunes = await fetchArtworkBufferFromItunes(a, t);
  if (fromItunes && fromItunes.length > 0) return fromItunes;

  const fromDeezer = await fetchArtworkBufferFromDeezer(a, t);
  if (fromDeezer && fromDeezer.length > 0) return fromDeezer;

  return null;
}

async function fetchArtworkBufferFromItunes(artist, title) {
  try {
    const term = `${artist} ${title}`.trim().slice(0, 200);
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=15&country=US`;
    const r = await fetch(url, { headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const results = Array.isArray(j.results) ? j.results : [];
    for (const item of results) {
      let art = item.artworkUrl100 || item.artworkUrl60 || item.artworkUrl30;
      if (!art || typeof art !== 'string') continue;
      art = art
        .replace(/100x100bb/gi, '600x600bb')
        .replace(/60x60bb/gi, '600x600bb')
        .replace(/30x30bb/gi, '600x600bb');
      const imgR = await fetch(art, { redirect: 'follow', headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
      if (!imgR.ok) continue;
      const ab = await imgR.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length > 500) return buf;
    }
  } catch (e) {
    console.warn('[radio/external] iTunes:', e?.message || e);
  }
  return null;
}

async function fetchArtworkBufferFromDeezer(artist, title) {
  try {
    const q = `${artist} ${title}`.trim().slice(0, 200);
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`;
    const r = await fetch(url, { headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const data = Array.isArray(j.data) ? j.data : [];
    for (const item of data) {
      const cover =
        item?.album?.cover_xl || item?.album?.cover_big || item?.album?.cover_medium || item?.album?.cover;
      if (!cover || typeof cover !== 'string') continue;
      const imgR = await fetch(cover, { redirect: 'follow', headers: { 'User-Agent': 'AndyModels-CRM-Radio/1.0' } });
      if (!imgR.ok) continue;
      const ab = await imgR.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length > 500) return buf;
    }
  } catch (e) {
    console.warn('[radio/external] Deezer:', e?.message || e);
  }
  return null;
}

module.exports = {
  externalCoverEnabled,
  fetchOfficialArtworkBuffer,
};
