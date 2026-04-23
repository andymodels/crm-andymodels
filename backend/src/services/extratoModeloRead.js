const { lineLiquido } = require('./osFinanceiro');

const n = (v) => Number(v || 0);

function parseYmd(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function parseMes(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(t)) return null;
  return t;
}

function truthyVerTudo(q) {
  const v = String(q || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'sim';
}

function endOfMonthFromYm(ym) {
  const [yy, mm] = ym.split('-').map((x) => Number(x));
  const last = new Date(Date.UTC(yy, mm, 0));
  return last.toISOString().slice(0, 10);
}

function inPeriod(dateYmd, startYmd, endYmd) {
  if (startYmd && dateYmd < startYmd) return false;
  if (endYmd && dateYmd > endYmd) return false;
  return true;
}

function compareLinha(a, b) {
  if (a.data !== b.data) return String(a.data).localeCompare(String(b.data));
  if (a.ref_tipo !== b.ref_tipo) return String(a.ref_tipo).localeCompare(String(b.ref_tipo));
  return Number(a.ref_id || 0) - Number(b.ref_id || 0);
}

function toYmd(d) {
  return String(d || '').slice(0, 10);
}

async function loadRowsFromSource(pool, modeloId) {
  const [jobsRes, pagamentosRes] = await Promise.all([
    pool.query(
      `
      SELECT
        om.id AS os_modelo_id,
        om.os_id,
        om.cache_modelo,
        om.emite_nf_propria,
        os.imposto_percent,
        os.agencia_fee_percent,
        os.created_at,
        COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
      FROM os_modelos om
      JOIN ordens_servico os ON os.id = om.os_id
      JOIN clientes c ON c.id = os.cliente_id
      WHERE om.modelo_id = $1
        AND os.status IS DISTINCT FROM 'cancelada'
      ORDER BY os.created_at ASC, om.id ASC
      `,
      [modeloId],
    ),
    pool.query(
      `
      SELECT
        p.id,
        p.valor,
        p.data_pagamento,
        p.observacao,
        om.os_id,
        COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
      FROM pagamentos_modelo p
      JOIN os_modelos om ON om.id = p.os_modelo_id
      JOIN ordens_servico os ON os.id = om.os_id
      JOIN clientes c ON c.id = os.cliente_id
      WHERE om.modelo_id = $1
      ORDER BY p.data_pagamento ASC, p.id ASC
      `,
      [modeloId],
    ),
  ]);

  const linhas = [];

  for (const row of jobsRes.rows) {
    const credito = n(
      lineLiquido(
        row.cache_modelo,
        row.imposto_percent,
        row.agencia_fee_percent,
        row.emite_nf_propria,
      ),
    );
    if (credito <= 0.005) continue;
    linhas.push({
      ref_tipo: 'job_os_modelo',
      ref_id: Number(row.os_modelo_id),
      data: toYmd(row.created_at),
      descricao: `Job realizado – O.S. #${row.os_id}`,
      cliente: row.cliente || '',
      os_id: row.os_id,
      credito,
      debito: 0,
      tipo_linha: 'job',
    });
  }

  for (const row of pagamentosRes.rows) {
    const debito = n(row.valor);
    if (debito <= 0.005) continue;
    linhas.push({
      ref_tipo: 'pagamento_modelo',
      ref_id: Number(row.id),
      data: toYmd(row.data_pagamento),
      descricao: 'Pagamento realizado',
      cliente: row.cliente || '',
      os_id: row.os_id,
      credito: 0,
      debito,
      tipo_linha: 'pagamento',
    });
  }

  linhas.sort(compareLinha);
  return linhas;
}

/**
 * Extrato detalhado por modelo (leitura). `query` = req.query.
 */
async function getExtratoModeloLinhas(pool, modeloId, query = {}) {
  const nomeR = await pool.query(`SELECT id, nome FROM modelos WHERE id = $1`, [modeloId]);
  if (nomeR.rows.length === 0) {
    const err = new Error('Modelo nao encontrado.');
    err.status = 404;
    throw err;
  }
  const nome = nomeR.rows[0].nome;

  const verTudo = truthyVerTudo(query.ver_tudo);
  const mes = parseMes(query.mes);
  const de = parseYmd(query.data_de);
  const ate = parseYmd(query.data_ate);

  let filtros = { ver_tudo: true, mes: null, data_de: null, data_ate: null };

  const todasLinhas = await loadRowsFromSource(pool, modeloId);

  if (verTudo) {
    let saldo = 0;
    const linhas = todasLinhas.map((ln) => {
      saldo += ln.credito - ln.debito;
      return {
        id: `${ln.ref_tipo}:${ln.ref_id}`,
        data: ln.data,
        descricao: ln.descricao,
        cliente: ln.cliente || '',
        os_id: ln.os_id,
        credito: ln.credito,
        debito: ln.debito,
        saldo_acumulado: n(saldo),
        tipo_linha: ln.tipo_linha,
      };
    });
    return { modelo_id: modeloId, nome, filtros, linhas };
  }

  let periodStart;
  let periodEnd;
  if (mes) {
    periodStart = `${mes}-01`;
    periodEnd = endOfMonthFromYm(mes);
    filtros = { ver_tudo: false, mes, data_de: null, data_ate: null };
  } else if (de || ate) {
    periodStart = de || '1900-01-01';
    periodEnd = ate || '2100-12-31';
    filtros = { ver_tudo: false, mes: null, data_de: de, data_ate: ate };
  } else {
    const b = await pool.query(`
      SELECT
        to_char(date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date), 'YYYY-MM-DD') AS d0,
        to_char(
          (date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) + INTERVAL '1 month - 1 day')::date,
          'YYYY-MM-DD'
        ) AS d1
    `);
    periodStart = b.rows[0].d0;
    periodEnd = b.rows[0].d1;
    filtros = { ver_tudo: false, mes: null, data_de: null, data_ate: null, mes_corrente: true };
  }

  let saldo = 0;
  for (const ln of todasLinhas) {
    if (ln.data < periodStart) saldo += ln.credito - ln.debito;
  }

  const linhas = [];
  for (const ln of todasLinhas) {
    if (!inPeriod(ln.data, periodStart, periodEnd)) continue;
    saldo += ln.credito - ln.debito;
    linhas.push({
      id: `${ln.ref_tipo}:${ln.ref_id}`,
      data: ln.data,
      descricao: ln.descricao,
      cliente: ln.cliente || '',
      os_id: ln.os_id,
      credito: ln.credito,
      debito: ln.debito,
      saldo_acumulado: n(saldo),
      tipo_linha: ln.tipo_linha,
    });
  }

  return {
    modelo_id: modeloId,
    nome,
    filtros: { ...filtros, periodo_inicio: periodStart, periodo_fim: periodEnd },
    linhas,
  };
}

module.exports = {
  getExtratoModeloLinhas,
  loadRowsFromSource,
};
