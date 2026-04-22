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

async function openingBalanceBefore(pool, modeloId, beforeDate) {
  if (!beforeDate) return 0;
  const r = await pool.query(
    `
    SELECT COALESCE(SUM(credito - debito), 0)::numeric AS s
    FROM extrato_modelo_linhas
    WHERE modelo_id = $1 AND data_lancamento < $2::date
    `,
    [modeloId, beforeDate],
  );
  return n(r.rows[0].s);
}

function mapLinha(row) {
  return {
    id: row.id,
    data: row.data,
    descricao: row.descricao,
    cliente: row.cliente || '',
    os_id: row.os_id,
    credito: n(row.credito),
    debito: n(row.debito),
    saldo_acumulado: n(row.saldo_acumulado),
    tipo_linha: row.tipo_linha,
  };
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

  if (verTudo) {
    const q = await pool.query(
      `
      SELECT
        e.id,
        to_char(e.data_lancamento, 'YYYY-MM-DD') AS data,
        e.descricao,
        e.cliente,
        e.os_id,
        e.credito,
        e.debito,
        e.tipo_linha,
        SUM(e.credito - e.debito) OVER (
          ORDER BY e.data_lancamento ASC, e.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS saldo_acumulado
      FROM extrato_modelo_linhas e
      WHERE e.modelo_id = $1
      ORDER BY e.data_lancamento ASC, e.id ASC
      `,
      [modeloId],
    );
    return {
      modelo_id: modeloId,
      nome,
      filtros,
      linhas: q.rows.map(mapLinha),
    };
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

  const opening = await openingBalanceBefore(pool, modeloId, periodStart);
  const q = await pool.query(
    `
    SELECT
      e.id,
      to_char(e.data_lancamento, 'YYYY-MM-DD') AS data,
      e.descricao,
      e.cliente,
      e.os_id,
      e.credito,
      e.debito,
      e.tipo_linha,
      $2::numeric + SUM(e.credito - e.debito) OVER (
        ORDER BY e.data_lancamento ASC, e.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS saldo_acumulado
    FROM extrato_modelo_linhas e
    WHERE e.modelo_id = $1
      AND e.data_lancamento >= $3::date
      AND e.data_lancamento <= $4::date
    ORDER BY e.data_lancamento ASC, e.id ASC
    `,
    [modeloId, opening, periodStart, periodEnd],
  );

  return {
    modelo_id: modeloId,
    nome,
    filtros: { ...filtros, periodo_inicio: periodStart, periodo_fim: periodEnd },
    linhas: q.rows.map(mapLinha),
  };
}

module.exports = {
  getExtratoModeloLinhas,
};
