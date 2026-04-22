const { lineLiquido } = require('./osFinanceiro');

const n = (v) => Number(v || 0);

/**
 * Mantém a tabela `extrato_modelo_linhas` alinhada com O.S., pagamentos e movimentos.
 * ref_tipo + ref_id são idempotentes (ON CONFLICT DO UPDATE / DELETE).
 */

async function upsertJobLine(client, osModeloId) {
  const r = await client.query(
    `
    SELECT
      om.id,
      om.modelo_id,
      om.cache_modelo,
      om.emite_nf_propria,
      om.os_id,
      os.imposto_percent,
      os.agencia_fee_percent,
      os.status,
      os.created_at,
      os.data_trabalho,
      COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
    FROM os_modelos om
    JOIN ordens_servico os ON os.id = om.os_id
    JOIN clientes c ON c.id = os.cliente_id
    WHERE om.id = $1
    `,
    [osModeloId],
  );
  if (r.rows.length === 0) return;
  const row = r.rows[0];
  if (row.modelo_id == null) {
    await client.query(`DELETE FROM extrato_modelo_linhas WHERE ref_tipo = 'job_os_modelo' AND ref_id = $1`, [
      osModeloId,
    ]);
    return;
  }
  if (String(row.status || '').toLowerCase() === 'cancelada') {
    await client.query(`DELETE FROM extrato_modelo_linhas WHERE ref_tipo = 'job_os_modelo' AND ref_id = $1`, [
      osModeloId,
    ]);
    return;
  }
  const liquido = n(
    lineLiquido(row.cache_modelo, row.imposto_percent, row.agencia_fee_percent, row.emite_nf_propria),
  );
  if (liquido <= 0.005) {
    await client.query(`DELETE FROM extrato_modelo_linhas WHERE ref_tipo = 'job_os_modelo' AND ref_id = $1`, [
      osModeloId,
    ]);
    return;
  }
  const dataLanc = row.data_trabalho
    ? String(row.data_trabalho).slice(0, 10)
    : String(row.created_at || '').slice(0, 10);
  const descricao = `Job realizado – O.S. #${row.os_id}`;
  await client.query(
    `
    INSERT INTO extrato_modelo_linhas (
      modelo_id, data_lancamento, descricao, cliente, os_id, credito, debito, tipo_linha, ref_tipo, ref_id
    )
    VALUES ($1, $2::date, $3, $4, $5, $6, 0, 'job', 'job_os_modelo', $7)
    ON CONFLICT (ref_tipo, ref_id) DO UPDATE SET
      modelo_id = EXCLUDED.modelo_id,
      data_lancamento = EXCLUDED.data_lancamento,
      descricao = EXCLUDED.descricao,
      cliente = EXCLUDED.cliente,
      os_id = EXCLUDED.os_id,
      credito = EXCLUDED.credito,
      debito = 0,
      tipo_linha = 'job'
    `,
    [row.modelo_id, dataLanc, descricao, row.cliente || '', row.os_id, liquido, osModeloId],
  );
}

async function upsertPagamentoLine(client, pagamentoId) {
  const r = await client.query(
    `
    SELECT
      p.id,
      p.valor,
      p.data_pagamento,
      p.observacao,
      om.id AS os_modelo_id,
      om.modelo_id,
      om.os_id,
      COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
    FROM pagamentos_modelo p
    JOIN os_modelos om ON om.id = p.os_modelo_id
    JOIN ordens_servico os ON os.id = om.os_id
    JOIN clientes c ON c.id = os.cliente_id
    WHERE p.id = $1
    `,
    [pagamentoId],
  );
  if (r.rows.length === 0) return;
  const row = r.rows[0];
  if (row.modelo_id == null) return;
  const valor = n(row.valor);
  if (valor <= 0) return;
  const obs = String(row.observacao || '').trim();
  const descricao = obs ? `Pagamento realizado — ${obs.slice(0, 200)}` : 'Pagamento realizado';
  await client.query(
    `
    INSERT INTO extrato_modelo_linhas (
      modelo_id, data_lancamento, descricao, cliente, os_id, credito, debito, tipo_linha, ref_tipo, ref_id
    )
    VALUES ($1, $2::date, $3, $4, $5, 0, $6, 'pagamento', 'pagamento_modelo', $7)
    ON CONFLICT (ref_tipo, ref_id) DO UPDATE SET
      modelo_id = EXCLUDED.modelo_id,
      data_lancamento = EXCLUDED.data_lancamento,
      descricao = EXCLUDED.descricao,
      cliente = EXCLUDED.cliente,
      os_id = EXCLUDED.os_id,
      credito = 0,
      debito = EXCLUDED.debito,
      tipo_linha = 'pagamento'
    `,
    [row.modelo_id, String(row.data_pagamento).slice(0, 10), descricao, row.cliente || '', row.os_id, valor, row.id],
  );
}

