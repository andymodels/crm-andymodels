const crypto = require('crypto');
const express = require('express');
const { pool } = require('../config/db');
const { getHorasValidade } = require('../utils/cadastroLinkHelpers');

const router = express.Router();

/** Base dos links públicos de cadastro (modelo/cliente). Não usar PUBLIC_APP_URL — costuma apontar para o site institucional. */
const DEFAULT_CADASTRO_PUBLIC_URL = 'https://crm-andymodels.onrender.com';

function cadastroPublicBase() {
  return String(process.env.CADASTRO_PUBLIC_URL || DEFAULT_CADASTRO_PUBLIC_URL).replace(/\/$/, '');
}

/**
 * Gera um token de uso único para cadastro público de modelo.
 * POST /api/cadastro-links/gerar
 */
router.post('/cadastro-links/gerar', async (req, res, next) => {
  try {
    const token = crypto.randomUUID();
    const horasIns = getHorasValidade();
    const result = await pool.query(
      `INSERT INTO cadastro_links (token, status, tipo, expires_at)
       VALUES ($1, 'ativo', 'modelo', NOW() + ($2::double precision * INTERVAL '1 hour'))
       RETURNING id, criado_em, expires_at`,
      [token, horasIns],
    );
    const row = result.rows[0];
    const base = cadastroPublicBase();
    const url = `${base}/cadastro-modelo?token=${encodeURIComponent(token)}`;
    const horas = horasIns;
    const validoAte = row.expires_at
      ? new Date(row.expires_at)
      : new Date(new Date(row.criado_em).getTime() + horas * 3600 * 1000);
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

/**
 * Gera um token de uso único para cadastro público de cliente.
 * POST /api/cadastro-links/clientes/gerar
 */
router.post('/cadastro-links/clientes/gerar', async (req, res, next) => {
  try {
    const token = crypto.randomUUID();
    const horasIns = getHorasValidade();
    const result = await pool.query(
      `INSERT INTO cadastro_links (token, status, tipo, expires_at)
       VALUES ($1, 'ativo', 'cliente', NOW() + ($2::double precision * INTERVAL '1 hour'))
       RETURNING id, criado_em, expires_at`,
      [token, horasIns],
    );
    const row = result.rows[0];
    const base = cadastroPublicBase();
    const url = `${base}/cadastro-cliente?token=${encodeURIComponent(token)}`;
    const horas = horasIns;
    const validoAte = row.expires_at
      ? new Date(row.expires_at)
      : new Date(new Date(row.criado_em).getTime() + horas * 3600 * 1000);
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
