/** Horas até o link expirar (padrão 72). Defina CADASTRO_LINK_HORAS_VALIDADE no ambiente. */
function getHorasValidade() {
  const n = Number(process.env.CADASTRO_LINK_HORAS_VALIDADE);
  return Number.isFinite(n) && n > 0 ? n : 72;
}

function isExpired(criadoEm) {
  const horas = getHorasValidade();
  const limite = new Date(new Date(criadoEm).getTime() + horas * 3600 * 1000);
  return Date.now() > limite.getTime();
}

/**
 * Validação para GET (sem lock). Pode marcar como expirado no banco se o prazo passou.
 */
async function validateTokenReadOnly(pool, token) {
  const t = String(token ?? '').trim();
  if (!t) return { ok: false, message: 'Token ausente.' };

  const r = await pool.query('SELECT id, token, criado_em, status, usado_em FROM cadastro_links WHERE token = $1', [
    t,
  ]);
  if (r.rows.length === 0) return { ok: false, message: 'Link invalido ou inexistente.' };

  const row = r.rows[0];
  if (row.status === 'usado') return { ok: false, message: 'Este link ja foi utilizado.' };
  if (row.status === 'expirado') return { ok: false, message: 'Este link expirou.' };

  if (isExpired(row.criado_em)) {
    await pool.query(`UPDATE cadastro_links SET status = 'expirado' WHERE id = $1`, [row.id]);
    return { ok: false, message: 'Este link expirou.' };
  }

  return { ok: true, row };
}

/**
 * Dentro de transação: lock da linha e validação antes do INSERT do modelo.
 */
async function validateAndLockLink(client, token) {
  const t = String(token ?? '').trim();
  if (!t) return { ok: false, message: 'Token do link e obrigatorio.' };

  const r = await client.query('SELECT * FROM cadastro_links WHERE token = $1 FOR UPDATE', [t]);
  if (r.rows.length === 0) return { ok: false, message: 'Link invalido ou inexistente.' };

  const row = r.rows[0];
  if (row.status === 'usado') return { ok: false, message: 'Este link ja foi utilizado.' };
  if (row.status === 'expirado') return { ok: false, message: 'Este link expirou.' };

  if (isExpired(row.criado_em)) {
    await client.query(`UPDATE cadastro_links SET status = 'expirado' WHERE id = $1`, [row.id]);
    return { ok: false, message: 'Este link expirou.' };
  }

  return { ok: true, row };
}

module.exports = {
  getHorasValidade,
  validateTokenReadOnly,
  validateAndLockLink,
};
