const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

function ymdFromDbDate(v) {
  if (v == null) return null;
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function respostaFinalizada(status) {
  return status === 'confirmado' || status === 'recusado';
}

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
    const final = respostaFinalizada(row.status);
    res.json({
      agenda_evento_id: row.agenda_evento_id,
      os_id: row.os_id,
      cliente: row.cliente,
      modelo_nome: row.modelo_nome,
      tipo_trabalho: row.tipo_trabalho,
      data_trabalho: ymdFromDbDate(row.data_trabalho),
      horario: row.horario_trabalho || null,
      local: row.local_trabalho || null,
      observacoes_extras: row.observacoes_extras || '',
      status: row.status,
      respondido_em: row.respondido_em,
      resposta_ja_registrada: final,
      pode_responder: !final,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/public/agenda-presenca', async (req, res, next) => {
  const token = String(req.body?.token || '').trim();
  const acao = String(req.body?.acao || '').trim().toLowerCase();
  if (!token) return res.status(400).json({ message: 'Token obrigatório.' });
  if (acao !== 'confirmar' && acao !== 'recusar') {
    return res.status(400).json({ message: 'acao deve ser confirmar ou recusar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT id, os_modelo_id, status FROM agenda_modelo_presenca WHERE token = $1 FOR UPDATE`,
      [token],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Link inválido ou expirado. Peça um novo convite ao escritório.' });
    }
    const pr = cur.rows[0];
    if (respostaFinalizada(pr.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Resposta já registrada para este convite.',
        status: pr.status,
        resposta_ja_registrada: true,
      });
    }

    const novo = acao === 'confirmar' ? 'confirmado' : 'recusado';
    await client.query(
      `
      UPDATE agenda_modelo_presenca
      SET status = $2, respondido_em = NOW()
      WHERE id = $1
      `,
      [pr.id, novo],
    );
    await client.query(
      `
      INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
      VALUES ($1, 'resposta', $2)
      `,
      [pr.id, acao === 'confirmar' ? 'Modelo confirmou presença' : 'Modelo recusou'],
    );
    await client.query('COMMIT');

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
      resposta_ja_registrada: false,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
