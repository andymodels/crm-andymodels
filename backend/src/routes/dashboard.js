const express = require('express');
const { pool } = require('../config/db');
const { lineLiquido } = require('../services/osFinanceiro');

const router = express.Router();

const n = (v) => Number(v || 0);

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function situacaoReceber(dataRefStr, todayStr) {
  if (dataRefStr < todayStr) return 'atrasado';
  if (dataRefStr === todayStr) return 'vence_hoje';
  return 'pendente';
}

const SQL_CONTRATOS_PENDENTES = `
  SELECT
    os.id,
    os.emitir_contrato,
    os.contrato_status,
    os.contrato_enviado_em,
    c.nome_empresa,
    c.nome_fantasia
  FROM ordens_servico os
  JOIN clientes c ON c.id = os.cliente_id
  WHERE os.emitir_contrato = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM os_documentos d
      WHERE d.os_id = os.id AND d.tipo = 'contrato_assinado_scan'
    )
  ORDER BY os.id DESC
  LIMIT 100
`;

router.get('/dashboard/contratos-pendentes', async (_req, res, next) => {
  try {
    const r = await pool.query(SQL_CONTRATOS_PENDENTES);
    res.json({ count: r.rows.length, items: r.rows });
  } catch (e) {
    next(e);
  }
});

