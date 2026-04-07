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
async function validateTokenReadOnly(pool, token, expectedType = 'modelo') {
  const t = String(token ?? '').trim();
  if (!t) return { ok: false, message: 'Token ausente.' };

  const r = await pool.query('SELECT id, token, criado_em, status, usado_em FROM cadastro_links WHERE token = $1', [
    t,
  ]);
  if (r.rows.length === 0) return { ok: false, message: 'Link invalido ou inexistente.' };

  const row = r.rows[0];
  const tipo = String(row.tipo || 'modelo').trim().toLowerCase();
  const need = String(expectedType || 'modelo').trim().toLowerCase();
  if (tipo !== need) {
    // Compatibilidade: links antigos sem tipo consistente podem ser ajustados
    // quando ainda estão ativos e sem uso associado.
    const semUsoAssociado = !row.modelo_id && !row.cliente_id && row.status === 'ativo';
    if (semUsoAssociado) {
      await pool.query(`UPDATE cadastro_links SET tipo = $2 WHERE id = $1`, [row.id, need]);
      row.tipo = need;
    } else {
      return { ok: false, message: 'Link inválido para este tipo de cadastro.' };
    }
  }
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
async function validateAndLockLink(client, token, expectedType = 'modelo') {
  const t = String(token ?? '').trim();
  if (!t) return { ok: false, message: 'Token do link e obrigatorio.' };

  const r = await client.query('SELECT * FROM cadastro_links WHERE token = $1 FOR UPDATE', [t]);
  if (r.rows.length === 0) return { ok: false, message: 'Link invalido ou inexistente.' };

  const row = r.rows[0];
  const tipo = String(row.tipo || 'modelo').trim().toLowerCase();
  const need = String(expectedType || 'modelo').trim().toLowerCase();
  if (tipo !== need) {
    const semUsoAssociado = !row.modelo_id && !row.cliente_id && row.status === 'ativo';
    if (semUsoAssociado) {
      await client.query(`UPDATE cadastro_links SET tipo = $2 WHERE id = $1`, [row.id, need]);
      row.tipo = need;
    } else {
      return { ok: false, message: 'Link inválido para este tipo de cadastro.' };
    }
  }
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
