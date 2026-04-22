const express = require('express');
const { pool } = require('../config/db');
const { lineLiquido } = require('../services/osFinanceiro');
const { buildContratoDocumentHtml } = require('../services/contratoHtml');
const { loadContratoContext } = require('../services/contratoContext');
const { validarContratoPronto } = require('../services/contratoReadiness');
const { buildOsDocumentHtml } = require('../services/documentoOrcamentoOsHtml');
const { generateContratoForOs, sendContratoAssinaturaEmail } = require('../services/contratoWorkflow');

const router = express.Router();

const n = (v) => Number(v || 0);
const publicAppBase = () =>
  String(process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com').replace(/\/$/, '');

function contratoUiStatusFromRow(row) {
  if (!row || row.emitir_contrato !== true) return 'cancelado';
  const raw = String(row.contrato_status || '').trim().toLowerCase();
  if (raw === 'assinado' || raw === 'recebido') return 'assinado';
  if (row.contrato_enviado_em) return 'enviado';
  return 'pendente';
}

async function loadDocumentos(osId) {
  const r = await pool.query(
    `
    SELECT id, tipo, nome_arquivo, mime, sha256, created_at
    FROM os_documentos
    WHERE os_id = $1
    ORDER BY id
    `,
    [osId],
  );
  return r.rows;
}

async function loadLinhas(osId) {
  const r = await pool.query(
    `
    SELECT
      om.*,
      COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome
    FROM os_modelos om
    LEFT JOIN modelos m ON m.id = om.modelo_id
    WHERE om.os_id = $1
    ORDER BY om.id
    `,
    [osId],
  );
  return r.rows;
}

async function loadOsHistorico(osId) {
  const r = await pool.query(
    `
    SELECT id, created_at, usuario, campo, valor_anterior, valor_novo
    FROM os_historico
    WHERE os_id = $1
    ORDER BY id DESC
    `,
    [osId],
  );
  return r.rows;
}

router.get('/ordens-servico/:id/pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const html = await buildOsDocumentHtml(pool, id);
    if (!html) return res.status(404).send('O.S. nao encontrada.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/ordens-servico/:id/contrato-preview', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const ctx = await loadContratoContext(pool, id);
    if (!ctx) return res.status(404).send('O.S. nao encontrada.');
    if (!ctx.os.emitir_contrato) {
      return res.status(400).send('Esta O.S. nao esta marcada para emitir contrato.');
    }
    const errosPrev = await validarContratoPronto(pool, id, ctx.os, ctx.os.tipo_os || 'com_modelo');
    if (errosPrev.length > 0) {
      return res
        .status(400)
        .send(`Dados incompletos para o contrato: ${errosPrev.join('; ')}. Ajuste a O.S. e o cadastro.`);
    }
    const html = buildContratoDocumentHtml(ctx);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/ordens-servico/:id/contrato-html-download', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const ctx = await loadContratoContext(pool, id);
    if (!ctx) return res.status(404).send('O.S. nao encontrada.');
    if (!ctx.os.emitir_contrato) {
      return res.status(400).send('Esta O.S. nao esta marcada para emitir contrato.');
    }
    const errosPrev = await validarContratoPronto(pool, id, ctx.os, ctx.os.tipo_os || 'com_modelo');
    if (errosPrev.length > 0) {
      return res
        .status(400)
        .send(`Dados incompletos para o contrato: ${errosPrev.join('; ')}. Ajuste a O.S. e o cadastro.`);
    }
    const html = buildContratoDocumentHtml(ctx);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-os-${id}.html"`);
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/ordens-servico/:id/contrato-pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const generated = await generateContratoForOs(pool, id);
    if (!generated.ok) {
      return res.status(400).send(generated.message || 'Falha ao gerar contrato.');
    }
    const r = await pool.query(
      `
      SELECT id, nome_arquivo, mime
      FROM os_documentos
      WHERE os_id = $1 AND tipo = 'contrato_pdf_gerado'
      ORDER BY id DESC
      LIMIT 1
      `,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).send('PDF do contrato nao encontrado.');
    const doc = r.rows[0];
    return res.redirect(`/api/ordens-servico/${id}/documentos/${doc.id}/download`);
  } catch (e) {
    if (e.code === 'PDF_GENERATION_FAILED') {
      const fallback = `/api/ordens-servico/${Number(req.params.id)}/contrato-html-download`;
      // Para uso em links diretos (UI), envia para o fallback automaticamente.
      if (String(req.headers.accept || '').includes('text/html')) {
        return res.redirect(fallback);
      }
      return res.status(503).json({
        message: `${e.message} Use o fallback HTML para conversão manual.`,
        fallback_html_url: `${publicAppBase()}${fallback}`,
      });
    }
    next(e);
  }
});

