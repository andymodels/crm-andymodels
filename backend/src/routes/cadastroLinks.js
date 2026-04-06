const crypto = require('crypto');
const express = require('express');
const { pool } = require('../config/db');
const { getHorasValidade } = require('../utils/cadastroLinkHelpers');

const router = express.Router();

/**
 * Gera um token de uso único para cadastro público de modelo.
 * POST /api/cadastro-links/gerar
 */
router.post('/cadastro-links/gerar', async (req, res, next) => {
  try {
    const token = crypto.randomUUID();
    const result = await pool.query(
      `INSERT INTO cadastro_links (token, status) VALUES ($1, 'ativo') RETURNING id, criado_em`,
      [token],
    );
    const row = result.rows[0];
    const base = String(process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com').replace(/\/$/, '');
    const url = `${base}/cadastro-modelo?token=${encodeURIComponent(token)}`;
    const horas = getHorasValidade();
    const validoAte = new Date(new Date(row.criado_em).getTime() + horas * 3600 * 1000);
    return res.status(201).json({
      id: row.id,
      token,
      url,
      valido_ate: validoAte.toISOString(),
      horas_validade: horas,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
