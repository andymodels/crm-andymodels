const express = require('express');
const { pool } = require('../config/db');
const { getExtratoModeloLinhas } = require('../services/extratoModeloRead');

const router = express.Router();

const n = (v) => Number(v || 0);

/**
 * Lista de modelos com saldo atual (soma crédito − débito nas linhas do extrato).
 * GET /extrato-modelo/resumo
 */
router.get('/extrato-modelo/resumo', async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        m.id,
        m.nome,
        COALESCE(SUM(e.credito - e.debito), 0)::numeric AS saldo_atual
      FROM modelos m
      LEFT JOIN extrato_modelo_linhas e ON e.modelo_id = m.id
      GROUP BY m.id, m.nome
      ORDER BY m.nome ASC
    `);
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        nome: row.nome,
        saldo_atual: n(row.saldo_atual),
      })),
    );
  } catch (e) {
    next(e);
  }
});

/**
 * Extrato detalhado (somente leitura).
 * GET /extrato-modelo/:modeloId/linhas
 */
router.get('/extrato-modelo/:modeloId/linhas', async (req, res, next) => {
  try {
    const modeloId = Number(req.params.modeloId);
    if (Number.isNaN(modeloId) || modeloId <= 0) {
      return res.status(400).json({ message: 'modelo_id invalido.' });
    }
    const out = await getExtratoModeloLinhas(pool, modeloId, req.query);
    res.json(out);
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ message: e.message });
    next(e);
  }
});

module.exports = router;
