const express = require('express');
const { pool } = require('../config/db');
const { lineLiquido } = require('../services/osFinanceiro');
const { suggestFromModeloRow, suggestFromClienteRow } = require('../utils/finPixSuggest');
const { upsertPagamentoLine, upsertFinMovModeloLine } = require('../services/extratoModeloSync');

const router = express.Router();

const n = (v) => Number(v || 0);

const PESSOA_TIPOS = ['modelo', 'booker', 'parceiro'];

/** Manual: só operacional da agência — nunca cachê/comissão (isso vem só da O.S.). */
const CATEGORIAS_DESPESA = ['impostos', 'operacional', 'outros'];

router.get('/financeiro/resumo', async (_req, res, next) => {
  try {
    const [rec, pag, osAbertas, osTotais, despesasT] = await Promise.all([
      pool.query('SELECT COALESCE(SUM(valor), 0) AS t FROM recebimentos'),
      pool.query('SELECT COALESCE(SUM(valor), 0) AS t FROM pagamentos_modelo'),
      pool.query(`
        SELECT COALESCE(SUM(total_cliente), 0) AS t
        FROM ordens_servico
        WHERE status = 'ativa'
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(total_cliente), 0) AS soma_total_cliente,
          COALESCE(SUM(modelo_liquido_total), 0) AS soma_modelo_liquido,
          COALESCE(SUM(parceiro_valor), 0) AS soma_parceiro_valor,
          COALESCE(SUM(booker_valor), 0) AS soma_booker_valor,
          COALESCE(SUM(resultado_agencia), 0) AS soma_resultado_agencia
        FROM ordens_servico
      `),
      pool.query('SELECT COALESCE(SUM(valor), 0) AS t FROM despesas'),
    ]);

    const totalRecebido = Number(rec.rows[0].t);
    const totalPagoModelos = Number(pag.rows[0].t);
    const totalAReceberOs = Number(osAbertas.rows[0].t);
    const rowOs = osTotais.rows[0];
    const totalDespesas = Number(despesasT.rows[0].t);
    const somaParceiroOs = Number(rowOs.soma_parceiro_valor);
    const somaBookerOs = Number(rowOs.soma_booker_valor);
    /** Comissões = soma dos valores já gravados na O.S. (sem recálculo no financeiro). */
    const totalComissoesOs = somaParceiroOs + somaBookerOs;
    const resultadoFinal = totalRecebido - totalPagoModelos - totalComissoesOs - totalDespesas;

    res.json({
      total_recebido_cliente: totalRecebido,
      total_pago_modelos: totalPagoModelos,
      total_comissoes_os: totalComissoesOs,
      total_despesas: totalDespesas,
      resultado_final: resultadoFinal,
      total_faturado_os_abertas: totalAReceberOs,
      soma_total_cliente_os: Number(rowOs.soma_total_cliente),
      soma_modelo_liquido_os: Number(rowOs.soma_modelo_liquido),
      soma_parceiro_valor_os: somaParceiroOs,
      soma_booker_valor_os: somaBookerOs,
      soma_resultado_agencia_os: Number(rowOs.soma_resultado_agencia),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/os/:id/contexto', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const os = await pool.query(
      `
      SELECT os.id, os.total_cliente, os.status, os.condicoes_pagamento, os.descricao
      FROM ordens_servico os
      WHERE os.id = $1
      `,
      [id],
    );
    if (os.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const row = os.rows[0];
    const rec = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS recebido FROM recebimentos WHERE os_id = $1`,
      [id],
    );
    const recebido = n(rec.rows[0].recebido);
    const totalCliente = n(row.total_cliente);
    const saldoReceber = Math.max(0, totalCliente - recebido);
    res.json({
      os_id: row.id,
      total_cliente: totalCliente,
      recebido,
      saldo_receber: saldoReceber,
      status: row.status,
      condicoes_pagamento: row.condicoes_pagamento,
      descricao: row.descricao,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/recebimentos', async (req, res, next) => {
  try {
    const osId = req.query.os_id ? Number(req.query.os_id) : null;
    let sql = `
      SELECT r.*, c.nome_empresa, c.nome_fantasia
      FROM recebimentos r
      JOIN ordens_servico os ON os.id = r.os_id
      JOIN clientes c ON c.id = os.cliente_id
    `;
    const params = [];
    if (osId != null && !Number.isNaN(osId)) {
      sql += ' WHERE r.os_id = $1';
      params.push(osId);
    }
    sql += ' ORDER BY r.data_recebimento DESC, r.id DESC LIMIT 200';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/recebimentos', async (req, res, next) => {
  try {
    const { os_id, valor, data_recebimento, observacao, forma_pagamento, destino_pagamento } = req.body;
    if (os_id == null || valor == null || !data_recebimento) {
      return res.status(400).json({ message: 'os_id, valor e data_recebimento sao obrigatorios.' });
    }
    const osCheck = await pool.query(
      'SELECT id, total_cliente, status FROM ordens_servico WHERE id = $1',
      [os_id],
    );
    if (osCheck.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const st = String(osCheck.rows[0].status || '');
    if (st === 'cancelada') {
      return res.status(400).json({ message: 'O.S. cancelada nao aceita recebimentos.' });
    }
    const totalCliente = n(osCheck.rows[0].total_cliente);
    const recBefore = await pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS recebido FROM recebimentos WHERE os_id = $1`,
      [os_id],
    );
    const recebidoAntes = n(recBefore.rows[0].recebido);
    const saldo = Math.max(0, totalCliente - recebidoAntes);
    const valorNum = n(valor);
    if (valorNum <= 0) {
      return res.status(400).json({ message: 'Valor deve ser maior que zero.' });
    }
    if (saldo <= 0.005) {
      return res.status(400).json({
        message: 'Nao ha saldo a receber nesta O.S. conforme total_cliente e recebimentos ja registrados.',
      });
    }
    if (valorNum > saldo + 0.02) {
      return res.status(400).json({
        message: `Valor acima do saldo em aberto (${saldo.toFixed(2)}). Ajuste o valor ou confira a O.S.`,
      });
    }

    await pool.query('BEGIN');
    try {
      const ins = await pool.query(
        `
        INSERT INTO recebimentos (os_id, valor, data_recebimento, observacao, forma_pagamento, destino_pagamento)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
          os_id,
          valor,
          data_recebimento,
          observacao || '',
          String(forma_pagamento || '').trim().slice(0, 80),
          String(destino_pagamento || '').trim().slice(0, 500),
        ],
      );
      await pool.query(
        `
        UPDATE ordens_servico
        SET status = 'finalizada', updated_at = NOW()
        WHERE id = $1
        `,
        [os_id],
      );
      await pool.query('COMMIT');
      res.status(201).json(ins.rows[0]);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/pagamentos-modelo', async (req, res, next) => {
  try {
    const osId = req.query.os_id ? Number(req.query.os_id) : null;
    let sql = `
      SELECT
        p.*,
        COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
        om.os_id
      FROM pagamentos_modelo p
      JOIN os_modelos om ON om.id = p.os_modelo_id
      LEFT JOIN modelos m ON m.id = om.modelo_id
    `;
    const params = [];
    if (osId != null && !Number.isNaN(osId)) {
      sql += ' WHERE om.os_id = $1';
      params.push(osId);
    }
    sql += ' ORDER BY p.data_pagamento DESC, p.id DESC LIMIT 200';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/pagamentos-modelo', async (req, res, next) => {
  try {
    const { os_modelo_id, valor, data_pagamento, observacao, forma_pagamento, destino_pagamento } = req.body;
    if (os_modelo_id == null || valor == null || !data_pagamento) {
      return res.status(400).json({ message: 'os_modelo_id, valor e data_pagamento sao obrigatorios.' });
    }
    const check = await pool.query(
      `
      SELECT om.id, os.status, os.emitir_contrato, os.contrato_status
      FROM os_modelos om
      JOIN ordens_servico os ON os.id = om.os_id
      WHERE om.id = $1
      `,
      [os_modelo_id],
    );
    if (check.rows.length === 0) return res.status(404).json({ message: 'Linha de modelo (os_modelo) nao encontrada.' });
    if (String(check.rows[0].status || '') === 'cancelada') {
      return res.status(400).json({ message: 'O.S. cancelada nao aceita novos pagamentos a modelos.' });
    }
    const rowOs = check.rows[0];
    if (rowOs.emitir_contrato === true) {
      const cs = String(rowOs.contrato_status || '').toLowerCase();
      if (cs !== 'assinado' && cs !== 'recebido') {
        return res.status(400).json({
          message: 'Pagamento bloqueado: contrato ainda não assinado.',
        });
      }
    }

    const ins = await pool.query(
      `
      INSERT INTO pagamentos_modelo (os_modelo_id, valor, data_pagamento, observacao, forma_pagamento, destino_pagamento)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        os_modelo_id,
        valor,
        data_pagamento,
        observacao || '',
        String(forma_pagamento || '').trim().slice(0, 80),
        String(destino_pagamento || '').trim().slice(0, 500),
      ],
    );
    await upsertPagamentoLine(pool, ins.rows[0].id);
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/despesas', async (req, res, next) => {
  try {
    const dataDe = req.query.data_de ? String(req.query.data_de).slice(0, 10) : '';
    const dataAte = req.query.data_ate ? String(req.query.data_ate).slice(0, 10) : '';
    const catIn = req.query.categoria ? String(req.query.categoria).trim() : '';
    const osId = req.query.os_id ? Number(req.query.os_id) : null;

    let sql = `SELECT d.* FROM despesas d`;
    const cond = [];
    const params = [];
    let i = 1;
    if (dataDe) {
      cond.push(`d.data_despesa >= $${i}`);
      params.push(dataDe);
      i += 1;
    }
    if (dataAte) {
      cond.push(`d.data_despesa <= $${i}`);
      params.push(dataAte);
      i += 1;
    }
    if (catIn && CATEGORIAS_DESPESA.includes(catIn)) {
      cond.push(`d.categoria = $${i}`);
      params.push(catIn);
      i += 1;
    }
    if (osId != null && !Number.isNaN(osId)) {
      cond.push(`d.os_id = $${i}`);
      params.push(osId);
      i += 1;
    }
    if (cond.length > 0) {
      sql += ` WHERE ${cond.join(' AND ')}`;
    }
    sql += ' ORDER BY d.data_despesa DESC, d.id DESC LIMIT 500';
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/despesas', async (req, res, next) => {
  try {
    const { data_despesa, descricao, valor, categoria, os_id } = req.body;
    if (!data_despesa || descricao == null || String(descricao).trim() === '' || valor == null || !categoria) {
      return res.status(400).json({ message: 'data_despesa, descricao, valor e categoria sao obrigatorios.' });
    }
    const cat = String(categoria).trim();
    if (!CATEGORIAS_DESPESA.includes(cat)) {
      return res.status(400).json({
        message: `Categoria invalida. Use: ${CATEGORIAS_DESPESA.join(', ')}.`,
      });
    }
    const valorNum = n(valor);
    if (valorNum <= 0) {
      return res.status(400).json({ message: 'Valor deve ser maior que zero.' });
    }
    let osIdVal = null;
    if (os_id != null && os_id !== '') {
      const oid = Number(os_id);
      if (Number.isNaN(oid)) {
        return res.status(400).json({ message: 'os_id invalido.' });
      }
      const osCheck = await pool.query('SELECT id FROM ordens_servico WHERE id = $1', [oid]);
      if (osCheck.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
      osIdVal = oid;
    }

    const ins = await pool.query(
      `
      INSERT INTO despesas (data_despesa, descricao, valor, categoria, os_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [String(data_despesa).slice(0, 10), String(descricao).trim(), valorNum, cat, osIdVal],
    );
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/financeiro/despesas/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID invalido.' });
    const r = await pool.query('DELETE FROM despesas WHERE id = $1 RETURNING id', [id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Despesa nao encontrada.' });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/sugestao-pagamento', async (req, res, next) => {
  try {
    const contexto = String(req.query.contexto || '').trim().toLowerCase();
    if (contexto === 'pagamento_modelo') {
      const osModeloId = Number(req.query.os_modelo_id);
      if (Number.isNaN(osModeloId)) {
        return res.status(400).json({ message: 'os_modelo_id invalido.' });
      }
      const r = await pool.query(
        `
        SELECT m.formas_pagamento, m.chave_pix
        FROM os_modelos om
        JOIN modelos m ON m.id = om.modelo_id
        WHERE om.id = $1
        `,
        [osModeloId],
      );
      if (r.rows.length === 0) return res.status(404).json({ message: 'Linha de modelo nao encontrada.' });
      const sug = suggestFromModeloRow(r.rows[0]);
      return res.json({
        sugerido: Boolean(sug),
        forma_pagamento: sug?.forma_pagamento || '',
        destino_pagamento: sug?.destino_pagamento || '',
      });
    }
    if (contexto === 'recebimento') {
      const osId = Number(req.query.os_id);
      if (Number.isNaN(osId)) return res.status(400).json({ message: 'os_id invalido.' });
      const r = await pool.query(
        `
        SELECT c.formas_pagamento
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        WHERE os.id = $1
        `,
        [osId],
      );
      if (r.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
      const sug = suggestFromClienteRow(r.rows[0]);
      return res.json({
        sugerido: Boolean(sug),
        forma_pagamento: sug?.forma_pagamento || '',
        destino_pagamento: sug?.destino_pagamento || '',
      });
    }
    return res.status(400).json({ message: 'contexto invalido. Use pagamento_modelo ou recebimento.' });
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/movimentos', async (req, res, next) => {
  try {
    const tipo = String(req.query.pessoa_tipo || '').trim().toLowerCase();
    const pid = Number(req.query.pessoa_id);
    if (!PESSOA_TIPOS.includes(tipo) || Number.isNaN(pid)) {
      return res.status(400).json({ message: 'pessoa_tipo e pessoa_id sao obrigatorios.' });
    }
    const r = await pool.query(
      `
      SELECT *
      FROM fin_movimentos
      WHERE pessoa_tipo = $1 AND pessoa_id = $2
      ORDER BY data_movimento DESC, id DESC
      LIMIT 200
      `,
      [tipo, pid],
    );
    res.json(r.rows);
  } catch (e) {
    next(e);
  }
});

router.post('/financeiro/movimentos', async (req, res, next) => {
  try {
    const {
      pessoa_tipo,
      pessoa_id,
      natureza,
      valor,
      data_movimento,
      forma_pagamento,
      destino_pagamento,
      observacao,
      categoria,
    } = req.body;
    const tipo = String(pessoa_tipo || '').trim().toLowerCase();
    const pid = Number(pessoa_id);
    const nat = String(natureza || '').trim().toLowerCase();
    if (!PESSOA_TIPOS.includes(tipo) || Number.isNaN(pid)) {
      return res.status(400).json({ message: 'pessoa_tipo e pessoa_id invalidos.' });
    }
    if (nat !== 'credito' && nat !== 'debito') {
      return res.status(400).json({ message: 'natureza deve ser credito ou debito.' });
    }
    const valorNum = n(valor);
    if (valorNum <= 0) return res.status(400).json({ message: 'Valor deve ser maior que zero.' });
    if (!data_movimento) return res.status(400).json({ message: 'data_movimento obrigatoria.' });
    const cat = String(categoria || 'avulso').trim().slice(0, 40) || 'avulso';

    let chk;
    if (tipo === 'modelo') chk = await pool.query(`SELECT id FROM modelos WHERE id = $1`, [pid]);
    else if (tipo === 'booker') chk = await pool.query(`SELECT id FROM bookers WHERE id = $1`, [pid]);
    else chk = await pool.query(`SELECT id FROM parceiros WHERE id = $1`, [pid]);
    if (chk.rows.length === 0) return res.status(404).json({ message: 'Pessoa nao encontrada.' });

    const ins = await pool.query(
      `
      INSERT INTO fin_movimentos (
        pessoa_tipo, pessoa_id, natureza, categoria, valor, data_movimento,
        forma_pagamento, destino_pagamento, observacao
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        tipo,
        pid,
        nat,
        cat,
        valorNum,
        String(data_movimento).slice(0, 10),
        String(forma_pagamento || '').trim().slice(0, 80),
        String(destino_pagamento || '').trim().slice(0, 500),
        String(observacao || '').trim().slice(0, 2000),
      ],
    );
    if (tipo === 'modelo') {
      await upsertFinMovModeloLine(pool, ins.rows[0].id);
    }
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financeiro/extrato-pessoa', async (req, res, next) => {
  try {
    const tipo = String(req.query.tipo || '').trim().toLowerCase();
    const pid = Number(req.query.id);
    if (!PESSOA_TIPOS.includes(tipo) || Number.isNaN(pid)) {
      return res.status(400).json({ message: 'tipo (modelo|booker|parceiro) e id sao obrigatorios.' });
    }

    const linhas = [];
    let totalEntradas = 0;
    let totalSaidas = 0;

    if (tipo === 'modelo') {
      const jobs = await pool.query(
        `
        SELECT
          om.id AS os_modelo_id,
          om.os_id,
          om.cache_modelo,
          om.emite_nf_propria,
          os.imposto_percent,
          os.agencia_fee_percent,
          os.created_at,
          COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
        FROM os_modelos om
        JOIN ordens_servico os ON os.id = om.os_id
        JOIN clientes c ON c.id = os.cliente_id
        WHERE om.modelo_id = $1
        ORDER BY om.os_id ASC, om.id ASC
        `,
        [pid],
      );
      for (const row of jobs.rows) {
        const liquido = n(
          lineLiquido(
            row.cache_modelo,
            row.imposto_percent,
            row.agencia_fee_percent,
            row.emite_nf_propria,
          ),
        );
        if (liquido <= 0.005) continue;
        totalEntradas += liquido;
        linhas.push({
          tipo: 'entrada',
          categoria: 'job',
          descricao: `Job O.S. #${row.os_id}${row.cliente ? ` — ${row.cliente}` : ''}`,
          valor: liquido,
          data: String(row.created_at || '').slice(0, 10),
          forma_pagamento: '',
          destino_pagamento: '',
          ref: `os_modelo:${row.os_modelo_id}`,
        });
      }

      const pays = await pool.query(
        `
        SELECT p.id, p.valor, p.data_pagamento, p.observacao, p.forma_pagamento, p.destino_pagamento, om.os_id
        FROM pagamentos_modelo p
        JOIN os_modelos om ON om.id = p.os_modelo_id
        WHERE om.modelo_id = $1
        ORDER BY p.data_pagamento ASC, p.id ASC
        `,
        [pid],
      );
      for (const p of pays.rows) {
        const v = n(p.valor);
        totalSaidas += v;
        linhas.push({
          tipo: 'saida',
          categoria: 'pagamento',
          descricao: `Pagamento O.S. #${p.os_id}${p.observacao ? ` — ${p.observacao}` : ''}`,
          valor: v,
          data: String(p.data_pagamento).slice(0, 10),
          forma_pagamento: p.forma_pagamento || '',
          destino_pagamento: p.destino_pagamento || '',
          ref: `pagamento_modelo:${p.id}`,
        });
      }
    } else if (tipo === 'booker') {
      const jobs = await pool.query(
        `
        SELECT id AS os_id, booker_valor, created_at,
          COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        WHERE os.booker_id = $1 AND COALESCE(os.booker_valor, 0) > 0.005
        ORDER BY os.id ASC
        `,
        [pid],
      );
      for (const row of jobs.rows) {
        const v = n(row.booker_valor);
        totalEntradas += v;
        linhas.push({
          tipo: 'entrada',
          categoria: 'job',
          descricao: `Comissão booker O.S. #${row.os_id}${row.cliente ? ` — ${row.cliente}` : ''}`,
          valor: v,
          data: String(row.created_at || '').slice(0, 10),
          forma_pagamento: '',
          destino_pagamento: '',
          ref: `os_booker:${row.os_id}`,
        });
      }
    } else {
      const jobs = await pool.query(
        `
        SELECT os.id AS os_id, os.parceiro_valor, os.created_at,
          COALESCE(NULLIF(TRIM(c.nome_fantasia), ''), NULLIF(TRIM(c.nome_empresa), ''), '') AS cliente
        FROM ordens_servico os
        JOIN clientes c ON c.id = os.cliente_id
        WHERE os.parceiro_id = $1 AND COALESCE(os.parceiro_valor, 0) > 0.005
        ORDER BY os.id ASC
        `,
        [pid],
      );
      for (const row of jobs.rows) {
        const v = n(row.parceiro_valor);
        totalEntradas += v;
        linhas.push({
          tipo: 'entrada',
          categoria: 'job',
          descricao: `Comissão fornecedor O.S. #${row.os_id}${row.cliente ? ` — ${row.cliente}` : ''}`,
          valor: v,
          data: String(row.created_at || '').slice(0, 10),
          forma_pagamento: '',
          destino_pagamento: '',
          ref: `os_parceiro:${row.os_id}`,
        });
      }
    }

    const mov = await pool.query(
      `
      SELECT *
      FROM fin_movimentos
      WHERE pessoa_tipo = $1 AND pessoa_id = $2
      ORDER BY data_movimento ASC, id ASC
      `,
      [tipo, pid],
    );
    for (const m of mov.rows) {
      const v = n(m.valor);
      if (m.natureza === 'credito') {
        totalEntradas += v;
        linhas.push({
          tipo: 'entrada',
          categoria: m.categoria || 'avulso',
          descricao: m.observacao || (m.categoria === 'adiantamento' ? 'Crédito / ajuste' : 'Movimento a crédito'),
          valor: v,
          data: String(m.data_movimento).slice(0, 10),
          forma_pagamento: m.forma_pagamento || '',
          destino_pagamento: m.destino_pagamento || '',
          ref: `fin_movimento:${m.id}`,
        });
      } else {
        totalSaidas += v;
        linhas.push({
          tipo: 'saida',
          categoria: m.categoria || 'avulso',
          descricao: m.observacao || 'Movimento a débito',
          valor: v,
          data: String(m.data_movimento).slice(0, 10),
          forma_pagamento: m.forma_pagamento || '',
          destino_pagamento: m.destino_pagamento || '',
          ref: `fin_movimento:${m.id}`,
        });
      }
    }

    linhas.sort((a, b) => {
      const da = String(a.data || '');
      const db = String(b.data || '');
      if (da !== db) return da.localeCompare(db);
      return String(a.ref || '').localeCompare(String(b.ref || ''));
    });

    const nomeFinal =
      tipo === 'modelo'
        ? (await pool.query(`SELECT nome FROM modelos WHERE id = $1`, [pid])).rows[0]?.nome
        : tipo === 'booker'
          ? (await pool.query(`SELECT nome FROM bookers WHERE id = $1`, [pid])).rows[0]?.nome
          : (await pool.query(`SELECT razao_social_ou_nome FROM parceiros WHERE id = $1`, [pid])).rows[0]
              ?.razao_social_ou_nome;

    res.json({
      pessoa_tipo: tipo,
      pessoa_id: pid,
      nome: nomeFinal || '',
      linhas,
      totais: {
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: totalEntradas - totalSaidas,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
