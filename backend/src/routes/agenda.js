const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');

const router = express.Router();

function mapsSearchUrl(local) {
  const t = String(local || '').trim();
  if (!t) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
}

async function ensureAgendaForOsMissing(client = pool) {
  await client.query(`
    INSERT INTO agenda_eventos (source, os_id, observacoes_extras, manual_tipo, data_evento)
    SELECT 'os', os.id, '', NULL, NULL
    FROM ordens_servico os
    WHERE os.status IS DISTINCT FROM 'cancelada'
      AND NOT EXISTS (SELECT 1 FROM agenda_eventos ae WHERE ae.os_id = os.id)
  `);
  const missingP = await client.query(`
    SELECT om.id AS os_modelo_id, om.modelo_id, ae.id AS agenda_evento_id
    FROM os_modelos om
    JOIN agenda_eventos ae ON ae.os_id = om.os_id AND ae.source = 'os'
    WHERE NOT EXISTS (SELECT 1 FROM agenda_modelo_presenca p WHERE p.os_modelo_id = om.id)
  `);
  for (const row of missingP.rows) {
    const token = crypto.randomBytes(24).toString('hex');
    await client.query(
      `
      INSERT INTO agenda_modelo_presenca (agenda_evento_id, os_modelo_id, modelo_id, token, status)
      VALUES ($1, $2, $3, $4, 'pendente')
      `,
      [row.agenda_evento_id, row.os_modelo_id, row.modelo_id, token],
    );
  }
}

function montarMensagemModelo({
  tipoTrabalho,
  dataStr,
  horario,
  local,
  mapUrl,
  obsExtras,
  modeloNome,
}) {
  const linhas = [
    `Olá${modeloNome ? `, ${modeloNome}` : ''}!`,
    '',
    `Trabalho: ${tipoTrabalho || '—'}`,
    `Data: ${dataStr || '—'}`,
    `Horário: ${horario || '—'}`,
    `Local: ${local || '—'}`,
  ];
  if (mapUrl) linhas.push(`Mapa: ${mapUrl}`);
  if (String(obsExtras || '').trim()) linhas.push('', `Obs.: ${obsExtras.trim()}`);
  return linhas.join('\n');
}

