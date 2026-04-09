const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendAgendaConvocacaoEmail } = require('../services/contratoEmail');

const router = express.Router();

function mapsSearchUrl(local) {
  const t = String(local || '').trim();
  if (!t) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function montarEmailAgenda({
  modeloNome,
  tipoTrabalho,
  dataStr,
  horario,
  local,
  mapUrl,
  obsExtras,
  urlConfirmar,
  urlRecusar,
  urlPagina,
}) {
  const obs = String(obsExtras || '').trim();
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#111;">
      <p>Olá${modeloNome ? `, ${escapeHtml(modeloNome)}` : ''}!</p>
      <p>Você foi convocado(a) para um job. Confira os dados:</p>
      <ul>
        <li><strong>Tipo:</strong> ${escapeHtml(tipoTrabalho || '—')}</li>
        <li><strong>Data:</strong> ${escapeHtml(dataStr || '—')}</li>
        <li><strong>Horário:</strong> ${escapeHtml(horario || '—')}</li>
        <li><strong>Local:</strong> ${escapeHtml(local || '—')}</li>
        ${mapUrl ? `<li><strong>Mapa:</strong> <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noreferrer">Abrir</a></li>` : ''}
      </ul>
      ${obs ? `<p><strong>Observações:</strong><br/>${escapeHtml(obs).replace(/\n/g, '<br/>')}</p>` : ''}
      <p><a href="${escapeHtml(urlConfirmar)}" target="_blank" rel="noreferrer"><strong>Confirmar presença</strong></a></p>
      <p><a href="${escapeHtml(urlRecusar)}" target="_blank" rel="noreferrer"><strong>Não posso ir</strong></a></p>
      <p style="color:#666;font-size:13px">Ou <a href="${escapeHtml(urlPagina)}" target="_blank" rel="noreferrer">abra esta página</a> para ver os detalhes e escolher.</p>
      <p style="color:#666;font-size:12px">Mensagem automática enviada pelo CRM Andy Models.</p>
    </div>
  `;
}

/** Base pública usada só nos links do e-mail de convocação (produção: Render). */
function agendaEmailLinkBase() {
  return String(
    process.env.AGENDA_EMAIL_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com',
  ).replace(/\/$/, '');
}

/** Texto simples com os mesmos URLs do HTML — muitos clientes mostram links diretos sem reescrita Brevo no bloco text/plain. */
function montarTextoAgenda({
  modeloNome,
  tipoTrabalho,
  dataStr,
  horario,
  local,
  mapUrl,
  obsExtras,
  urlConfirmar,
  urlRecusar,
  urlPagina,
}) {
  const obs = String(obsExtras || '').trim();
  const nome = modeloNome ? `, ${modeloNome}` : '';
  const linhas = [
    'Convocação — Andy Models CRM',
    '',
    `Olá${nome}!`,
    '',
    'Você foi convocado(a) para um job.',
    '',
    `Tipo: ${tipoTrabalho || '—'}`,
    `Data: ${dataStr || '—'}`,
    `Horário: ${horario || '—'}`,
    `Local: ${local || '—'}`,
  ];
  if (mapUrl) linhas.push(`Mapa: ${mapUrl}`);
  if (obs) linhas.push('', `Observações: ${obs}`);
  linhas.push(
    '',
    'Use os links abaixo (endereços diretos do sistema, sem redirecionamento):',
    '',
    'Confirmar presença:',
    urlConfirmar,
    '',
    'Não posso ir:',
    urlRecusar,
    '',
    'Ver detalhes na página:',
    urlPagina,
    '',
    'Se os botões no HTML abrirem outro domínio, copie e cole uma das linhas acima no navegador.',
  );
  return linhas.join('\n');
}

async function loadPresencaForSend(eventId, presencaId) {
  const row = await pool.query(
    `
    SELECT
      p.id,
      p.token,
      p.enviado_em,
      p.status,
      p.agenda_evento_id,
      p.os_modelo_id,
      ae.source,
      ae.os_id,
      ae.observacoes_extras,
      ae.link_mapa,
      os.data_trabalho,
      os.tipo_trabalho,
      os.horario_trabalho,
      os.local_trabalho,
      COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente_nome,
      COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome,
      NULLIF(TRIM(m.email), '') AS modelo_email
    FROM agenda_modelo_presenca p
    JOIN agenda_eventos ae ON ae.id = p.agenda_evento_id
    LEFT JOIN ordens_servico os ON os.id = ae.os_id
    LEFT JOIN clientes c ON c.id = os.cliente_id
    LEFT JOIN modelos m ON m.id = p.modelo_id
    WHERE p.id = $1 AND p.agenda_evento_id = $2
    `,
    [presencaId, eventId],
  );
  return row.rows[0] || null;
}

async function doSendModeloEmail({ eventId, presencaId }) {
  const ev = await loadPresencaForSend(eventId, presencaId);
  if (!ev) {
    const err = new Error('Registro nao encontrado.');
    err.status = 404;
    throw err;
  }
  if (ev.source !== 'os') {
    const err = new Error('Envio por modelo so para eventos ligados a O.S.');
    err.status = 400;
    throw err;
  }
  if (!ev.modelo_email) {
    const err = new Error(`Modelo ${ev.modelo_nome || ''} sem e-mail cadastrado.`);
    err.status = 400;
    throw err;
  }

  const dataStr = ev.data_trabalho ? String(ev.data_trabalho).slice(0, 10) : '—';
  const horario = ev.horario_trabalho || '—';
  const local = ev.local_trabalho || '—';
  const mapUrl = String(ev.link_mapa || '').trim() || mapsSearchUrl(local);
  const newToken = crypto.randomBytes(24).toString('hex');
  const base = agendaEmailLinkBase();
  const enc = encodeURIComponent(newToken);
  const urlPagina = `${base}/agenda/confirmar?token=${enc}`;
  const urlConfirmar = `${base}/agenda/confirmar?token=${enc}&acao=confirmar`;
  const urlRecusar = `${base}/agenda/confirmar?token=${enc}&acao=recusar`;
  const subject = `Convocação de job - ${ev.cliente_nome || 'Andy Models'} - ${dataStr}`;
  const html = montarEmailAgenda({
    modeloNome: ev.modelo_nome,
    tipoTrabalho: ev.tipo_trabalho,
    dataStr,
    horario,
    local,
    mapUrl,
    obsExtras: ev.observacoes_extras,
    urlConfirmar,
    urlRecusar,
    urlPagina,
  });
  const text = montarTextoAgenda({
    modeloNome: ev.modelo_nome,
    tipoTrabalho: ev.tipo_trabalho,
    dataStr,
    horario,
    local,
    mapUrl,
    obsExtras: ev.observacoes_extras,
    urlConfirmar,
    urlRecusar,
    urlPagina,
  });

  const smtp = await sendAgendaConvocacaoEmail({
    to: ev.modelo_email,
    subject,
    html,
    text,
  });

  await pool.query(
    `
    UPDATE agenda_modelo_presenca
    SET
      token = $2,
      enviado_em = NOW(),
      status = CASE
        WHEN status IN ('confirmado', 'recusado') THEN status
        ELSE 'enviado'
      END
    WHERE id = $1
    `,
    [presencaId, newToken],
  );
  await pool.query(
    `
    INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
    VALUES ($1, 'envio', $2)
    `,
    [presencaId, `E-mail enviado para ${ev.modelo_email}`],
  );

  return {
    to: ev.modelo_email,
    modelo_nome: ev.modelo_nome,
    message_id: smtp?.messageId || null,
    confirm_url: urlPagina,
    links: { confirmar: urlConfirmar, recusar: urlRecusar, pagina: urlPagina },
  };
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
          COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome,
          NULLIF(TRIM(m.email), '') AS modelo_email
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
        COALESCE(NULLIF(TRIM(m.nome), ''), 'Modelo') AS modelo_nome,
        NULLIF(TRIM(m.email), '') AS modelo_email
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

/** POST /agenda/eventos/:id/presenca/:presencaId/enviar */
router.post('/agenda/eventos/:id/presenca/:presencaId/enviar', async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const presencaId = Number(req.params.presencaId);
    if (Number.isNaN(eventId) || Number.isNaN(presencaId)) {
      return res.status(400).json({ message: 'IDs invalidos.' });
    }
    const out = await doSendModeloEmail({ eventId, presencaId });
    res.json({
      ok: true,
      message: 'E-mail enviado ao modelo.',
      ...out,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === 'SMTP_DISABLED' || e.code === 'SMTP_CONFIG_INVALID' || e.code === 'SMTP_SEND_FAILED') {
      return res.status(500).json({
        message: `Falha no envio de e-mail: ${e.message || 'erro SMTP'}`,
        error_code: e.code || null,
      });
    }
    next(e);
  }
});

/** POST /agenda/enviar-modelo */
router.post('/agenda/enviar-modelo', async (req, res, next) => {
  try {
    const eventId = Number(req.body?.event_id);
    const presencaId = Number(req.body?.presenca_id);
    if (Number.isNaN(eventId) || Number.isNaN(presencaId)) {
      return res.status(400).json({ message: 'event_id e presenca_id são obrigatórios.' });
    }
    const out = await doSendModeloEmail({ eventId, presencaId });
    res.json({
      ok: true,
      message: 'E-mail enviado ao modelo.',
      ...out,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === 'SMTP_DISABLED' || e.code === 'SMTP_CONFIG_INVALID' || e.code === 'SMTP_SEND_FAILED') {
      return res.status(500).json({
        message: `Falha no envio de e-mail: ${e.message || 'erro SMTP'}`,
        error_code: e.code || null,
      });
    }
    next(e);
  }
});

/** POST /agenda/presenca/:id/confirmar-manual */
router.post('/agenda/presenca/:id/confirmar-manual', async (req, res, next) => {
  try {
    const presencaId = Number(req.params.id);
    if (Number.isNaN(presencaId)) return res.status(400).json({ message: 'ID inválido.' });
    const upd = await pool.query(
      `
      UPDATE agenda_modelo_presenca
      SET status = 'confirmado', respondido_em = NOW()
      WHERE id = $1
      RETURNING id
      `,
      [presencaId],
    );
    if (upd.rows.length === 0) return res.status(404).json({ message: 'Presença não encontrada.' });
    await pool.query(
      `
      INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
      VALUES ($1, 'resposta', 'Confirmação manual no CRM')
      `,
      [presencaId],
    );
    res.json({ ok: true, status: 'confirmado' });
  } catch (e) {
    next(e);
  }
});

/** POST /agenda/presenca/:id/substituir-modelo */
router.post('/agenda/presenca/:id/substituir-modelo', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const presencaId = Number(req.params.id);
    const novoModeloId = Number(req.body?.modelo_id);
    if (Number.isNaN(presencaId) || Number.isNaN(novoModeloId)) {
      return res.status(400).json({ message: 'IDs inválidos.' });
    }

    await client.query('BEGIN');
    const cur = await client.query(
      `
      SELECT p.id, p.os_modelo_id, p.modelo_id, p.status
      FROM agenda_modelo_presenca p
      WHERE p.id = $1
      FOR UPDATE
      `,
      [presencaId],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Presença não encontrada.' });
    }
    const nomeNovo = await client.query(`SELECT nome FROM modelos WHERE id = $1`, [novoModeloId]);
    if (nomeNovo.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Novo modelo não encontrado.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    await client.query(`UPDATE os_modelos SET modelo_id = $2 WHERE id = $1`, [cur.rows[0].os_modelo_id, novoModeloId]);
    await client.query(
      `
      UPDATE agenda_modelo_presenca
      SET modelo_id = $2, status = 'pendente', enviado_em = NULL, respondido_em = NULL, token = $3
      WHERE id = $1
      `,
      [presencaId, novoModeloId, token],
    );
    await client.query(
      `
      INSERT INTO agenda_presenca_historico (presenca_id, tipo, detalhe)
      VALUES ($1, 'ajuste', $2)
      `,
      [presencaId, `Modelo substituído para ${nomeNovo.rows[0].nome || `#${novoModeloId}`}`],
    );
    await client.query('COMMIT');
    res.json({ ok: true, status: 'pendente' });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;