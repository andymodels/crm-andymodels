const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

router.get('/public/agenda-presenca', async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(400).json({ message: 'Token obrigatório.' });
    const r = await pool.query(
      `
      SELECT
        p.id,
        p.status,
        p.enviado_em,
        p.respondido_em,
        p.token,
        ae.id AS agenda_evento_id,
        ae.source,
        os.id AS os_id,
        os.data_trabalho,
        os.tipo_trabalho,
        os.horario_trabalho,
        os.local_trabalho,
        COALESCE(c.nome_fantasia, c.nome_empresa, '') AS cliente,
        COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome,
        ae.observacoes_extras
      FROM agenda_modelo_presenca p
      JOIN agenda_eventos ae ON ae.id = p.agenda_evento_id
      LEFT JOIN ordens_servico os ON os.id = ae.os_id
      LEFT JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN modelos m ON m.id = p.modelo_id
      WHERE p.token = $1
      LIMIT 1
      `,
      [token],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Link inválido ou expirado. Peça um novo convite ao escritório.' });
    }
    const row = r.rows[0];
    res.json({
      agenda_evento_id: row.agenda_evento_id,
      os_id: row.os_id,
      cliente: row.cliente,
      modelo_nome: row.modelo_nome,
      tipo_trabalho: row.tipo_trabalho,
      data_trabalho: row.data_trabalho ? String(row.data_trabalho).slice(0, 10) : null,
      horario: row.horario_trabalho || null,
      local: row.local_trabalho || null,
      observacoes_extras: row.observacoes_extras || '',
      status: row.status,
      respondido_em: row.respondido_em,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/public/agenda-presenca', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const acao = String(req.body?.acao || '').trim().toLowerCase();
    if (!token) return res.status(400).json({ message: 'Token obrigatório.' });
    if (acao !== 'confirmar' && acao !== 'recusar') {
      return res.status(400).json({ message: 'acao deve ser confirmar ou recusar.' });
    }
    const cur = await pool.query(
      `SELECT id, os_modelo_id, status FROM agenda_modelo_presenca WHERE token = $1`,
      [token],
    );
    if (cur.rows.length === 0) {
      return res.status(404).json({ message: 'Link inválido ou expirado. Peça um novo convite ao escritório.' });
    }
    const pr = cur.rows[0];
    const novo = acao === 'confirmar' ? 'confirmado' : 'recusado';
    await pool.query(
      `
      UPDATE agenda_modelo_presenca
      SET status = $2, respondido_em = NOW()
      WHERE id = $1
      `,
      [pr.id, novo],
    );
    await pool.query(
      `
      INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
      VALUES ($1, 'resposta', $2)
      `,
      [pr.id, acao === 'confirmar' ? 'Modelo confirmou presença' : 'Modelo recusou'],
    );
    try {
      const osRow = await pool.query(
        `
        SELECT om.os_id FROM os_modelos om WHERE om.id = $1
        `,
        [pr.os_modelo_id],
      );
      const osId = osRow.rows[0]?.os_id;
      if (osId) {
        await pool.query(
          `
          INSERT INTO os_historico (os_id, usuario, campo, valor_anterior, valor_novo)
          VALUES ($1, 'agenda_publica', 'presenca_modelo', $2, $3)
          `,
          [osId, pr.status, novo],
        );
      }
    } catch (histErr) {
      console.warn('[public/agenda-presenca] os_historico:', histErr?.message);
    }
    res.json({
      message:
        acao === 'confirmar'
          ? 'Presença confirmada com sucesso.'
          : 'Você informou que não poderá comparecer.',
      status: novo,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