router.post('/ordens-servico/:id/contrato-enviar-email', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const ctx = await loadContratoContext(pool, id);
    if (!ctx) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    if (!ctx.os.emitir_contrato) {
      return res.status(400).json({ message: 'O.S. sem opcao de contrato ativa.' });
    }
    const errosMail = await validarContratoPronto(pool, id, ctx.os, ctx.os.tipo_os || 'com_modelo');
    if (errosMail.length > 0) {
      return res.status(400).json({
        message: `Dados incompletos para o contrato: ${errosMail.join('; ')}.`,
      });
    }
    const destinatario = (req.body && req.body.destinatario) || ctx.cliente.email;
    if (!destinatario || String(destinatario).trim() === '') {
      return res.status(400).json({ message: 'Informe destinatario ou cadastre e-mail do cliente.' });
    }
    const generated = await generateContratoForOs(pool, id);
    if (!generated.ok) {
      return res.status(400).json({ message: generated.message || 'Nao foi possivel gerar contrato.' });
    }
    const sent = await sendContratoAssinaturaEmail(pool, id, destinatario);
    res.json({
      message: 'Contrato enviado por e-mail.',
      contrato_enviado: true,
      assinatura_link: sent.assinatura_link || generated.assinatura_link,
      preview_link: sent.preview_link || null,
      pdf_link: sent.pdf_link || null,
      smtp_message_id: sent.smtp_message_id || null,
    });
  } catch (e) {
    if (
      e.code === 'SMTP_DISABLED' ||
      e.code === 'SMTP_CONFIG_INVALID' ||
      e.code === 'SMTP_SEND_FAILED' ||
      e.code === 'PDF_GENERATION_FAILED'
    ) {
      // Fallback obrigatório: não bloqueia fluxo de assinatura por falha SMTP.
      const fallbackCtx = await loadContratoContext(pool, Number(req.params.id)).catch(() => null);
      const token = fallbackCtx?.os?.contrato_assinatura_token || null;
      const base = publicAppBase();
      const assinatura_link = token ? `${base}/assinatura-contrato?token=${encodeURIComponent(token)}` : null;
      return res.status(200).json({
        message: `Erro ao enviar e-mail: ${e.message || 'verifique configuração SMTP'}. Você pode enviar o link manualmente.`,
        contrato_enviado: false,
        assinatura_link,
        preview_link: Number.isFinite(Number(req.params.id))
          ? `${base}/api/ordens-servico/${Number(req.params.id)}/contrato-preview`
          : null,
        pdf_link: Number.isFinite(Number(req.params.id))
          ? `${base}/api/ordens-servico/${Number(req.params.id)}/contrato-pdf`
          : null,
        fallback_html_url: Number.isFinite(Number(req.params.id))
          ? `${base}/api/ordens-servico/${Number(req.params.id)}/contrato-html-download`
          : null,
        smtp_error_code: e.code || null,
        smtp_error_detail: e.message || null,
      });
    }
    next(e);
  }
});

