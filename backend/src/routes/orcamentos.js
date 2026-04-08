const express = require('express');
const { pool } = require('../config/db');
const { computeOsFinancials } = require('../services/osFinanceiro');
const { buildOrcamentoDocumentHtml } = require('../services/documentoOrcamentoOsHtml');
const { generateContratoForOs, sendContratoAssinaturaEmail } = require('../services/contratoWorkflow');
const { excluirOrcamentoDefinitivo } = require('../services/excluirOrcamentoDefinitivo');

const router = express.Router();

const n = (v) => Number(v || 0);

/** FK opcional (parceiro/booker no orçamento). */
function parseOptionalFkId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const x = Number(raw);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function parseOptionalPercent(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const x = Number(raw);
  return Number.isFinite(x) && x >= 0 && x <= 100 ? x : null;
}

/** Percentual de imposto / nota fiscal sobre o total ao cliente; padrão 10%. */
function parseImpostoPercent(body) {
  const raw = body?.imposto_percent;
  if (raw === undefined || raw === null || raw === '') return 10;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 100) return 10;
  return v;
}

/**
 * Data calendário para colunas DATE (YYYY-MM-DD). Nunca usar slice(0,10) em strings tipo
 * "Thu Apr 09 2026 ..." — os primeiros 10 chars não são ISO e o Postgres rejeita (22007).
 */
