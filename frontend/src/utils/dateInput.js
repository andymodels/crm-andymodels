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