async function upsertFinMovModeloLine(client, movimentoId) {
  const r = await client.query(
    `SELECT * FROM fin_movimentos WHERE id = $1 AND pessoa_tipo = 'modelo'`,
    [movimentoId],
  );
  if (r.rows.length === 0) return;
  const m = r.rows[0];
  const valor = n(m.valor);
  if (valor <= 0) return;
  const isDebit = String(m.natureza || '').toLowerCase() === 'debito';
  const credito = isDebit ? 0 : valor;
  const debito = isDebit ? valor : 0;
  const cat = String(m.categoria || '').toLowerCase();
  let tipoLinha = 'ajuste';
  let descricao = 'Ajuste manual';
  if (cat === 'adiantamento') {
    tipoLinha = 'adiantamento';
    descricao = isDebit ? 'Adiantamento' : 'Ajuste manual';
  }
  const obs = String(m.observacao || '').trim();
  if (obs) descricao = `${descricao} — ${obs.slice(0, 200)}`;
  await client.query(
    `
    INSERT INTO extrato_modelo_linhas (
      modelo_id, data_lancamento, descricao, cliente, os_id, credito, debito, tipo_linha, ref_tipo, ref_id
    )
    VALUES ($1, $2::date, $3, '', NULL, $4, $5, $6, 'fin_movimento', $7)
    ON CONFLICT (ref_tipo, ref_id) DO UPDATE SET
      modelo_id = EXCLUDED.modelo_id,
      data_lancamento = EXCLUDED.data_lancamento,
      descricao = EXCLUDED.descricao,
      cliente = EXCLUDED.cliente,
      os_id = NULL,
      credito = EXCLUDED.credito,
      debito = EXCLUDED.debito,
      tipo_linha = EXCLUDED.tipo_linha
    `,
    [
      m.pessoa_id,
      String(m.data_movimento).slice(0, 10),
      descricao,
      credito,
      debito,
      tipoLinha,
      movimentoId,
    ],
  );
}

/** Remove linhas de job desta O.S. (O.S. cancelada). */
async function deleteJobLinesForOs(client, osId) {
  await client.query(
    `
    DELETE FROM extrato_modelo_linhas e
    USING os_modelos om
    WHERE e.ref_tipo = 'job_os_modelo'
      AND e.ref_id = om.id
      AND om.os_id = $1
    `,
    [osId],
  );
}

/**
 * Primeira carga: só corre se a tabela estiver vazia (evita reprocessar a cada arranque).
 */
async function backfillExtratoModeloIfEmpty(pool) {
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM extrato_modelo_linhas`);
  if (Number(c.rows[0].n) > 0) return;
  const om = await pool.query(`SELECT id FROM os_modelos ORDER BY id`);
  for (const row of om.rows) {
    await upsertJobLine(pool, row.id);
  }
  const pay = await pool.query(`SELECT id FROM pagamentos_modelo ORDER BY id`);
  for (const row of pay.rows) {
    await upsertPagamentoLine(pool, row.id);
  }
  const mov = await pool.query(
    `SELECT id FROM fin_movimentos WHERE pessoa_tipo = 'modelo' ORDER BY id`,
  );
  for (const row of mov.rows) {
    await upsertFinMovModeloLine(pool, row.id);
  }
}

module.exports = {
  upsertJobLine,
  upsertPagamentoLine,
  upsertFinMovModeloLine,
  deleteJobLinesForOs,
  backfillExtratoModeloIfEmpty,
};
