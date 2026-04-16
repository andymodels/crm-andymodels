/**
 * Colunas JSONB (telefones, emails, formas_pagamento): serializa para JSON aceito pelo Postgres.
 */
function stringifyJsonbColumns(body) {
  const keys = ['telefones', 'emails', 'formas_pagamento', 'perfil_site'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const v = body[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      try {
        JSON.parse(v);
        body[key] = v;
      } catch {
        body[key] = JSON.stringify(v);
      }
    } else {
      body[key] = JSON.stringify(v);
    }
  }
}

module.exports = { stringifyJsonbColumns };
