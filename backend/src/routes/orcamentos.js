const express = require('express');
const { pool } = require('../config/db');
const { computeOsFinancials } = require('../services/osFinanceiro');
const { buildOrcamentoDocumentHtml } = require('../services/documentoOrcamentoOsHtml');

const router = express.Router();

router.get('/orcamentos/:id/pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const html = await buildOrcamentoDocumentHtml(pool, id);
    if (!html) return res.status(404).send('Orcamento nao encontrado.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/orcamentos', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        o.*,
        c.nome_empresa,
        c.nome_fantasia
      FROM orcamentos o
      JOIN clientes c ON c.id = o.cliente_id
      ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/orcamentos', async (req, res, next) => {
  try {
    const requiredFields = [
      'cliente_id',
      'tipo_trabalho',
      'descricao',
      'cache_base_estimado_total',
      'taxa_agencia_percent',
      'extras_agencia_valor',
      'condicoes_pagamento',
      'uso_imagem',
      'prazo',
      'territorio',
    ];

    const missing = requiredFields.filter((field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
    if (missing.length > 0) {
      return res.status(400).json({ message: `Campos obrigatorios faltando: ${missing.join(', ')}` });
    }

    const query = `
      INSERT INTO orcamentos (
        cliente_id,
        tipo_trabalho,
        descricao,
        cache_base_estimado_total,
        taxa_agencia_percent,
        extras_agencia_valor,
        condicoes_pagamento,
        uso_imagem,
        prazo,
        territorio
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `;
    const values = [
      req.body.cliente_id,
      req.body.tipo_trabalho,
      req.body.descricao,
      req.body.cache_base_estimado_total,
      req.body.taxa_agencia_percent,
      req.body.extras_agencia_valor,
      req.body.condicoes_pagamento,
      req.body.uso_imagem,
      req.body.prazo,
      req.body.territorio,
    ];

    const result = await pool.query(query, values);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/orcamentos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }

    const check = await pool.query('SELECT id, status FROM orcamentos WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Orcamento nao encontrado.' });
    }
    if (check.rows[0].status !== 'rascunho') {
      return res.status(400).json({ message: 'Somente orcamento em rascunho pode ser editado.' });
    }

    const query = `
      UPDATE orcamentos
      SET
        cliente_id = $1,
        tipo_trabalho = $2,
        descricao = $3,
        cache_base_estimado_total = $4,
        taxa_agencia_percent = $5,
        extras_agencia_valor = $6,
        condicoes_pagamento = $7,
        uso_imagem = $8,
        prazo = $9,
        territorio = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;
    const values = [
      req.body.cliente_id,
      req.body.tipo_trabalho,
      req.body.descricao,
      req.body.cache_base_estimado_total,
      req.body.taxa_agencia_percent,
      req.body.extras_agencia_valor,
      req.body.condicoes_pagamento,
      req.body.uso_imagem,
      req.body.prazo,
      req.body.territorio,
      id,
    ];

    const result = await pool.query(query, values);
    return res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/orcamentos/:id/aprovar', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }

    await pool.query('BEGIN');

    const budgetResult = await pool.query('SELECT * FROM orcamentos WHERE id = $1 FOR UPDATE', [id]);
    if (budgetResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ message: 'Orcamento nao encontrado.' });
    }

    const budget = budgetResult.rows[0];
    if (budget.status !== 'rascunho') {
      await pool.query('ROLLBACK');
      return res.status(400).json({ message: 'Orcamento ja foi aprovado ou cancelado.' });
    }

    const impostoPadrao = 10;
    const nums = computeOsFinancials({
      tipo_os: 'com_modelo',
      valor_servico: 0,
      cache_modelo_total: budget.cache_base_estimado_total,
      agencia_fee_percent: budget.taxa_agencia_percent,
      extras_agencia_valor: budget.extras_agencia_valor,
      extras_despesa_valor: 0,
      imposto_percent: impostoPadrao,
      parceiro_percent: null,
      booker_percent: null,
      linhas: [],
    });

    const osResult = await pool.query(
      `
      INSERT INTO ordens_servico (
        orcamento_id,
        cliente_id,
        descricao,
        tipo_os,
        uso_imagem,
        total_cliente,
        status,
        tipo_trabalho,
        prazo,
        territorio,
        condicoes_pagamento,
        valor_servico,
        cache_modelo_total,
        agencia_fee_percent,
        taxa_agencia_valor,
        extras_agencia_valor,
        extras_despesa_valor,
        extras_despesa_descricao,
        imposto_percent,
        imposto_valor,
        modelo_liquido_total,
        agencia_parcial,
        parceiro_id,
        parceiro_percent,
        parceiro_valor,
        agencia_apos_parceiro,
        booker_id,
        booker_percent,
        booker_valor,
        agencia_final,
        resultado_agencia
      )
      VALUES (
        $1, $2, $3, 'com_modelo', $4, $5, 'aberta',
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        NULL, NULL, $21, $22, NULL, NULL, $23, $24, $25
      )
      RETURNING *
      `,
      [
        budget.id,
        budget.cliente_id,
        budget.descricao,
        budget.uso_imagem,
        nums.total_cliente,
        budget.tipo_trabalho,
        budget.prazo,
        budget.territorio,
        budget.condicoes_pagamento,
        0,
        nums.cache_modelo_total,
        budget.taxa_agencia_percent,
        nums.taxa_agencia_valor,
        budget.extras_agencia_valor,
        0,
        '',
        impostoPadrao,
        nums.imposto_valor,
        nums.modelo_liquido_total,
        nums.agencia_parcial,
        nums.parceiro_valor,
        nums.agencia_apos_parceiro,
        nums.booker_valor,
        nums.agencia_final,
        nums.resultado_agencia,
      ],
    );

    await pool.query(
      `
      UPDATE orcamentos
      SET status = 'aprovado', updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );

    await pool.query('COMMIT');
    return res.json({
      message: 'Orcamento aprovado e O.S. criada com sucesso.',
      os: osResult.rows[0],
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    next(error);
  }
});

module.exports = router;