router.get('/dashboard/alertas', async (_req, res, next) => {
  try {
    const [contratos, receber] = await Promise.all([
      pool.query(SQL_CONTRATOS_PENDENTES),
      pool.query(`
        SELECT
          os.id AS os_id,
          os.total_cliente,
          os.status,
          c.nome_empresa,
          c.nome_fantasia,
          COALESCE(r.recebido, 0) AS recebido
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        LEFT JOIN (
          SELECT os_id, SUM(valor) AS recebido
          FROM recebimentos
          GROUP BY os_id
        ) r ON r.os_id = os.id
        WHERE os.total_cliente - COALESCE(r.recebido, 0) > 0.01
        ORDER BY os.id DESC
        LIMIT 40
      `),
    ]);

    const contasReceber = receber.rows.map((row) => {
      const tot = n(row.total_cliente);
      const rec = n(row.recebido);
      return {
        os_id: row.os_id,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        total_cliente: tot,
        recebido: rec,
        saldo: tot - rec,
        status: row.status,
      };
    });

    const omRows = await pool.query(`
      SELECT
        om.id AS os_modelo_id,
        om.os_id,
        om.cache_modelo,
        om.emite_nf_propria,
        os.imposto_percent,
        os.agencia_fee_percent,
        COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
        c.nome_empresa,
        c.nome_fantasia
      FROM os_modelos om
      JOIN ordens_servico os ON os.id = om.os_id
      JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN modelos m ON m.id = om.modelo_id
      ORDER BY om.id DESC
      LIMIT 300
    `);

    const ids = omRows.rows.map((r) => r.os_modelo_id);
    let payMap = new Map();
    if (ids.length > 0) {
      const pays = await pool.query(
        `
        SELECT os_modelo_id, COALESCE(SUM(valor), 0) AS pago
        FROM pagamentos_modelo
        WHERE os_modelo_id = ANY($1::int[])
        GROUP BY os_modelo_id
        `,
        [ids],
      );
      payMap = new Map(pays.rows.map((x) => [x.os_modelo_id, n(x.pago)]));
    }

    const pagamentosModeloPendentes = [];
    for (const row of omRows.rows) {
      const liquido = lineLiquido(
        row.cache_modelo,
        row.imposto_percent,
        row.agencia_fee_percent,
        row.emite_nf_propria,
      );
      const pago = payMap.get(row.os_modelo_id) ?? 0;
      const saldo = liquido - pago;
      if (saldo > 0.02) {
        pagamentosModeloPendentes.push({
          os_modelo_id: row.os_modelo_id,
          job_id: row.os_id,
          modelo_nome: row.modelo_nome,
          cliente: row.nome_empresa || row.nome_fantasia || '',
          liquido,
          pago,
          saldo,
        });
      }
      if (pagamentosModeloPendentes.length >= 25) break;
    }

    res.json({
      contratos_pendentes: { count: contratos.rows.length, items: contratos.rows },
      contas_receber: contasReceber,
      pagamentos_modelo_pendentes: pagamentosModeloPendentes,
      meta: {
        nota_prazos:
          'No calendário da Dashboard: vencimento do cliente usa a data informada na O.S.; se vazia, usa a data do trabalho como referência. Previsão de pagamento a modelo vem de cada linha da O.S.',
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/dashboard/calendario', async (req, res, next) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ message: 'from e to devem ser YYYY-MM-DD.' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'from nao pode ser maior que to.' });
    }

    const todayStr = ymdLocal();

    const [osTrabalho, contasRec, prevPagRows, pagReal] = await Promise.all([
      pool.query(
        `
        SELECT
          os.id AS os_id,
          os.data_trabalho::text AS data_evento,
          os.status,
          os.tipo_os,
          c.nome_empresa,
          c.nome_fantasia,
          COALESCE(
            STRING_AGG(COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om2.rotulo), ''), 'Modelo'), ', ' ORDER BY om2.id)
              FILTER (WHERE om2.id IS NOT NULL),
            ''
          ) AS modelos_nomes
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        LEFT JOIN os_modelos om2 ON om2.os_id = os.id
        LEFT JOIN modelos m ON m.id = om2.modelo_id
        WHERE os.data_trabalho IS NOT NULL
          AND os.data_trabalho >= $1::date
          AND os.data_trabalho <= $2::date
        GROUP BY os.id, os.data_trabalho, os.status, os.tipo_os, c.nome_empresa, c.nome_fantasia
        `,
        [from, to],
      ),
      pool.query(
        `
        SELECT
          os.id AS os_id,
          COALESCE(os.data_vencimento_cliente, os.data_trabalho)::text AS data_evento,
          os.data_vencimento_cliente::text AS data_vencimento_cliente,
          os.data_trabalho::text AS data_trabalho,
          (
            os.data_vencimento_cliente IS NULL
            AND os.data_trabalho IS NOT NULL
          ) AS usa_data_trabalho_como_fallback,
          os.status,
          os.total_cliente,
          COALESCE(r.recebido, 0) AS recebido,
          c.nome_empresa,
          c.nome_fantasia
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        LEFT JOIN (
          SELECT os_id, SUM(valor) AS recebido
          FROM recebimentos
          GROUP BY os_id
        ) r ON r.os_id = os.id
        WHERE os.total_cliente - COALESCE(r.recebido, 0) > 0.01
          AND COALESCE(os.data_vencimento_cliente, os.data_trabalho) IS NOT NULL
          AND COALESCE(os.data_vencimento_cliente, os.data_trabalho) >= $1::date
          AND COALESCE(os.data_vencimento_cliente, os.data_trabalho) <= $2::date
        `,
        [from, to],
      ),
      pool.query(
        `
        SELECT
          om.id AS os_modelo_id,
          om.os_id,
          om.data_prevista_pagamento::text AS data_evento,
          om.cache_modelo,
          om.emite_nf_propria,
          COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
          os.imposto_percent,
          os.agencia_fee_percent,
          c.nome_empresa,
          c.nome_fantasia
        FROM os_modelos om
        JOIN ordens_servico os ON os.id = om.os_id
        LEFT JOIN modelos m ON m.id = om.modelo_id
        JOIN clientes c ON c.id = os.cliente_id
        WHERE om.data_prevista_pagamento IS NOT NULL
          AND om.data_prevista_pagamento >= $1::date
          AND om.data_prevista_pagamento <= $2::date
        `,
        [from, to],
      ),
      pool.query(
        `
        SELECT
          p.id AS pagamento_id,
          p.data_pagamento::text AS data_evento,
          p.valor,
          p.observacao,
          om.os_id,
          COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
          c.nome_empresa,
          c.nome_fantasia
        FROM pagamentos_modelo p
        JOIN os_modelos om ON om.id = p.os_modelo_id
        LEFT JOIN modelos m ON m.id = om.modelo_id
        JOIN ordens_servico os ON os.id = om.os_id
        JOIN clientes c ON c.id = os.cliente_id
        WHERE p.data_pagamento >= $1::date
          AND p.data_pagamento <= $2::date
        ORDER BY p.data_pagamento, p.id
        `,
        [from, to],
      ),
    ]);

    const events = [];

    for (const row of osTrabalho.rows) {
      events.push({
        id: `os-trabalho-${row.os_id}`,
        tipo: 'os_trabalho',
        data: row.data_evento,
        os_id: row.os_id,
        status: row.status,
        tipo_os: row.tipo_os,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        modelos: row.modelos_nomes ? row.modelos_nomes.split(', ').filter(Boolean) : [],
      });
    }

    for (const row of contasRec.rows) {
      const saldo = n(row.total_cliente) - n(row.recebido);
      const situacao = situacaoReceber(row.data_evento, todayStr);
      events.push({
        id: `receber-${row.os_id}-${row.data_evento}`,
        tipo: 'conta_receber',
        data: row.data_evento,
        os_id: row.os_id,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        saldo,
        situacao,
        usa_fallback_data_trabalho: Boolean(row.usa_data_trabalho_como_fallback),
        status_os: row.status,
      });
    }

    let payMapPrev = new Map();
    if (prevPagRows.rows.length > 0) {
      const ids = [...new Set(prevPagRows.rows.map((r) => r.os_modelo_id))];
      const paySums = await pool.query(
        `
        SELECT os_modelo_id, COALESCE(SUM(valor), 0) AS pago
        FROM pagamentos_modelo
        WHERE os_modelo_id = ANY($1::int[])
        GROUP BY os_modelo_id
        `,
        [ids],
      );
      payMapPrev = new Map(paySums.rows.map((x) => [x.os_modelo_id, n(x.pago)]));
    }

    for (const row of prevPagRows.rows) {
      const liquido = lineLiquido(
        row.cache_modelo,
        row.imposto_percent,
        row.agencia_fee_percent,
        row.emite_nf_propria,
      );
      const pago = payMapPrev.get(row.os_modelo_id) ?? 0;
      const saldo = liquido - pago;
      if (saldo <= 0.02) {
        continue;
      }
      events.push({
        id: `prev-pag-${row.os_modelo_id}-${row.data_evento}`,
        tipo: 'pagamento_modelo_previsto',
        data: row.data_evento,
        os_id: row.os_id,
        os_modelo_id: row.os_modelo_id,
        modelo: row.modelo_nome,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        saldo_linha: saldo,
        liquido,
      });
    }

    for (const row of pagReal.rows) {
      events.push({
        id: `pag-real-${row.pagamento_id}`,
        tipo: 'pagamento_modelo_realizado',
        data: row.data_evento,
        os_id: row.os_id,
        modelo: row.modelo_nome,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        valor: n(row.valor),
        observacao: row.observacao || '',
      });
    }

    events.sort((a, b) => {
      if (a.data !== b.data) return a.data.localeCompare(b.data);
      const ord = {
        os_trabalho: 0,
        conta_receber: 1,
        pagamento_modelo_previsto: 2,
        pagamento_modelo_realizado: 3,
      };
      return (ord[a.tipo] ?? 9) - (ord[b.tipo] ?? 9);
    });

    res.json({
      events,
      hoje: todayStr,
      intervalo: { from, to },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
