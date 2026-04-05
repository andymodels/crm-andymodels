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

function strVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function collectOsDiffs({ prev, next, linhasAntes, linhasDepois }) {
  const diffs = [];
  const cmp = (campo, a, b) => {
    if (strVal(a) !== strVal(b)) {
      diffs.push({ campo, valor_anterior: strVal(a), valor_novo: strVal(b) });
    }
  };
  cmp('descricao', prev.descricao, next.descricao);
  cmp('data_trabalho', prev.data_trabalho, next.data_trabalho);
  cmp('uso_imagem', prev.uso_imagem, next.uso_imagem);
  cmp('tipo_trabalho', prev.tipo_trabalho, next.tipo_trabalho);
  cmp('prazo', prev.prazo, next.prazo);
  cmp('territorio', prev.territorio, next.territorio);
  cmp('condicoes_pagamento', prev.condicoes_pagamento, next.condicoes_pagamento);
  cmp('valor_servico', prev.valor_servico, next.valor_servico);
  cmp('tipo_os', prev.tipo_os, next.tipo_os);
  cmp('agencia_fee_percent', prev.agencia_fee_percent, next.agencia_fee_percent);
  cmp('extras_agencia_valor', prev.extras_agencia_valor, next.extras_agencia_valor);
  cmp('extras_despesa_valor', prev.extras_despesa_valor, next.extras_despesa_valor);
  cmp('extras_despesa_descricao', prev.extras_despesa_descricao, next.extras_despesa_descricao);
  cmp('imposto_percent', prev.imposto_percent, next.imposto_percent);
  cmp('parceiro_id', prev.parceiro_id, next.parceiro_id);
  cmp('parceiro_percent', prev.parceiro_percent, next.parceiro_percent);
  cmp('booker_id', prev.booker_id, next.booker_id);
  cmp('booker_percent', prev.booker_percent, next.booker_percent);
  cmp('emitir_contrato', prev.emitir_contrato, next.emitir_contrato);
  cmp('contrato_template_versao', prev.contrato_template_versao, next.contrato_template_versao);
  cmp('contrato_observacao', prev.contrato_observacao, next.contrato_observacao);
  cmp('data_vencimento_cliente', prev.data_vencimento_cliente, next.data_vencimento_cliente);

  const la = (linhasAntes || []).map((l) => ({
    modelo_id: l.modelo_id,
    rotulo: l.rotulo || '',
    cache_modelo: n(l.cache_modelo),
    emite_nf_propria: Boolean(l.emite_nf_propria),
    data_prevista_pagamento: l.data_prevista_pagamento || null,
  }));
  const ld = (linhasDepois || []).map((l) => ({
    modelo_id: l.modelo_id,
    rotulo: l.rotulo || '',
    cache_modelo: n(l.cache_modelo),
    emite_nf_propria: Boolean(l.emite_nf_propria),
    data_prevista_pagamento: l.data_prevista_pagamento || null,
  }));
  if (JSON.stringify(la) !== JSON.stringify(ld)) {
    diffs.push({
      campo: 'linhas_modelos',
      valor_anterior: JSON.stringify(la),
      valor_novo: JSON.stringify(ld),
    });
  }
  return diffs;
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

router.put('/ordens-servico/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });

    const existing = await pool.query('SELECT * FROM ordens_servico WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    if (existing.rows[0].status === 'recebida') {
      return res.status(400).json({ message: 'O.S. recebida nao pode ser editada.' });
    }

    const oldRow = existing.rows[0];
    const oldLinhas = await loadLinhas(id);

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
      } else if (tipoOs === 'com_modelo') {
        if (!Array.isArray(linhasBody)) {
          await pool.query('ROLLBACK');
          return res.status(400).json({
            message: 'O.S. com modelo: envie o array "linhas" com pelo menos um modelo (modelo_id, cache_modelo).',
          });
        }
        if (linhasBody.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({
            message: 'O.S. com modelo exige pelo menos uma linha de modelo com cachê definido.',
          });
        }
        await pool.query('DELETE FROM os_modelos WHERE os_id = $1', [id]);
        for (const l of linhasBody) {
          const midRaw = l.modelo_id != null && l.modelo_id !== '' ? Number(l.modelo_id) : NaN;
          const cacheVal = l.cache_modelo != null && l.cache_modelo !== '' ? Number(l.cache_modelo) : NaN;
          if (!Number.isFinite(cacheVal) || cacheVal < 0) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: 'Cada linha precisa de cachê do modelo (valor numérico ≥ 0).' });
          }
          const emite = Boolean(l.emite_nf_propria);
          const prev = l.data_prevista_pagamento || null;
          const rotulo = String(l.rotulo ?? '').trim() || 'Modelo';
          if (Number.isFinite(midRaw) && midRaw > 0) {
            await pool.query(
              `
              INSERT INTO os_modelos (os_id, modelo_id, cache_modelo, emite_nf_propria, data_prevista_pagamento, rotulo)
              VALUES ($1, $2, $3, $4, $5, $6)
              `,
              [id, midRaw, cacheVal, emite, prev, rotulo],
            );
          } else {
            await pool.query(
              `
              INSERT INTO os_modelos (os_id, modelo_id, cache_modelo, emite_nf_propria, data_prevista_pagamento, rotulo)
              VALUES ($1, NULL, $2, $3, $4, $5)
              `,
              [id, cacheVal, emite, prev, rotulo],
            );
          }
        }
        linhasForCalc = await loadLinhas(id);
      }

      const cacheModeloTotalField =
        tipoOs === 'com_modelo'
          ? linhasForCalc.reduce((s, l) => s + n(l.cache_modelo), 0)
          : body.cache_modelo_total != null
            ? body.cache_modelo_total
            : existing.rows[0].cache_modelo_total;

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

      const newLinhasSnapshot = await loadLinhas(id);
      const usuario = String(body.usuario || '').trim();
      const snapshotNext = {
        descricao: merged.descricao,
        data_trabalho: merged.data_trabalho || null,
        uso_imagem: merged.uso_imagem,
        tipo_trabalho: merged.tipo_trabalho,
        prazo: merged.prazo,
        territorio: merged.territorio,
        condicoes_pagamento: merged.condicoes_pagamento,
        valor_servico: merged.valor_servico,
        tipo_os: merged.tipo_os,
        agencia_fee_percent: merged.agencia_fee_percent,
        extras_agencia_valor: merged.extras_agencia_valor,
        extras_despesa_valor: merged.extras_despesa_valor,
        extras_despesa_descricao: merged.extras_despesa_descricao || '',
        imposto_percent: merged.imposto_percent,
        parceiro_id: merged.parceiro_id,
        parceiro_percent: merged.parceiro_percent,
        booker_id: merged.booker_id,
        booker_percent: merged.booker_percent,
        emitir_contrato: merged.emitir_contrato,
        contrato_template_versao: merged.contrato_template_versao,
        contrato_observacao: merged.contrato_observacao || '',
        data_vencimento_cliente: merged.data_vencimento_cliente || null,
      };
      const diffs = collectOsDiffs({
        prev: oldRow,
        next: snapshotNext,
        linhasAntes: oldLinhas,
        linhasDepois: newLinhasSnapshot,
      });
      if (diffs.length > 0) {
        if (!usuario || usuario.length < 2) {
          await pool.query('ROLLBACK');
          return res.status(400).json({
            message:
              'Informe o campo "usuario" (nome de quem altera) com pelo menos 2 caracteres para registrar o histórico de alterações da O.S.',
          });
        }
        for (const d of diffs) {
          await pool.query(
            `
            INSERT INTO os_historico (os_id, usuario, campo, valor_anterior, valor_novo)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [id, usuario, d.campo, d.valor_anterior, d.valor_novo],
          );
        }
      }

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
        rotulo: l.rotulo,
        modelo_nome: l.modelo_nome,
        cache_modelo: l.cache_modelo,
        emite_nf_propria: l.emite_nf_propria,
        data_prevista_pagamento: l.data_prevista_pagamento,
        modelo_liquido: n(
          lineLiquido(l.cache_modelo, row.imposto_percent, row.agencia_fee_percent, l.emite_nf_propria),
        ),
      }));
      row.documentos = await loadDocumentos(id);
      row.historico = await loadOsHistorico(id);
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
