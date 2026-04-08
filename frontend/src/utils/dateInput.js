/**
 * Valor seguro para `<input type="date" />`: só `YYYY-MM-DD` ou vazio.
 * Evita valores inválidos e reduz bugs quando o backend manda ISO com hora ou o estado vem inconsistente.
 */
export function toDateInputValue(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '';
    const y = raw.getUTCFullYear();
    const m = raw.getUTCMonth() + 1;
    const d = raw.getUTCDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return '';
}

/**
 * Valor seguro para `<input type="time" />`: `HH:MM` ou vazio (texto livre antigo não combina com o picker).
 */
export function toTimeInputValue(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m) {
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\s*h\s*(\d{0,2})/i);
  if (m) {
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min =
      m[2] !== '' && m[2] != null ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return '';
}