router.get('/contratos', async (_req, res, next) => {
  try {
    const r = await pool.query(
      `
      SELECT
        os.id AS os_id,
        os.created_at,
        os.emitir_contrato,
        os.contrato_status,
        os.contrato_enviado_em,
        os.contrato_assinado_em,
        c.nome_empresa,
        c.nome_fantasia,
        c.email AS cliente_email,
        COALESCE(
          STRING_AGG(
            COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'Modelo')
            , ', ' ORDER BY om.id
          ) FILTER (WHERE om.id IS NOT NULL),
          ''
        ) AS modelos
      FROM ordens_servico os
      JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN os_modelos om ON om.os_id = os.id
      LEFT JOIN modelos m ON m.id = om.modelo_id
      WHERE os.emitir_contrato = TRUE OR os.contrato_status IS NOT NULL
      GROUP BY os.id, c.nome_empresa, c.nome_fantasia, c.email
      ORDER BY os.id DESC
      `
    );

    const rows = r.rows.map((row) => {
      const status = contratoUiStatusFromRow(row);
      return {
        os_id: row.os_id,
        cliente: row.nome_fantasia || row.nome_empresa || '',
        modelos: row.modelos || '',
        created_at: row.created_at,
        status,
        status_raw: row.contrato_status || null,
        cliente_email: row.cliente_email || '',
        contrato_enviado_em: row.contrato_enviado_em,
        contrato_assinado_em: row.contrato_assinado_em,
      };
    });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/contratos/:osId/status', async (req, res, next) => {
  const osId = Number(req.params.osId);
  try {
    if (Number.isNaN(osId)) return res.status(400).json({ message: 'ID invalido.' });
    const target = String(req.body?.status || '')
      .trim()
      .toLowerCase();
    if (!['pendente', 'enviado', 'assinado'].includes(target)) {
      return res.status(400).json({ message: 'Status invalido. Use pendente, enviado ou assinado.' });
    }

    const curR = await pool.query(
      `SELECT id, emitir_contrato, contrato_status, contrato_enviado_em, contrato_assinado_em
       FROM ordens_servico
       WHERE id = $1`,
      [osId],
    );
    if (curR.rows.length === 0) return res.status(404).json({ message: 'Contrato nao encontrado.' });
    const cur = curR.rows[0];
    if (!cur.emitir_contrato) {
      return res.status(400).json({ message: 'Contrato desativado para esta O.S.' });
    }

    if (target === 'assinado') {
      await pool.query(
        `UPDATE ordens_servico
         SET contrato_status = 'assinado',
             contrato_assinado_em = COALESCE(contrato_assinado_em, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [osId],
      );
    } else if (target === 'enviado') {
      await pool.query(
        `UPDATE ordens_servico
         SET contrato_status = 'aguardando_assinatura',
             contrato_enviado_em = COALESCE(contrato_enviado_em, NOW()),
             contrato_assinado_em = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [osId],
      );
    } else {
      await pool.query(
        `UPDATE ordens_servico
         SET contrato_status = 'aguardando_assinatura',
             contrato_enviado_em = NULL,
             contrato_assinado_em = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [osId],
      );
    }

    const outR = await pool.query(
      `SELECT id, emitir_contrato, contrato_status, contrato_enviado_em, contrato_assinado_em
       FROM ordens_servico
       WHERE id = $1`,
      [osId],
    );
    const out = outR.rows[0];
    return res.json({
      message: target === 'assinado' ? 'Contrato marcado como assinado.' : `Status alterado para ${target}.`,
      os_id: osId,
      status: contratoUiStatusFromRow(out),
      status_raw: out.contrato_status || null,
      contrato_enviado_em: out.contrato_enviado_em,
      contrato_assinado_em: out.contrato_assinado_em,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/contratos/:osId/preview', async (req, res, next) => {
  try {
    const osId = Number(req.params.osId);
    if (Number.isNaN(osId)) return res.status(400).send('ID invalido.');
    const ctx = await loadContratoContext(pool, osId);
    if (!ctx) return res.status(404).send('Contrato nao encontrado.');
    if (!ctx.os.emitir_contrato) return res.status(400).send('Contrato cancelado para esta O.S.');
    const html = buildContratoDocumentHtml(ctx);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.post('/contratos/:osId/reenviar', async (req, res, next) => {
  const osId = Number(req.params.osId);
  try {
    if (Number.isNaN(osId)) return res.status(400).json({ message: 'ID invalido.' });
    const dbRow = await pool.query(
      `
      SELECT os.emitir_contrato, c.email AS cliente_email
      FROM ordens_servico os
      JOIN clientes c ON c.id = os.cliente_id
      WHERE os.id = $1
      `,
      [osId]
    );
    if (dbRow.rows.length === 0) return res.status(404).json({ message: 'Contrato nao encontrado.' });
    if (!dbRow.rows[0].emitir_contrato) {
      return res.status(400).json({ message: 'Contrato cancelado para esta O.S.' });
    }
    const destino = String(req.body?.destinatario || dbRow.rows[0].cliente_email || '').trim();
    if (!destino) return res.status(400).json({ message: 'Cliente sem e-mail cadastrado.' });

    const generated = await generateContratoForOs(pool, osId);
    if (!generated.ok) return res.status(400).json({ message: generated.message || 'Falha ao gerar contrato.' });
    const sent = await sendContratoAssinaturaEmail(pool, osId, destino);
    res.json({
      message: 'Contrato reenviado com sucesso.',
      assinatura_link: sent.assinatura_link || generated.assinatura_link,
    });
  } catch (e) {
    if (e.code === 'PDF_GENERATION_FAILED') {
      return res.status(503).json({
        message: e.message,
        fallback_html_url: `${publicAppBase()}/api/ordens-servico/${osId}/contrato-html-download`,
      });
    }
    if (
      e.code === 'SMTP_DISABLED' ||
      e.code === 'SMTP_CONFIG_INVALID' ||
      e.code === 'SMTP_SEND_FAILED'
    ) {
      const base = publicAppBase();
      const fallbackCtx = await loadContratoContext(pool, osId).catch(() => null);
      const token = fallbackCtx?.os?.contrato_assinatura_token || null;
      const assinatura_link = token ? `${base}/assinatura-contrato?token=${encodeURIComponent(token)}` : null;
      return res.status(200).json({
        message: `Erro ao enviar e-mail: ${e.message || 'verifique configuração SMTP'}. Você pode enviar o link manualmente.`,
        contrato_enviado: false,
        assinatura_link,
        preview_link: `${base}/api/ordens-servico/${osId}/contrato-preview`,
        pdf_link: `${base}/api/ordens-servico/${osId}/contrato-pdf`,
        fallback_html_url: `${base}/api/ordens-servico/${osId}/contrato-html-download`,
        smtp_error_code: e.code || null,
      });
    }
    next(e);
  }
});

router.post('/ordens-servico/:id/contrato-regenerar', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const generated = await generateContratoForOs(pool, id);
    if (!generated.ok) return res.status(400).json({ message: generated.message || 'Falha ao regenerar contrato.' });
    res.json({
      message: 'Contrato regenerado com sucesso.',
      assinatura_link: generated.assinatura_link,
    });
  } catch (e) {
    if (e.code === 'PDF_GENERATION_FAILED') {
      return res.status(503).json({
        message: e.message,
        fallback_html_url: `${publicAppBase()}/api/ordens-servico/${id}/contrato-html-download`,
      });
    }
    next(e);
  }
});

router.get('/ordens-servico', async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT os.*, c.nome_empresa, c.nome_fantasia, o.id AS orcamento_numero
      FROM ordens_servico os
      JOIN clientes c ON c.id = os.cliente_id
      JOIN orcamentos o ON o.id = os.orcamento_id
      ORDER BY os.id DESC
    `);
    res.json(result.rows);
  } catch (e) {
    next(e);
  }
});

router.get('/ordens-servico/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const os = await pool.query(
      `
      SELECT os.*, c.nome_empresa, c.nome_fantasia, c.email AS cliente_email, c.telefone AS cliente_telefone,
        o.id AS orcamento_numero
      FROM ordens_servico os
      JOIN clientes c ON c.id = os.cliente_id
      JOIN orcamentos o ON o.id = os.orcamento_id
      WHERE os.id = $1
      `,
      [id],
    );
    if (os.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const linhas = await loadLinhas(id);
    const row = os.rows[0];
    row.linhas = linhas.map((l) => ({
      id: l.id,
      modelo_id: l.modelo_id,
      rotulo: l.rotulo,
      modelo_nome: l.modelo_nome,
      cache_modelo: l.cache_modelo,
      emite_nf_propria: l.emite_nf_propria,
      data_prevista_pagamento: l.data_prevista_pagamento,
      modelo_liquido: n(lineLiquido(l.cache_modelo, row.imposto_percent, row.agencia_fee_percent, l.emite_nf_propria)),
    }));
    row.documentos = await loadDocumentos(id);
    row.historico = await loadOsHistorico(id);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/ordens-servico/:id', async (_req, res) => {
  res.status(403).json({
    message:
      'O.S. nao pode ser editada: e o reflexo do orcamento aprovado. Ajustes de valores devem ser feitos no orcamento antes da aprovacao.',
  });
});

router.post('/ordens-servico/:id/cancelar', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });

    await pool.query('BEGIN');
    try {
      const osR = await pool.query(
        `SELECT id, status FROM ordens_servico WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (osR.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ message: 'O.S. nao encontrada.' });
      }
      const st = String(osR.rows[0].status || '');
      if (st === 'cancelada') {
        await pool.query('ROLLBACK');
        return res.status(400).json({ message: 'O.S. ja esta cancelada.' });
      }
      if (st === 'finalizada' || st === 'recebida') {
        await pool.query('ROLLBACK');
        return res.status(400).json({ message: 'O.S. finalizada nao pode ser cancelada.' });
      }

      const rec = await pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(valor), 0) AS soma FROM recebimentos WHERE os_id = $1`,
        [id],
      );
      const nRec = Number(rec.rows[0].n);
      const somaRec = n(rec.rows[0].soma);
      if (nRec > 0 || somaRec > 0.005) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          message: 'Nao e possivel cancelar: ha recebimentos registrados para esta O.S.',
        });
      }

      const pag = await pool.query(
        `
        SELECT COUNT(*)::int AS n
        FROM pagamentos_modelo p
        JOIN os_modelos om ON om.id = p.os_modelo_id
        WHERE om.os_id = $1
        `,
        [id],
      );
      if (Number(pag.rows[0].n) > 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          message: 'Nao e possivel cancelar: ha pagamentos a modelos registrados para esta O.S.',
        });
      }

      await pool.query(
        `
        UPDATE ordens_servico SET
          status = 'cancelada',
          emitir_contrato = FALSE,
          contrato_status = 'cancelado',
          updated_at = NOW()
        WHERE id = $1
        `,
        [id],
      );

      await pool.query('COMMIT');
      const updated = await pool.query(
        `
        SELECT os.*, c.nome_empresa, c.nome_fantasia, c.email AS cliente_email, c.telefone AS cliente_telefone,
          o.id AS orcamento_numero
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        JOIN orcamentos o ON o.id = os.orcamento_id
        WHERE os.id = $1
        `,
        [id],
      );
      res.json({
        message: 'O.S. cancelada. Fluxo de contrato desativado (emitir_contrato = false).',
        os: updated.rows[0],
      });
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