function normalizeSqlDate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  if (rawValue instanceof Date) {
    if (Number.isNaN(rawValue.getTime())) return null;
    const y = rawValue.getFullYear();
    const m = String(rawValue.getMonth() + 1).padStart(2, '0');
    const day = String(rawValue.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(rawValue).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDataTrabalho(body) {
  return normalizeSqlDate(body?.data_trabalho);
}

function parseDataSimples(rawValue) {
  return normalizeSqlDate(rawValue);
}

function parseJobSemModelos(body) {
  const v = body?.job_sem_modelos;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** tipo_proposta_os e linhas efetivas: “JOB sem modelos” força sem_modelo e sem linhas. */
function resolveTipoOrcamentoFromBody(body) {
  const linhasBody = Array.isArray(body.linhas) ? body.linhas : [];
  const linhasReais = linhasBody.filter((l) => {
    const mid = l.modelo_id != null && l.modelo_id !== '' ? Number(l.modelo_id) : NaN;
    return Number.isFinite(mid) && mid > 0;
  });
  const jobSem = parseJobSemModelos(body);
  const tipoProp = jobSem ? 'sem_modelo' : linhasReais.length > 0 ? 'com_modelo' : 'sem_modelo';
  return { tipoProp, jobSem, linhasBody, linhasReais };
}

/** Derivado das linhas: há pelo menos um modelo do cadastro (IDs reais) */
function inferModelosDefinicao(linhasBody, tipoProp) {
  if (tipoProp === 'sem_modelo') return 'cadastrados';
  if (!Array.isArray(linhasBody)) return 'a_definir';
  const temCadastro = linhasBody.some((l) => {
    const mid = l.modelo_id != null && l.modelo_id !== '' ? Number(l.modelo_id) : NaN;
    return Number.isFinite(mid) && mid > 0;
  });
  return temCadastro ? 'cadastrados' : 'a_definir';
}

async function loadOrcamentoModelos(poolConn, orcamentoId) {
  const r = await poolConn.query(
    `
    SELECT
      om.id,
      om.modelo_id,
      om.cache_modelo,
      om.emite_nf_propria,
      om.rotulo,
      COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'Modelo') AS modelo_nome
    FROM orcamento_modelos om
    LEFT JOIN modelos m ON m.id = om.modelo_id
    WHERE om.orcamento_id = $1
    ORDER BY om.id
    `,
    [orcamentoId],
  );
  return r.rows;
}

/** Apenas linhas com modelo_id do cadastro (sem placeholders “Modelo 1…”). */
async function syncOrcamentoModelos(client, orcamentoId, linhas) {
  await client.query('DELETE FROM orcamento_modelos WHERE orcamento_id = $1', [orcamentoId]);
  if (!Array.isArray(linhas) || linhas.length === 0) return;
  for (const l of linhas) {
    const mid = l.modelo_id != null && l.modelo_id !== '' ? Number(l.modelo_id) : NaN;
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const cacheVal = l.cache_modelo != null && l.cache_modelo !== '' ? Number(l.cache_modelo) : NaN;
    if (!Number.isFinite(cacheVal) || cacheVal < 0) continue;
    const rotuloIn = String(l.rotulo ?? '').trim();
    await client.query(
      `
      INSERT INTO orcamento_modelos (orcamento_id, modelo_id, cache_modelo, emite_nf_propria, rotulo)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [orcamentoId, mid, cacheVal, Boolean(l.emite_nf_propria), rotuloIn],
    );
  }
}

function sumCacheFromOrcamentoModelos(rows) {
  return rows.reduce((s, r) => s + n(r.cache_modelo), 0);
}

router.get('/orcamentos/:id/pdf', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
    const html = await buildOrcamentoDocumentHtml(pool, id);
    if (!html) return res.status(404).send('Orcamento nao encontrado.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/orcamentos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const r = await pool.query(
      `
      SELECT o.*, c.nome_empresa, c.nome_fantasia
      FROM orcamentos o
      JOIN clientes c ON c.id = o.cliente_id
      WHERE o.id = $1
      `,
      [id],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Orcamento nao encontrado.' });
    const row = r.rows[0];
    row.linhas = await loadOrcamentoModelos(pool, id);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

/**
 * Lista paginada: GET /orcamentos?limit=&offset=&q=&status=&cliente_id=&sort=
 * - q: busca em nome do cliente (razão/fantasia), tipo de trabalho e descrição
 * - status: rascunho | aprovado | cancelado (omitir = todos)
 * - sort: created_at_desc (padrão) | created_at_asc
 * Resposta: { rows, total }
 */
router.get('/orcamentos', async (req, res, next) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const offsetRaw = parseInt(req.query.offset, 10);
    const limit = Number.isNaN(limitRaw) ? 20 : Math.min(Math.max(limitRaw, 1), 100);
    const offset = Number.isNaN(offsetRaw) ? 0 : Math.max(offsetRaw, 0);
    const q =
      req.query.q != null && String(req.query.q).trim() !== '' ? String(req.query.q).trim() : '';
    const status =
      req.query.status != null && String(req.query.status).trim() !== ''
        ? String(req.query.status).trim()
        : '';
    const clienteIdRaw = req.query.cliente_id;
    const clienteId =
      clienteIdRaw != null && String(clienteIdRaw).trim() !== ''
        ? Number(clienteIdRaw)
        : NaN;
    const sort = req.query.sort === 'created_at_asc' ? 'ASC' : 'DESC';

    const conditions = [];
    const params = [];
    let i = 1;

    if (q) {
      conditions.push(
        `(c.nome_empresa ILIKE $${i} OR c.nome_fantasia ILIKE $${i} OR o.tipo_trabalho ILIKE $${i} OR o.descricao ILIKE $${i})`,
      );
      params.push(`%${q}%`);
      i += 1;
    }
    if (status === 'rascunho' || status === 'aprovado' || status === 'cancelado') {
      conditions.push(`o.status = $${i}`);
      params.push(status);
      i += 1;
    }
    if (!Number.isNaN(clienteId) && clienteId > 0) {
      conditions.push(`o.cliente_id = $${i}`);
      params.push(clienteId);
      i += 1;
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS c
      FROM orcamentos o
      JOIN clientes c ON c.id = o.cliente_id
      ${whereSql}
    `,
      params,
    );
    const total = countResult.rows[0].c;

    const limIdx = params.length + 1;
    const offIdx = params.length + 2;
    const dataParams = [...params, limit, offset];

    const result = await pool.query(
      `
      SELECT
        o.*,
        c.nome_empresa,
        c.nome_fantasia
      FROM orcamentos o
      JOIN clientes c ON c.id = o.cliente_id
      ${whereSql}
      ORDER BY o.created_at ${sort}, o.id ${sort}
      LIMIT $${limIdx} OFFSET $${offIdx}
    `,
      dataParams,
    );

    res.json({ rows: result.rows, total });
  } catch (error) {
    next(error);
  }
});

router.post('/orcamentos', async (req, res, next) => {
  try {
    const requiredFields = [
      'cliente_id',
      'tipo_trabalho',
      'descricao',
      'taxa_agencia_percent',
      'extras_agencia_valor',
      'condicoes_pagamento',
      'uso_imagem',
      'prazo',
      'territorio',
    ];

    const missing = requiredFields.filter((field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
    if (missing.length > 0) {
      return res.status(400).json({ message: `Campos obrigatorios faltando: ${missing.join(', ')}` });
    }

    const { tipoProp, jobSem, linhasBody, linhasReais } = resolveTipoOrcamentoFromBody(req.body);
    const modDef = inferModelosDefinicao(linhasBody, tipoProp);
    const impostoPct = parseImpostoPercent(req.body);
    const parceiroId = parseOptionalFkId(req.body.parceiro_id);
    const parceiroPct = parseOptionalPercent(req.body.parceiro_percent);
    const bookerId = parseOptionalFkId(req.body.booker_id);
    const bookerPct = parseOptionalPercent(req.body.booker_percent);
    const valorSem = req.body.valor_servico_sem_modelo != null ? Number(req.body.valor_servico_sem_modelo) : 0;
    let cacheBase = req.body.cache_base_estimado_total != null ? Number(req.body.cache_base_estimado_total) : 0;
    if (tipoProp === 'com_modelo' && linhasReais.length > 0) {
      cacheBase = linhasReais.reduce((s, l) => {
        const c = l.cache_modelo != null && l.cache_modelo !== '' ? Number(l.cache_modelo) : 0;
        return s + (Number.isFinite(c) ? c : 0);
      }, 0);
    }

    const query = `
      INSERT INTO orcamentos (
        cliente_id,
        tipo_trabalho,
        descricao,
        cache_base_estimado_total,
        taxa_agencia_percent,
        extras_agencia_valor,
        condicoes_pagamento,
        data_vencimento,
        uso_imagem,
        prazo,
        territorio,
        data_trabalho,
        horario_trabalho,
        local_trabalho,
        tipo_proposta_os,
        valor_servico_sem_modelo,
        modelos_definicao,
        quantidade_modelos_referencia,
        imposto_percent,
        parceiro_id,
        parceiro_percent,
        booker_id,
        booker_percent,
        job_sem_modelos
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,$18,$19,$20,$21,$22,$23)
      RETURNING *
    `;
    const values = [
      req.body.cliente_id,
      req.body.tipo_trabalho,
      req.body.descricao,
      cacheBase,
      req.body.taxa_agencia_percent,
      req.body.extras_agencia_valor,
      req.body.condicoes_pagamento,
      parseDataSimples(req.body.data_vencimento),
      req.body.uso_imagem,
      req.body.prazo,
      req.body.territorio,
      parseDataTrabalho(req.body),
      String(req.body.horario_trabalho ?? '').trim(),
      String(req.body.local_trabalho ?? '').trim(),
      tipoProp,
      Number.isFinite(valorSem) ? valorSem : 0,
      modDef,
      impostoPct,
      parceiroId,
      parceiroPct,
      bookerId,
      bookerPct,
      jobSem,
    ];

    await pool.query('BEGIN');
    try {
      const result = await pool.query(query, values);
      const created = result.rows[0];
      await syncOrcamentoModelos(pool, created.id, tipoProp === 'com_modelo' ? linhasBody : []);
      await pool.query('COMMIT');
      const full = await pool.query(
        `
        SELECT o.*, c.nome_empresa, c.nome_fantasia
        FROM orcamentos o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = $1
        `,
        [created.id],
      );
      const row = full.rows[0];
      row.linhas = await loadOrcamentoModelos(pool, created.id);
      return res.status(201).json(row);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

router.put('/orcamentos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }

    const check = await pool.query('SELECT id, status FROM orcamentos WHERE id = $1', [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Orcamento nao encontrado.' });
    }
    if (check.rows[0].status !== 'rascunho') {
      return res.status(400).json({ message: 'Somente orcamento em rascunho pode ser editado.' });
    }

    const { tipoProp, jobSem, linhasBody, linhasReais } = resolveTipoOrcamentoFromBody(req.body);
    const modDef = inferModelosDefinicao(linhasBody, tipoProp);
    const impostoPct = parseImpostoPercent(req.body);
    const parceiroId = parseOptionalFkId(req.body.parceiro_id);
    const parceiroPct = parseOptionalPercent(req.body.parceiro_percent);
    const bookerId = parseOptionalFkId(req.body.booker_id);
    const bookerPct = parseOptionalPercent(req.body.booker_percent);
    const valorSem = req.body.valor_servico_sem_modelo != null ? Number(req.body.valor_servico_sem_modelo) : 0;
    let cacheBase = req.body.cache_base_estimado_total != null ? Number(req.body.cache_base_estimado_total) : 0;
    if (tipoProp === 'com_modelo' && linhasReais.length > 0) {
      cacheBase = linhasReais.reduce((s, l) => {
        const c = l.cache_modelo != null && l.cache_modelo !== '' ? Number(l.cache_modelo) : 0;
        return s + (Number.isFinite(c) ? c : 0);
      }, 0);
    }

    const query = `
      UPDATE orcamentos
      SET
        cliente_id = $1,
        tipo_trabalho = $2,
        descricao = $3,
        cache_base_estimado_total = $4,
        taxa_agencia_percent = $5,
        extras_agencia_valor = $6,
        condicoes_pagamento = $7,
        data_vencimento = $8,
        uso_imagem = $9,
        prazo = $10,
        territorio = $11,
        data_trabalho = $12,
        horario_trabalho = $13,
        local_trabalho = $14,
        tipo_proposta_os = $15,
        valor_servico_sem_modelo = $16,
        modelos_definicao = $17,
        quantidade_modelos_referencia = NULL,
        imposto_percent = $18,
        parceiro_id = $19,
        parceiro_percent = $20,
        booker_id = $21,
        booker_percent = $22,
        job_sem_modelos = $23,
        updated_at = NOW()
      WHERE id = $24
      RETURNING *
    `;
    const values = [
      req.body.cliente_id,
      req.body.tipo_trabalho,
      req.body.descricao,
      cacheBase,
      req.body.taxa_agencia_percent,
      req.body.extras_agencia_valor,
      req.body.condicoes_pagamento,
      parseDataSimples(req.body.data_vencimento),
      req.body.uso_imagem,
      req.body.prazo,
      req.body.territorio,
      parseDataTrabalho(req.body),
      String(req.body.horario_trabalho ?? '').trim(),
      String(req.body.local_trabalho ?? '').trim(),
      tipoProp,
      Number.isFinite(valorSem) ? valorSem : 0,
      modDef,
      impostoPct,
      parceiroId,
      parceiroPct,
      bookerId,
      bookerPct,
      jobSem,
      id,
    ];

    await pool.query('BEGIN');
    try {
      const result = await pool.query(query, values);
      await syncOrcamentoModelos(pool, id, tipoProp === 'com_modelo' ? linhasBody : []);
      await pool.query('COMMIT');
      const full = await pool.query(
        `
        SELECT o.*, c.nome_empresa, c.nome_fantasia
        FROM orcamentos o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = $1
        `,
        [id],
      );
      const row = full.rows[0];
      row.linhas = await loadOrcamentoModelos(pool, id);
      return res.json(row);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (error) {
    next(error);
  }
});

router.post('/orcamentos/:id/aprovar', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }

    /**
     * Transação tem de correr na MESMA conexão (pool.query usa cliente diferente por chamada).
     * Sem isto, BEGIN/COMMIT não envolvem o INSERT e o fluxo quebra ou fica inconsistente.
     */
    const client = await pool.connect();
    let budget;
    let osResult;
    try {
      await client.query('BEGIN');

      const budgetResult = await client.query('SELECT * FROM orcamentos WHERE id = $1 FOR UPDATE', [id]);
      if (budgetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ message: 'Orcamento nao encontrado.' });
      }

      budget = budgetResult.rows[0];
      if (budget.status !== 'rascunho') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ message: 'Orcamento ja foi aprovado ou cancelado.' });
      }
      if (budget.os_id_gerada != null) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ message: 'Este orcamento ja possui O.S. gerada.' });
      }

      const modRows = await loadOrcamentoModelos(client, id);
      const modRowsReais = modRows.filter((r) => r.modelo_id != null && Number(r.modelo_id) > 0);
      const jobSem = Boolean(budget.job_sem_modelos);

      let tipoProp;
      if (jobSem) {
        if (n(budget.valor_servico_sem_modelo) <= 0) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({
            message: 'Aprovacao sem modelo: informe o valor do serviço no orçamento (campo valor serviço sem modelo).',
          });
        }
        tipoProp = 'sem_modelo';
      } else {
        if (modRowsReais.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({
            message:
              'Adicione pelo menos um modelo ou marque que este trabalho não possui modelos.',
          });
        }
        for (const row of modRowsReais) {
          if (!Number.isFinite(n(row.cache_modelo)) || n(row.cache_modelo) < 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).json({ message: 'Aprovacao: cada modelo precisa de cachê válido (≥ 0).' });
          }
        }
        tipoProp = 'com_modelo';
      }

      let impostoPct = n(budget.imposto_percent);
      if (!Number.isFinite(impostoPct) || impostoPct < 0 || impostoPct > 100) impostoPct = 10;

      const linhasFin =
        tipoProp === 'com_modelo'
          ? modRowsReais.map((r) => ({
              cache_modelo: r.cache_modelo,
              emite_nf_propria: r.emite_nf_propria,
            }))
          : [];

      const parceiroPctAprov = parseOptionalPercent(budget.parceiro_percent);
      const bookerPctAprov = parseOptionalPercent(budget.booker_percent);

      const nums = computeOsFinancials({
        tipo_os: tipoProp,
        valor_servico: tipoProp === 'sem_modelo' ? n(budget.valor_servico_sem_modelo) : 0,
        cache_modelo_total:
          tipoProp === 'com_modelo' ? sumCacheFromOrcamentoModelos(modRowsReais) : n(budget.cache_base_estimado_total),
        agencia_fee_percent: budget.taxa_agencia_percent,
        extras_agencia_valor: budget.extras_agencia_valor,
        extras_despesa_valor: 0,
        imposto_percent: impostoPct,
        parceiro_percent: parceiroPctAprov,
        booker_percent: bookerPctAprov,
        linhas: linhasFin,
      });

      osResult = await client.query(
      `
      INSERT INTO ordens_servico (
        orcamento_id,
        cliente_id,
        descricao,
        tipo_os,
        data_trabalho,
        uso_imagem,
        total_cliente,
        status,
        tipo_trabalho,
        prazo,
        territorio,
        condicoes_pagamento,
        data_vencimento_cliente,
        valor_servico,
        cache_modelo_total,
        agencia_fee_percent,
        taxa_agencia_valor,
        extras_agencia_valor,
        extras_despesa_valor,
        extras_despesa_descricao,
        imposto_percent,
        imposto_valor,
        modelo_liquido_total,
        agencia_parcial,
        parceiro_id,
        parceiro_percent,
        parceiro_valor,
        agencia_apos_parceiro,
        booker_id,
        booker_percent,
        booker_valor,
        agencia_final,
        resultado_agencia,
        emitir_contrato
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'ativa',
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, $27, $28, $29, $30, $31, $32, TRUE
      )
      RETURNING *
      `,
      [
        budget.id,
        budget.cliente_id,
        budget.descricao,
        tipoProp,
        parseDataSimples(budget.data_trabalho),
        budget.uso_imagem,
        nums.total_cliente,
        budget.tipo_trabalho,
        budget.prazo,
        budget.territorio,
        budget.condicoes_pagamento,
        parseDataSimples(budget.data_vencimento),
        tipoProp === 'sem_modelo' ? n(budget.valor_servico_sem_modelo) : 0,
        nums.cache_modelo_total,
        budget.taxa_agencia_percent,
        nums.taxa_agencia_valor,
        budget.extras_agencia_valor,
        0,
        '',
        impostoPct,
        nums.imposto_valor,
        nums.modelo_liquido_total,
        nums.agencia_parcial,
        parseOptionalFkId(budget.parceiro_id),
        parceiroPctAprov,
        nums.parceiro_valor,
        nums.agencia_apos_parceiro,
        parseOptionalFkId(budget.booker_id),
        bookerPctAprov,
        nums.booker_valor,
        nums.agencia_final,
        nums.resultado_agencia,
      ],
    );

      const osIdTx = osResult.rows[0].id;

      if (tipoProp === 'com_modelo') {
        for (const row of modRowsReais) {
          const rotulo = String(row.rotulo || '').trim() || String(row.modelo_nome || 'Modelo');
          await client.query(
            `
            INSERT INTO os_modelos (os_id, modelo_id, cache_modelo, emite_nf_propria, rotulo)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [osIdTx, row.modelo_id, row.cache_modelo, Boolean(row.emite_nf_propria), rotulo],
          );
        }
      }

      await client.query(
        `
        UPDATE orcamentos
        SET status = 'aprovado', os_id_gerada = $2, updated_at = NOW()
        WHERE id = $1
        `,
        [id, osIdTx],
      );

      await client.query('COMMIT');
    } catch (txErr) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        if (rbErr?.code !== '25P01' && !/no active sql transaction/i.test(String(rbErr.message || ''))) {
          console.warn('[orcamentos/aprovar] rollback:', rbErr);
        }
      }
      client.release();
      return next(txErr);
    }
    client.release();

    const osId = osResult.rows[0].id;

    /**
     * Pós-commit: geração de PDF/e-mail não pode falhar a resposta nem disparar ROLLBACK
     * (a O.S. já foi persistida). Antes, um erro aqui + ROLLBACK repetido gerava 500 genérico.
     */
    let contrato = { ok: false, message: '', assinatura_link: null, code: '' };
    try {
      contrato = await generateContratoForOs(pool, osId);
    } catch (e) {
      console.error('[orcamentos/aprovar] generateContratoForOs (pós-commit)', e);
      contrato = {
        ok: false,
        message: e?.message || 'Falha ao gerar contrato.',
        assinatura_link: null,
        code: e?.code ? String(e.code) : '',
      };
    }

    let envio = { contrato_enviado: false, motivo: '' };
    if (contrato.ok) {
      try {
        const clienteR = await pool.query(`SELECT email FROM clientes WHERE id = $1`, [budget.cliente_id]);
        const clienteEmail = clienteR.rows[0]?.email || null;
        if (clienteEmail) {
          try {
            await sendContratoAssinaturaEmail(pool, osId, clienteEmail);
            envio = { contrato_enviado: true, motivo: '' };
          } catch (mailErr) {
            envio = { contrato_enviado: false, motivo: mailErr?.message || 'Falha ao enviar e-mail.' };
          }
        } else {
          envio = { contrato_enviado: false, motivo: 'Cliente sem e-mail cadastrado. Use o link de assinatura.' };
        }
      } catch (envErr) {
        console.error('[orcamentos/aprovar] envio contrato (pós-commit)', envErr);
        envio = { contrato_enviado: false, motivo: envErr?.message || 'Falha ao preparar envio do contrato.' };
      }
    } else {
      envio = { contrato_enviado: false, motivo: contrato.message || 'Falha ao gerar contrato automático.' };
    }

    const msgOk = 'Orcamento aprovado e O.S. criada com sucesso.';
    const msgAviso =
      !contrato.ok || !envio.contrato_enviado
        ? ' O.S. criada; verifique contrato/PDF ou e-mail se houver aviso abaixo.'
        : '';

    return res.json({
      message: msgOk + msgAviso,
      os: osResult.rows[0],
      contrato: {
        gerado: Boolean(contrato.ok),
        assinatura_link: contrato.assinatura_link || null,
        contrato_enviado: envio.contrato_enviado,
        envio_erro: envio.motivo || null,
        erro_codigo: contrato.code || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/orcamentos/:id/cancelar', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const r = await pool.query('SELECT id, status FROM orcamentos WHERE id = $1', [id]);
    if (r.rows.length === 0) {
      return res.status(404).json({ message: 'Orcamento nao encontrado.' });
    }
    if (r.rows[0].status !== 'rascunho') {
      return res.status(400).json({
        message: 'Somente orcamento em rascunho pode ser cancelado.',
      });
    }
    await pool.query(`UPDATE orcamentos SET status = 'cancelado', updated_at = NOW() WHERE id = $1`, [id]);
    const full = await pool.query(
      `
      SELECT o.*, c.nome_empresa, c.nome_fantasia
      FROM orcamentos o
      JOIN clientes c ON c.id = o.cliente_id
      WHERE o.id = $1
      `,
      [id],
    );
    return res.json({
      message: 'Orcamento cancelado.',
      orcamento: full.rows[0],
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Administrador: remove o orçamento e a O.S. gerada (job), documentos/contrato e financeiro da O.S.
 * Irreversível — para limpar testes ou erros.
 */
router.delete('/orcamentos/:id/definitivo', async (req, res, next) => {
  try {
    const result = await excluirOrcamentoDefinitivo(pool, req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    return res.json({
      message: result.message,
      os_ids_removidos: result.os_ids_removidos,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
