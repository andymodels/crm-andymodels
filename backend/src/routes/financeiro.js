const express = require('express');
const { pool } = require('../config/db');
const router = express.Router();

const n = (v) => Number(v || 0);

router.get('/financeiro/resumo', async (_req, res, next) => {
  try {
    const [rec, pag, osAbertas, osTotais] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(valor), 0) AS t FROM recebimentos'),
      pool.query('SELECT COALESCE(SUM(valor), 0) AS t FROM pagamentos_modelo'),
      pool.query(`
        SELECT COALESCE(SUM(total_cliente), 0) AS t
        FROM ordens_servico
        WHERE status IS DISTINCT FROM 'recebida'
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(total_cliente), 0) AS soma_total_cliente,
          COALESCE(SUM(modelo_liquido_total), 0) AS soma_modelo_liquido,
          COALESCE(SUM(parceiro_valor), 0) AS soma_parceiro_valor,
          COALESCE(SUM(booker_valor), 0) AS soma_booker_valor,
          COALESCE(SUM(resultado_agencia), 0) AS soma_resultado_agencia
        FROM ordens_servico
      `),
    ]);

    const totalRecebido = Number(rec.rows[0].t);
    const totalPagoModelos = Number(pag.rows[0].t);
    const totalAReceberOs = Number(osAbertas.rows[0].t);
    const rowOs = osTotais.rows[0];

    res.json({
      total_recebido_cliente: totalRecebido,
      total_pago_modelos: totalPagoModelos,
      total_faturado_os_abertas: totalAReceberOs,
      saldo_aproximado: totalRecebido - totalPagoModelos,
      soma_total_cliente_os: Number(rowOs.soma_total_cliente),
      soma_modelo_liquido_os: Number(rowOs.soma_modelo_liquido),
      soma_parceiro_valor_os: Number(rowOs.soma_parceiro_valor),
      soma_booker_valor_os: Number(rowOs.soma_booker_valor),
      soma_resultado_agencia_os: Number(rowOs.soma_resultado_agencia),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/os/:id/contexto', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const os = await pool.query(
      `
      SELECT os.id, os.total_cliente, os.status, os.condicoes_pagamento, os.descricao
      FROM ordens_servico os
      WHERE os.id = $1
      `,
      [id],
    );
    if (os.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const row = os.rows[0];
    const rec = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS recebido FROM recebimentos WHERE os_id = $1`,
      [id],
    );
    const recebido = n(rec.rows[0].recebido);
    const totalCliente = n(row.total_cliente);
    const saldoReceber = Math.max(0, totalCliente - recebido);
    res.json({
      os_id: row.id,
      total_cliente: totalCliente,
      recebido,
      saldo_receber: saldoReceber,
      status: row.status,
      condicoes_pagamento: row.condicoes_pagamento,
      descricao: row.descricao,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/recebimentos', async (req, res, next) => {
  try {
    const osId = req.query.os_id ? Number(req.query.os_id) : null;
    let sql = `
      SELECT r.*, c.nome_empresa, c.nome_fantasia
      FROM recebimentos r
      JOIN ordens_servico os ON os.id = r.os_id
      JOIN clientes c ON c.id = os.cliente_id
    `;
    const params = [];
    if (osId != null && !Number.isNaN(osId)) {
      sql += ' WHERE r.os_id = $1';
      params.push(osId);
    }
    sql += ' ORDER BY r.data_recebimento DESC, r.id DESC LIMIT 200';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/recebimentos', async (req, res, next) => {
  try {
    const { os_id, valor, data_recebimento, observacao } = req.body;
    if (os_id == null || valor == null || !data_recebimento) {
      return res.status(400).json({ message: 'os_id, valor e data_recebimento sao obrigatorios.' });
    }
    const osCheck = await pool.query(
      'SELECT id, total_cliente, status FROM ordens_servico WHERE id = $1',
      [os_id],
    );
    if (osCheck.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const totalCliente = n(osCheck.rows[0].total_cliente);
    const recBefore = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS recebido FROM recebimentos WHERE os_id = $1`,
      [os_id],
    );
    const recebidoAntes = n(recBefore.rows[0].recebido);
    const saldo = Math.max(0, totalCliente - recebidoAntes);
    const valorNum = n(valor);
    if (valorNum <= 0) {
      return res.status(400).json({ message: 'Valor deve ser maior que zero.' });
    }
    if (saldo <= 0.005) {
      return res.status(400).json({
        message: 'Nao ha saldo a receber nesta O.S. conforme total_cliente e recebimentos ja registrados.',
      });
    }
    if (valorNum > saldo + 0.02) {
      return res.status(400).json({
        message: `Valor acima do saldo em aberto (${saldo.toFixed(2)}). Ajuste o valor ou confira a O.S.`,
      });
    }

    await pool.query('BEGIN');
    try {
      const ins = await pool.query(
        `
        INSERT INTO recebimentos (os_id, valor, data_recebimento, observacao)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [os_id, valor, data_recebimento, observacao || ''],
      );
      await pool.query(
        `
        UPDATE ordens_servico
        SET status = 'recebida', updated_at = NOW()
        WHERE id = $1
        `,
        [os_id],
      );
      await pool.query('COMMIT');
      res.status(201).json(ins.rows[0]);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/pagamentos-modelo', async (req, res, next) => {
  try {
    const osId = req.query.os_id ? Number(req.query.os_id) : null;
    let sql = `
      SELECT p.*, m.nome AS modelo_nome, om.os_id
      FROM pagamentos_modelo p
      JOIN os_modelos om ON om.id = p.os_modelo_id
      JOIN modelos m ON m.id = om.modelo_id
    `;
    const params = [];
    if (osId != null && !Number.isNaN(osId)) {
      sql += ' WHERE om.os_id = $1';
      params.push(osId);
    }
    sql += ' ORDER BY p.data_pagamento DESC, p.id DESC LIMIT 200';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/pagamentos-modelo', async (req, res, next) => {
  try {
    const { os_modelo_id, valor, data_pagamento, observacao } = req.body;
    if (os_modelo_id == null || valor == null || !data_pagamento) {
      return res.status(400).json({ message: 'os_modelo_id, valor e data_pagamento sao obrigatorios.' });
    }
    const check = await pool.query('SELECT id FROM os_modelos WHERE id = $1', [os_modelo_id]);
    if (check.rows.length === 0) return res.status(404).json({ message: 'Linha de modelo (os_modelo) nao encontrada.' });

    const ins = await pool.query(
      `
      INSERT INTO pagamentos_modelo (os_modelo_id, valor, data_pagamento, observacao)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [os_modelo_id, valor, data_pagamento, observacao || ''],
    );
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