/** GET /agenda — eventos entre datas (YYYY-MM-DD). */
router.get('/agenda', async (req, res, next) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ message: 'from e to devem ser YYYY-MM-DD.' });
    }
    await ensureAgendaForOsMissing();

    const r = await pool.query(
      `
      WITH ev AS (
        SELECT
          ae.id,
          ae.source,
          ae.os_id,
          ae.observacoes_extras,
          ae.manual_tipo,
          ae.data_evento,
          ae.hora_evento,
          ae.local_evento,
          ae.observacoes_manual,
          ae.link_mapa,
          ae.updated_at,
          CASE
            WHEN ae.source = 'os' THEN os.data_trabalho::text
            ELSE ae.data_evento::text
          END AS data_calendario,
          os.tipo_trabalho AS os_tipo_trabalho,
          os.tipo_os,
          os.horario_trabalho AS os_horario,
          os.local_trabalho AS os_local,
          os.status AS os_status,
          COALESCE(c.nome_fantasia, c.nome_empresa, '') AS cliente_nome,
          COALESCE(
            (
              SELECT string_agg(
                COALESCE(NULLIF(TRIM(m2.nome), ''), NULLIF(TRIM(om2.rotulo), ''), 'Modelo'),
                ', ' ORDER BY om2.id
              )
              FROM os_modelos om2
              LEFT JOIN modelos m2 ON m2.id = om2.modelo_id
              WHERE om2.os_id = os.id
            ),
            ''
          ) AS modelos_resumo
        FROM agenda_eventos ae
        LEFT JOIN ordens_servico os ON os.id = ae.os_id
        LEFT JOIN clientes c ON c.id = os.cliente_id
        WHERE
          (ae.source = 'os' AND os.data_trabalho IS NOT NULL AND os.data_trabalho >= $1::date AND os.data_trabalho <= $2::date)
          OR
          (ae.source = 'manual' AND ae.data_evento >= $1::date AND ae.data_evento <= $2::date)
      )
      SELECT * FROM ev
      ORDER BY data_calendario NULLS LAST, id
      `,
      [from, to],
    );

    const ids = r.rows.map((x) => x.id);
    let presByEv = new Map();
    if (ids.length > 0) {
      const pr = await pool.query(
        `
        SELECT
          p.id,
          p.agenda_evento_id,
          p.os_modelo_id,
          p.modelo_id,
          p.token,
          p.status,
          p.enviado_em,
          p.respondido_em,
          COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome
        FROM agenda_modelo_presenca p
        LEFT JOIN modelos m ON m.id = p.modelo_id
        WHERE p.agenda_evento_id = ANY($1::int[])
        ORDER BY p.id
        `,
        [ids],
      );
      for (const row of pr.rows) {
        if (!presByEv.has(row.agenda_evento_id)) presByEv.set(row.agenda_evento_id, []);
        presByEv.get(row.agenda_evento_id).push(row);
      }
    }

    const rows = r.rows.map((row) => ({
      id: row.id,
      source: row.source,
      os_id: row.os_id,
      observacoes_extras: row.observacoes_extras,
      manual_tipo: row.manual_tipo,
      data_evento: row.data_calendario,
      hora_evento: row.source === 'os' ? row.os_horario : row.hora_evento,
      local_evento: row.source === 'os' ? row.os_local : row.local_evento,
      observacoes_manual: row.observacoes_manual,
      link_mapa: row.link_mapa,
      tipo_trabalho: row.source === 'os' ? row.os_tipo_trabalho : row.manual_tipo,
      tipo_os: row.tipo_os,
      cliente_nome: row.cliente_nome,
      modelos_resumo: row.modelos_resumo,
      os_status: row.os_status,
      presencas: presByEv.get(row.id) || [],
    }));

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** GET /agenda/eventos/:id */
router.get('/agenda/eventos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    await ensureAgendaForOsMissing();
    const list = await pool.query(
      `
      SELECT
        ae.*,
        os.data_trabalho,
        os.tipo_trabalho AS os_tipo_trabalho,
        os.horario_trabalho AS os_horario,
        os.local_trabalho AS os_local,
        os.tipo_os,
        os.status AS os_status,
        COALESCE(c.nome_fantasia, c.nome_empresa, '') AS cliente_nome,
        COALESCE(
          (
            SELECT string_agg(
              COALESCE(NULLIF(TRIM(m2.nome), ''), NULLIF(TRIM(om2.rotulo), ''), 'Modelo'),
              ', ' ORDER BY om2.id
            )
            FROM os_modelos om2
            LEFT JOIN modelos m2 ON m2.id = om2.modelo_id
            WHERE om2.os_id = os.id
          ),
          ''
        ) AS modelos_resumo
      FROM agenda_eventos ae
      LEFT JOIN ordens_servico os ON os.id = ae.os_id
      LEFT JOIN clientes c ON c.id = os.cliente_id
      WHERE ae.id = $1
      `,
      [id],
    );
    if (list.rows.length === 0) return res.status(404).json({ message: 'Evento nao encontrado.' });
    const row = list.rows[0];
    const pr = await pool.query(
      `
      SELECT
        p.*,
        COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome
      FROM agenda_modelo_presenca p
      LEFT JOIN modelos m ON m.id = p.modelo_id
      WHERE p.agenda_evento_id = $1
      ORDER BY p.id
      `,
      [id],
    );
    const historico = await pool.query(
      `
      SELECT h.*
      FROM agenda_presenca_historico h
      WHERE h.presenca_id IN (
        SELECT id FROM agenda_modelo_presenca WHERE agenda_evento_id = $1
      )
      ORDER BY h.created_at DESC
      LIMIT 200
      `,
      [id],
    );
    res.json({
      evento: {
        id: row.id,
        source: row.source,
        os_id: row.os_id,
        observacoes_extras: row.observacoes_extras,
        manual_tipo: row.manual_tipo,
        data_trabalho: row.data_trabalho,
        data_evento_manual: row.data_evento,
        hora_evento: row.source === 'os' ? row.os_horario : row.hora_evento,
        local_evento: row.source === 'os' ? row.os_local : row.local_evento,
        observacoes_manual: row.observacoes_manual,
        link_mapa: row.link_mapa,
        tipo_trabalho: row.source === 'os' ? row.os_tipo_trabalho : row.manual_tipo,
        tipo_os: row.tipo_os,
        cliente_nome: row.cliente_nome,
        modelos_resumo: row.modelos_resumo,
        os_status: row.os_status,
      },
      presencas: pr.rows,
      historico: historico.rows,
    });
  } catch (e) {
    next(e);
  }
});

