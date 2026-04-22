/**
 * Extrai primeira chave Pix útil de `formas_pagamento` (JSONB cadastros)
 * ou do campo legado `chave_pix` do modelo.
 */

function firstPixFromFormasArray(formas) {
  const arr = Array.isArray(formas) ? formas : [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const tipo = item.tipo === 'Conta bancária' ? 'Conta bancária' : 'PIX';
    if (tipo !== 'PIX') continue;
    const tipoChave = String(item.tipo_chave_pix || 'CPF').trim() || 'CPF';
    const chave = String(item.chave_pix ?? item.valor ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (chave) {
      return {
        forma_pagamento: 'PIX',
        destino_pagamento: `${tipoChave}: ${chave}`,
      };
    }
  }
  return null;
}

function suggestFromModeloRow(row) {
  if (!row) return null;
  const fromFormas = firstPixFromFormasArray(row.formas_pagamento);
  if (fromFormas) return fromFormas;
  const leg = String(row.chave_pix || '').trim();
  if (leg) {
    return { forma_pagamento: 'PIX', destino_pagamento: `Chave: ${leg}` };
  }
  return null;
}

function suggestFromClienteRow(row) {
  if (!row) return null;
  return firstPixFromFormasArray(row.formas_pagamento);
}

function suggestFromBookerParceiroRow(row) {
  if (!row) return null;
  return firstPixFromFormasArray(row.formas_pagamento);
}

module.exports = {
  firstPixFromFormasArray,
  suggestFromModeloRow,
  suggestFromClienteRow,
  suggestFromBookerParceiroRow,
};
