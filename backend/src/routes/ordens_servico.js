const express = require('express');
const { pool } = require('../config/db');
const { computeOsFinancials, lineLiquido } = require('../services/osFinanceiro');
const { buildContratoDocumentHtml } = require('../services/contratoHtml');
const { loadContratoContext } = require('../services/contratoContext');
const { sendContratoEmail } = require('../services/contratoEmail');
const { validarContratoPronto } = require('../services/contratoReadiness');
const { buildOsDocumentHtml } = require('../services/documentoOrcamentoOsHtml');

const router = express.Router();

const n = (v) => Number(v || 0);

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
    SELECT om.*, m.nome AS modelo_nome
    FROM os_modelos om
    JOIN modelos m ON m.id = om.modelo_id
    WHERE om.os_id = $1
    ORDER BY om.id
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
    const html = buildContratoDocumentHtml(ctx);
    const subject =
      process.env.CONTRATO_EMAIL_ASSUNTO ||
      `Contrato — O.S. nº ${id} — ${ctx.cliente.nome_fantasia || ctx.cliente.nome_empresa || 'Cliente'}`;
    await sendContratoEmail({ to: String(destinatario).trim(), subject, html });
    await pool.query(
      `
      UPDATE ordens_servico
      SET contrato_enviado_em = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );
    res.json({ message: 'Contrato enviado por e-mail.', contrato_enviado: true });
  } catch (e) {
    if (e.code === 'SMTP_DISABLED') {
      return res.status(503).json({
        message: e.message,
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
      modelo_nome: l.modelo_nome,
      cache_modelo: l.cache_modelo,
      emite_nf_propria: l.emite_nf_propria,
      data_prevista_pagamento: l.data_prevista_pagamento,
      modelo_liquido: n(lineLiquido(l.cache_modelo, row.imposto_percent, row.agencia_fee_percent, l.emite_nf_propria)),
    }));
    row.documentos = await loadDocumentos(id);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/ordens-servico/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });

    const existing = await pool.query('SELECT * FROM ordens_servico WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    if (existing.rows[0].status === 'recebida') {
      return res.status(400).json({ message: 'O.S. recebida nao pode ser editada.' });
    }

    const body = req.body;
    const tipoOs = body.tipo_os || existing.rows[0].tipo_os || 'com_modelo';
    const linhasBody = Array.isArray(body.linhas) ? body.linhas : null;

    await pool.query('BEGIN');
    try {
      const merged = {
        tipo_os: tipoOs,
        descricao: body.descricao ?? existing.rows[0].descricao,
        data_trabalho: body.data_trabalho ?? existing.rows[0].data_trabalho,
        uso_imagem: body.uso_imagem ?? existing.rows[0].uso_imagem,
        tipo_trabalho: body.tipo_trabalho ?? existing.rows[0].tipo_trabalho,
        prazo: body.prazo ?? existing.rows[0].prazo,
        territorio: body.territorio ?? existing.rows[0].territorio,
        condicoes_pagamento: body.condicoes_pagamento ?? existing.rows[0].condicoes_pagamento,
        valor_servico: body.valor_servico != null ? body.valor_servico : existing.rows[0].valor_servico,
        agencia_fee_percent: body.agencia_fee_percent != null ? body.agencia_fee_percent : existing.rows[0].agencia_fee_percent,
        extras_agencia_valor: body.extras_agencia_valor != null ? body.extras_agencia_valor : existing.rows[0].extras_agencia_valor,
        extras_despesa_valor: body.extras_despesa_valor != null ? body.extras_despesa_valor : existing.rows[0].extras_despesa_valor,
        extras_despesa_descricao: body.extras_despesa_descricao ?? existing.rows[0].extras_despesa_descricao,
        imposto_percent: body.imposto_percent != null ? body.imposto_percent : existing.rows[0].imposto_percent,
        parceiro_id: body.parceiro_id !== undefined ? body.parceiro_id || null : existing.rows[0].parceiro_id,
        parceiro_percent: body.parceiro_percent !== undefined ? body.parceiro_percent || null : existing.rows[0].parceiro_percent,
        booker_id: body.booker_id !== undefined ? body.booker_id || null : existing.rows[0].booker_id,
        booker_percent: body.booker_percent !== undefined ? body.booker_percent || null : existing.rows[0].booker_percent,
        emitir_contrato:
          body.emitir_contrato !== undefined ? Boolean(body.emitir_contrato) : existing.rows[0].emitir_contrato,
        contrato_template_versao:
          body.contrato_template_versao !== undefined
            ? body.contrato_template_versao || null
            : existing.rows[0].contrato_template_versao,
        contrato_observacao:
          body.contrato_observacao !== undefined
            ? body.contrato_observacao
            : existing.rows[0].contrato_observacao,
        data_vencimento_cliente:
          body.data_vencimento_cliente !== undefined
            ? body.data_vencimento_cliente || null
            : existing.rows[0].data_vencimento_cliente,
      };

      const signedCheck = await pool.query(
        `SELECT 1 FROM os_documentos WHERE os_id = $1 AND tipo = 'contrato_assinado_scan' LIMIT 1`,
        [id],
      );
      let contratoStatus = existing.rows[0].contrato_status;
      if (!merged.emitir_contrato) {
        contratoStatus = null;
      } else if (signedCheck.rows.length > 0) {
        contratoStatus = 'recebido';
      } else {
        contratoStatus = 'aguardando_assinatura';
      }

      let linhasForCalc = [];
      if (tipoOs === 'sem_modelo') {
        await pool.query('DELETE FROM os_modelos WHERE os_id = $1', [id]);
      } else if (linhasBody && linhasBody.length > 0) {
        await pool.query('DELETE FROM os_modelos WHERE os_id = $1', [id]);
        for (const l of linhasBody) {
          if (!l.modelo_id || l.cache_modelo == null || l.cache_modelo === '') {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: 'Cada linha precisa de modelo_id e cache_modelo.' });
          }
          const emite = Boolean(l.emite_nf_propria);
          const prev = l.data_prevista_pagamento || null;
          await pool.query(
            `
            INSERT INTO os_modelos (os_id, modelo_id, cache_modelo, emite_nf_propria, data_prevista_pagamento)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id, l.modelo_id, l.cache_modelo, emite, prev],
          );
        }
        linhasForCalc = await loadLinhas(id);
      } else if (tipoOs === 'com_modelo') {
        linhasForCalc = await loadLinhas(id);
      }

      const cacheModeloTotalField =
        tipoOs === 'com_modelo' && linhasForCalc.length > 0
          ? linhasForCalc.reduce((s, l) => s + n(l.cache_modelo), 0)
          : body.cache_modelo_total != null
            ? body.cache_modelo_total
            : existing.rows[0].cache_modelo_total;

      if (
        tipoOs === 'com_modelo'
        && linhasForCalc.length === 0
        && (!cacheModeloTotalField || n(cacheModeloTotalField) <= 0)
      ) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          message: 'O.S. com modelo: informe linhas de modelo ou cachê modelo total valido.',
        });
      }

      if (merged.emitir_contrato) {
        const errosContrato = await validarContratoPronto(pool, id, merged, tipoOs);
        if (errosContrato.length > 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({
            message: `Contrato: complete os dados antes de ativar — ${errosContrato.join('; ')}.`,
          });
        }
      }

      const nums = computeOsFinancials({
        tipo_os: tipoOs,
        valor_servico: merged.valor_servico,
        cache_modelo_total: cacheModeloTotalField,
        agencia_fee_percent: merged.agencia_fee_percent,
        extras_agencia_valor: merged.extras_agencia_valor,
        extras_despesa_valor: merged.extras_despesa_valor,
        imposto_percent: merged.imposto_percent,
        parceiro_percent: merged.parceiro_percent,
        booker_percent: merged.booker_percent,
        linhas: linhasForCalc.map((l) => ({
          cache_modelo: l.cache_modelo,
          emite_nf_propria: l.emite_nf_propria,
        })),
      });

      await pool.query(
        `
        UPDATE ordens_servico SET
          tipo_os = $1,
          descricao = $2,
          data_trabalho = $3,
          uso_imagem = $4,
          tipo_trabalho = $5,
          prazo = $6,
          territorio = $7,
          condicoes_pagamento = $8,
          valor_servico = $9,
          cache_modelo_total = $10,
          agencia_fee_percent = $11,
          taxa_agencia_valor = $12,
          extras_agencia_valor = $13,
          extras_despesa_valor = $14,
          extras_despesa_descricao = $15,
          imposto_percent = $16,
          imposto_valor = $17,
          modelo_liquido_total = $18,
          agencia_parcial = $19,
          parceiro_id = $20,
          parceiro_percent = $21,
          parceiro_valor = $22,
          agencia_apos_parceiro = $23,
          booker_id = $24,
          booker_percent = $25,
          booker_valor = $26,
          agencia_final = $27,
          resultado_agencia = $28,
          total_cliente = $29,
          emitir_contrato = $30,
          contrato_template_versao = $31,
          contrato_observacao = $32,
          contrato_status = $33,
          data_vencimento_cliente = $34,
          updated_at = NOW()
        WHERE id = $35
        `,
        [
          merged.tipo_os,
          merged.descricao,
          merged.data_trabalho || null,
          merged.uso_imagem,
          merged.tipo_trabalho,
          merged.prazo,
          merged.territorio,
          merged.condicoes_pagamento,
          merged.valor_servico,
          nums.cache_modelo_total,
          merged.agencia_fee_percent,
          nums.taxa_agencia_valor,
          merged.extras_agencia_valor,
          merged.extras_despesa_valor,
          merged.extras_despesa_descricao || '',
          merged.imposto_percent,
          nums.imposto_valor,
          nums.modelo_liquido_total,
          nums.agencia_parcial,
          merged.parceiro_id,
          merged.parceiro_percent,
          nums.parceiro_valor,
          nums.agencia_apos_parceiro,
          merged.booker_id,
          merged.booker_percent,
          nums.booker_valor,
          nums.agencia_final,
          nums.resultado_agencia,
          nums.total_cliente,
          merged.emitir_contrato,
          merged.contrato_template_versao,
          merged.contrato_observacao || '',
          contratoStatus,
          merged.data_vencimento_cliente || null,
          id,
        ],
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
      const row = updated.rows[0];
      row.linhas = (await loadLinhas(id)).map((l) => ({
        id: l.id,
        modelo_id: l.modelo_id,
        modelo_nome: l.modelo_nome,
        cache_modelo: l.cache_modelo,
        emite_nf_propria: l.emite_nf_propria,
        data_prevista_pagamento: l.data_prevista_pagamento,
        modelo_liquido: n(
          lineLiquido(l.cache_modelo, row.imposto_percent, row.agencia_fee_percent, l.emite_nf_propria),
        ),
      }));
      row.documentos = await loadDocumentos(id);
      res.json(row);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