/** PATCH /agenda/eventos/:id */
router.patch('/agenda/eventos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const cur = await pool.query(`SELECT source FROM agenda_eventos WHERE id = $1`, [id]);
    if (cur.rows.length === 0) return res.status(404).json({ message: 'Evento nao encontrado.' });
    const src = cur.rows[0].source;
    if (src === 'os') {
      const obs = req.body?.observacoes_extras != null ? String(req.body.observacoes_extras) : undefined;
      if (obs === undefined) {
        return res.status(400).json({ message: 'Envie observacoes_extras.' });
      }
      await pool.query(`UPDATE agenda_eventos SET observacoes_extras = $2, updated_at = NOW() WHERE id = $1`, [
        id,
        obs,
      ]);
      return res.json({ ok: true });
    }
    const tipos = ['compromisso', 'casting', 'reuniao'];
    const manual_tipo = String(req.body?.manual_tipo || '').trim();
    const data_evento = String(req.body?.data_evento || '').trim();
    const hora_evento = String(req.body?.hora_evento ?? '');
    const local_evento = String(req.body?.local_evento ?? '');
    const observacoes_manual = String(req.body?.observacoes_manual ?? '');
    const link_mapa = String(req.body?.link_mapa ?? '');
    if (!tipos.includes(manual_tipo)) {
      return res.status(400).json({ message: 'manual_tipo invalido (compromisso, casting, reuniao).' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data_evento)) {
      return res.status(400).json({ message: 'data_evento invalida.' });
    }
    await pool.query(
      `
      UPDATE agenda_eventos
      SET manual_tipo = $2, data_evento = $3::date, hora_evento = $4, local_evento = $5,
          observacoes_manual = $6, link_mapa = $7, updated_at = NOW()
      WHERE id = $1 AND source = 'manual'
      `,
      [id, manual_tipo, data_evento, hora_evento, local_evento, observacoes_manual, link_mapa],
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** POST /agenda/eventos — evento manual */
router.post('/agenda/eventos', async (req, res, next) => {
  try {
    const tipos = ['compromisso', 'casting', 'reuniao'];
    const manual_tipo = String(req.body?.manual_tipo || '').trim();
    const data_evento = String(req.body?.data_evento || '').trim();
    const hora_evento = String(req.body?.hora_evento || '').trim();
    const local_evento = String(req.body?.local_evento || '').trim();
    const observacoes_manual = String(req.body?.observacoes_manual || '').trim();
    const link_mapa = String(req.body?.link_mapa || '').trim();
    if (!tipos.includes(manual_tipo)) {
      return res.status(400).json({ message: 'manual_tipo invalido.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data_evento)) {
      return res.status(400).json({ message: 'data_evento obrigatoria (YYYY-MM-DD).' });
    }
    const ins = await pool.query(
      `
      INSERT INTO agenda_eventos (
        source, os_id, observacoes_extras, manual_tipo, data_evento, hora_evento, local_evento,
        observacoes_manual, link_mapa
      )
      VALUES ('manual', NULL, '', $1, $2::date, $3, $4, $5, $6)
      RETURNING id
      `,
      [manual_tipo, data_evento, hora_evento, local_evento, observacoes_manual, link_mapa],
    );
    res.status(201).json({ id: ins.rows[0].id });
  } catch (e) {
    next(e);
  }
});

/** DELETE /agenda/eventos/:id — apenas manual */
router.delete('/agenda/eventos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const r = await pool.query(`DELETE FROM agenda_eventos WHERE id = $1 AND source = 'manual' RETURNING id`, [id]);
    if (r.rows.length === 0) {
      return res.status(400).json({ message: 'So e possivel excluir eventos manuais.' });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const publicBase = () => String(process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');

/** POST /agenda/eventos/:id/presenca/:presencaId/enviar */
router.post('/agenda/eventos/:id/presenca/:presencaId/enviar', async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const presencaId = Number(req.params.presencaId);
    if (Number.isNaN(eventId) || Number.isNaN(presencaId)) {
      return res.status(400).json({ message: 'IDs invalidos.' });
    }
    const row = await pool.query(
      `
      SELECT
        p.id,
        p.token,
        p.enviado_em,
        ae.source,
        ae.observacoes_extras,
        ae.link_mapa,
        os.data_trabalho,
        os.tipo_trabalho,
        os.horario_trabalho,
        os.local_trabalho,
        ae.hora_evento,
        ae.local_evento,
        ae.manual_tipo,
        ae.data_evento,
        COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome
      FROM agenda_modelo_presenca p
      JOIN agenda_eventos ae ON ae.id = p.agenda_evento_id
      LEFT JOIN ordens_servico os ON os.id = ae.os_id
      LEFT JOIN modelos m ON m.id = p.modelo_id
      WHERE p.id = $1 AND p.agenda_evento_id = $2
      `,
      [presencaId, eventId],
    );
    if (row.rows.length === 0) return res.status(404).json({ message: 'Registro nao encontrado.' });
    const ev = row.rows[0];
    if (ev.source !== 'os') {
      return res.status(400).json({ message: 'Envio por modelo so para eventos ligados a O.S.' });
    }
    const dataStr = ev.data_trabalho ? String(ev.data_trabalho).slice(0, 10) : '—';
    const horario = ev.horario_trabalho || '—';
    const local = ev.local_trabalho || '—';
    const mapUrl = String(ev.link_mapa || '').trim() || mapsSearchUrl(local);
    const mensagem = montarMensagemModelo({
      tipoTrabalho: ev.tipo_trabalho,
      dataStr,
      horario,
      local,
      mapUrl,
      obsExtras: ev.observacoes_extras,
      modeloNome: ev.modelo_nome,
    });
    const confirmUrl = `${publicBase()}/agenda-confirmar?token=${encodeURIComponent(ev.token)}`;
    const mensagemCompleta = `${mensagem}\n\nConfirme sua presença:\n${confirmUrl}`;
    await pool.query(
      `
      UPDATE agenda_modelo_presenca SET enviado_em = NOW() WHERE id = $1
      `,
      [presencaId],
    );
    await pool.query(
      `
      INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
      VALUES ($1, 'envio', 'Mensagem gerada no CRM')
      `,
      [presencaId],
    );
    res.json({
      mensagem: mensagemCompleta,
      link_confirmacao: confirmUrl,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;