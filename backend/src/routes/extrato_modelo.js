const express = require('express');
const { pool } = require('../config/db');
const { getExtratoModeloLinhas, loadRowsFromSource } = require('../services/extratoModeloRead');

const router = express.Router();

const n = (v) => Number(v || 0);

/**
 * Lista de modelos com saldo atual (espelho de O.S. + pagamentos).
 * GET /extrato-modelo/resumo
 */
router.get('/extrato-modelo/resumo', async (req, res, next) => {
  try {
    const modelos = await pool.query(`SELECT id, nome FROM modelos ORDER BY nome ASC`);
    const out = [];
    for (const m of modelos.rows) {
      const linhas = await loadRowsFromSource(pool, Number(m.id));
      const saldo = linhas.reduce((acc, ln) => acc + n(ln.credito) - n(ln.debito), 0);
      out.push({ id: m.id, nome: m.nome, saldo_atual: n(saldo) });
    }
    res.json(out);
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
