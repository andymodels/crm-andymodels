/**
 * Chaves de objecto uniformes para Andy Radio no storage (local ou B2):
 * radio/{timestamp}-{uuid}{ext}
 *
 * Na BD continua-se a guardar o caminho relativo (chave no bucket) para áudio;
 * capas usam URL pública completa via storage.getPublicUrl.
 */

const crypto = require('crypto');

/**
 * @param {string} ext — ex.: ".mp3", ".jpg", ".png"
 * @returns {string} caminho relativo tipo radio/1739…-uuid….mp3
 */
function radioStorageKey(ext) {
  let e = String(ext || '').toLowerCase();
  if (!e.startsWith('.')) e = e ? `.${e}` : '';
  if (!e) e = '.bin';
  return `radio/${Date.now()}-${crypto.randomUUID()}${e}`;
}

module.exports = { radioStorageKey };
