const express = require('express');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { comparePassword } = require('../utils/auth');
const { lineLiquido } = require('../services/osFinanceiro');

const router = express.Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'crm-dev-secret-change-me';
}

function readBearer(req) {
  const a = String(req.headers.authorization || '').trim();
  if (!a.toLowerCase().startsWith('bearer ')) return '';
  return a.slice(7).trim();
}

function requireModeloAuth(req, res, next) {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ message: 'Sessao ausente.' });
    const p = jwt.verify(token, jwtSecret());
    if (!p || p.tipo !== 'modelo' || !Number.isFinite(Number(p.modelo_id))) {
      return res.status(401).json({ message: 'Sessao invalida.' });
    }
    req.modeloAuth = p;
    return next();
  } catch {
    return res.status(401).json({ message: 'Sessao invalida.' });
  }
}

router.post('/modelo/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!email || !senha) return res.status(400).json({ message: 'Informe email e senha.' });

    const r = await pool.query(
      `SELECT
         ma.id AS acesso_id,
         ma.modelo_id,
         ma.email,
         ma.senha_hash,
         m.nome,
         m.status_cadastro
       FROM modelo_acessos ma
       JOIN modelos m ON m.id = ma.modelo_id
       WHERE lower(ma.email) = $1
       LIMIT 1`,
      [email],
    );
    if (r.rows.length === 0) return res.status(401).json({ message: 'Credenciais invalidas.' });
    const row = r.rows[0];
    const ok = await comparePassword(senha, row.senha_hash);
    if (!ok) return res.status(401).json({ message: 'Credenciais invalidas.' });
    if (String(row.status_cadastro || '').toLowerCase() !== 'aprovado') {
      return res.status(403).json({ message: 'Cadastro pendente de aprovacao.' });
    }

    const token = jwt.sign(
      { tipo: 'modelo', modelo_id: Number(row.modelo_id), email: row.email, nome: row.nome },
      jwtSecret(),
      { expiresIn: '12h' },
    );
    return res.json({
      token,
      modelo: { id: Number(row.modelo_id), nome: row.nome, email: row.email },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/modelo/auth/me', requireModeloAuth, async (req, res, next) => {
  try {
    const modeloId = Number(req.modeloAuth.modelo_id);
    const r = await pool.query(
      `SELECT id, nome, email, status_cadastro
       FROM modelos
       WHERE id = $1`,
      [modeloId],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Modelo nao encontrado.' });
    if (String(r.rows[0].status_cadastro || '').toLowerCase() !== 'aprovado') {
      return res.status(403).json({ message: 'Cadastro pendente de aprovacao.' });
    }
    return res.json({ modelo: r.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/modelo/extrato', requireModeloAuth, async (req, res, next) => {
  try {
    const modeloId = Number(req.modeloAuth.modelo_id);
    const sql = `
      SELECT
        om.id AS os_modelo_id,
        om.os_id,
        om.modelo_id,
        om.cache_modelo,
        om.emite_nf_propria,
        os.imposto_percent,
        os.agencia_fee_percent,
        c.nome_empresa,
        c.nome_fantasia,
        COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
        os.status AS os_status
      FROM os_modelos om
      JOIN ordens_servico os ON os.id = om.os_id
      JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN modelos m ON m.id = om.modelo_id
      WHERE om.modelo_id = $1
      ORDER BY om.os_id DESC, om.id
    `;

    const { rows } = await pool.query(sql, [modeloId]);
    const out = [];
    for (const row of rows) {
      const liquido = lineLiquido(
        row.cache_modelo,
        row.imposto_percent,
        row.agencia_fee_percent,
        row.emite_nf_propria,
      );
      const pay = await pool.query(
        'SELECT COALESCE(SUM(valor), 0) AS pago FROM pagamentos_modelo WHERE os_modelo_id = $1',
        [row.os_modelo_id],
      );
      const pago = Number(pay.rows[0].pago);
      const saldo = liquido - pago;
      const status = Math.abs(saldo) < 0.01 ? 'quitado' : 'pendente';
      out.push({
        os_modelo_id: row.os_modelo_id,
        job_id: row.os_id,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        modelo_nome: row.modelo_nome,
        liquido,
        pago,
        saldo,
        status,
        os_status: row.os_status,
      });
    }
    return res.json(out);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
