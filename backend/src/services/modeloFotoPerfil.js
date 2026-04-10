/**
 * Foto de perfil do modelo: Sharp (igual ao pipeline comentado em os_documentos) + storage.saveFile.
 * O campo na BD continua a chamar-se foto_perfil_base64; o valor gravado passa a ser URL pública (getPublicUrl).
 */

const crypto = require('crypto');
const sharp = require('sharp');
const storage = require('./storage');

/** Valor final na BD: só URL http(s); data:image ou base64 puro → vazio. */
function fotoPerfilOnlyUrlForDb(value) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  if (/^data:image\//i.test(s)) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

function decodeIncoming(raw) {
  const t = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!t) return { kind: 'empty' };
  if (/^https?:\/\//i.test(t)) return { kind: 'url', url: t };
  const m = /^data:image\/[^;]+;base64,(.+)$/i.exec(t);
  if (m) {
    try {
      const buffer = Buffer.from(m[1], 'base64');
      if (!buffer.length) return { kind: 'invalid' };
      return { kind: 'buffer', buffer };
    } catch {
      return { kind: 'invalid' };
    }
  }
  try {
    const buffer = Buffer.from(t, 'base64');
    if (!buffer.length) return { kind: 'invalid' };
    return { kind: 'buffer', buffer };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Mesmo pipeline que o exemplo em os_documentos (rotate, resize máx. 2000, JPEG). */
async function processModeloFotoPerfilBuffer(inputBuffer) {
  return sharp(inputBuffer)
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

async function maybeRemoveStoredFoto(storedUrl) {
  const rel = storage.relativePathFromPublicUrl(storedUrl);
  if (rel) await storage.removeFile(rel).catch(() => {});
}

/**
 * Criação de modelo: base64/data URL → ficheiro + URL pública; URL já gravada → mantém; vazio → ''.
 */
async function persistModeloFotoPerfil(raw) {
  const dec = decodeIncoming(raw);
  if (dec.kind === 'empty') return fotoPerfilOnlyUrlForDb('');
  if (dec.kind === 'url') return fotoPerfilOnlyUrlForDb(dec.url);
  if (dec.kind !== 'buffer') {
    throw new Error('Foto de perfil invalida.');
  }
  let buf;
  try {
    buf = await processModeloFotoPerfilBuffer(dec.buffer);
  } catch {
    throw new Error('Foto de perfil invalida ou corrompida.');
  }
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  const relativePath = `modelos/${name}`;
  await storage.saveFile({
    buffer: buf,
    relativePath,
    contentType: 'image/jpeg',
  });
  console.log(relativePath);
  const url = storage.getPublicUrl(relativePath);
  console.log(url);
  return fotoPerfilOnlyUrlForDb(url);
}

/**
 * Edição: substitui ficheiro quando há novo upload; remove anterior se URL mudou; vazio remove foto.
 */
async function replaceModeloFotoPerfil(raw, previousStored) {
  const prev = String(previousStored || '').trim();
  const dec = decodeIncoming(raw);
  if (dec.kind === 'empty') {
    await maybeRemoveStoredFoto(prev);
    return fotoPerfilOnlyUrlForDb('');
  }
  if (dec.kind === 'url') {
    if (dec.url !== prev && prev) await maybeRemoveStoredFoto(prev);
    return fotoPerfilOnlyUrlForDb(dec.url);
  }
  if (dec.kind !== 'buffer') {
    throw new Error('Foto de perfil invalida.');
  }
  let buf;
  try {
    buf = await processModeloFotoPerfilBuffer(dec.buffer);
  } catch {
    throw new Error('Foto de perfil invalida ou corrompida.');
  }
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  const relativePath = `modelos/${name}`;
  await storage.saveFile({
    buffer: buf,
    relativePath,
    contentType: 'image/jpeg',
  });
  const newUrl = storage.getPublicUrl(relativePath);
  if (prev && newUrl !== prev) await maybeRemoveStoredFoto(prev);
  return fotoPerfilOnlyUrlForDb(newUrl);
}

async function removeStoredModeloFotoIfAny(storedValue) {
  await maybeRemoveStoredFoto(storedValue);
}

module.exports = {
  persistModeloFotoPerfil,
  replaceModeloFotoPerfil,
  removeStoredModeloFotoIfAny,
};
