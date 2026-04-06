const express = require('express');
const { pool } = require('../config/db');
const { buildContratoDocumentHtml } = require('../services/contratoHtml');
const { loadContratoContext } = require('../services/contratoContext');

const router = express.Router();

async function findOsByToken(token) {
  const r = await pool.query(
    `
    SELECT id, emitir_contrato, contrato_status, contrato_assinado_em
    FROM ordens_servico
    WHERE contrato_assinatura_token = $1
    LIMIT 1
    `,
    [token],
  );
  return r.rows[0] || null;
}

router.get('/public/contratos/validar', async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ valid: false, message: 'Token obrigatório.' });
    const os = await findOsByToken(token);
    if (!os || !os.emitir_contrato) {
      return res.status(404).json({ valid: false, message: 'Link de assinatura inválido.' });
    }
    const assinado = os.contrato_status === 'assinado' || os.contrato_status === 'recebido';
    return res.json({
      valid: true,
      assinado,
      os_id: os.id,
      contrato_status: os.contrato_status || null,
      contrato_assinado_em: os.contrato_assinado_em || null,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/public/contratos/documento', async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).send('Token obrigatório.');
    const os = await findOsByToken(token);
    if (!os || !os.emitir_contrato) return res.status(404).send('Link inválido.');
    const ctx = await loadContratoContext(pool, os.id);
    if (!ctx) return res.status(404).send('O.S. não encontrada.');
    const html = buildContratoDocumentHtml(ctx);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.post('/public/contratos/assinar', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const nome = String(req.body?.nome_assinante || '').trim();
    const documento = String(req.body?.documento_assinante || '').trim();
    if (!token) return res.status(400).json({ message: 'Token obrigatório.' });
    if (!nome) return res.status(400).json({ message: 'Nome do assinante obrigatório.' });

    const os = await findOsByToken(token);
    if (!os || !os.emitir_contrato) {
      return res.status(404).json({ message: 'Link de assinatura inválido.' });
    }
    if (os.contrato_status === 'assinado' || os.contrato_status === 'recebido') {
      return res.status(400).json({ message: 'Contrato já assinado.' });
    }

    await pool.query(
      `
      UPDATE ordens_servico
      SET contrato_status = 'assinado',
          contrato_assinado_em = NOW(),
          contrato_assinado_nome = $2,
          contrato_assinado_documento = $3,
          updated_at = NOW()
      WHERE id = $1
      `,
      [os.id, nome, documento || null],
    );
    res.json({ message: 'Contrato assinado com sucesso.', os_id: os.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
