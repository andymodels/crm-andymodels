const express = require('express');
const { pool } = require('../config/db');
const {
  signUserToken,
  setAuthCookie,
  clearAuthCookie,
  comparePassword,
  hashPassword,
} = require('../utils/auth');
const { requireAdminAuth } = require('../middleware/requireAdminAuth');

const router = express.Router();

router.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!email || !senha) {
      return res.status(400).json({ message: 'Informe email e senha.' });
    }

    const r = await pool.query(
      `SELECT id, nome, email, senha_hash, tipo FROM usuarios WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }
    const user = r.rows[0];
    const ok = await comparePassword(senha, user.senha_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Credenciais invalidas.' });
    }
    if (user.tipo !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores.' });
    }

    const token = signUserToken(user);
    setAuthCookie(res, token);
    return res.json({
      user: { id: user.id, nome: user.nome, email: user.email, tipo: user.tipo },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
});

router.get('/auth/me', requireAdminAuth, async (req, res) => {
  const id = Number(req.authUser?.sub || 0);
  const r = await pool.query(`SELECT id, nome, email, tipo FROM usuarios WHERE id = $1`, [id]);
  if (r.rows.length === 0) return res.status(401).json({ message: 'Sessao invalida.' });
  return res.json({ user: r.rows[0] });
});

router.post('/auth/change-password', requireAdminAuth, async (req, res, next) => {
  try {
    const id = Number(req.authUser?.sub || 0);
    const senhaAtual = String(req.body?.senha_atual || '');
    const novaSenha = String(req.body?.nova_senha || '');
    if (!senhaAtual || !novaSenha) {
      return res.status(400).json({ message: 'Informe senha atual e nova senha.' });
    }
    if (novaSenha.length < 8) {
      return res.status(400).json({ message: 'A nova senha deve ter ao menos 8 caracteres.' });
    }
    const r = await pool.query(`SELECT id, senha_hash FROM usuarios WHERE id = $1`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Usuario nao encontrado.' });
    const ok = await comparePassword(senhaAtual, r.rows[0].senha_hash);
    if (!ok) return res.status(401).json({ message: 'Senha atual invalida.' });

    const nextHash = await hashPassword(novaSenha);
    await pool.query(`UPDATE usuarios SET senha_hash = $1, updated_at = NOW() WHERE id = $2`, [
      nextHash,
      id,
    ]);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
