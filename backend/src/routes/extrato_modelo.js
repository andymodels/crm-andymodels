const express = require('express');
const { pool } = require('../config/db');
const { lineLiquido } = require('../services/osFinanceiro');

const router = express.Router();

router.get('/extrato-modelo', async (req, res, next) => {
  try {
    const modeloId = req.query.modelo_id != null && req.query.modelo_id !== '' ? Number(req.query.modelo_id) : null;
    if (modeloId != null && Number.isNaN(modeloId)) {
      return res.status(400).json({ message: 'modelo_id invalido.' });
    }

    let sql = `
      SELECT
        om.id AS os_modelo_id,
        om.os_id,
        om.modelo_id,
        om.cache_modelo,
        om.emite_nf_propria,
        os.imposto_percent,
        os.agencia_fee_percent,
        c.nome_empresa,
        c.nome_fantasia,
        COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'A definir') AS modelo_nome,
        os.status AS os_status
      FROM os_modelos om
      JOIN ordens_servico os ON os.id = om.os_id
      JOIN clientes c ON c.id = os.cliente_id
      LEFT JOIN modelos m ON m.id = om.modelo_id
    `;
    const params = [];
    if (modeloId != null) {
      sql += ' WHERE om.modelo_id = $1';
      params.push(modeloId);
    }
    sql += ' ORDER BY om.os_id DESC, om.id';

    const { rows } = await pool.query(sql, params);
    const out = [];

    for (const row of rows) {
      const liquido = lineLiquido(
        row.cache_modelo,
        row.imposto_percent,
        row.agencia_fee_percent,
        row.emite_nf_propria,
      );
      const pay = await pool.query(
        'SELECT COALESCE(SUM(valor), 0) AS pago FROM pagamentos_modelo WHERE os_modelo_id = $1',
        [row.os_modelo_id],
      );
      const pago = Number(pay.rows[0].pago);
      const saldo = liquido - pago;
      const status = Math.abs(saldo) < 0.01 ? 'quitado' : 'pendente';

      out.push({
        os_modelo_id: row.os_modelo_id,
        job_id: row.os_id,
        cliente: row.nome_empresa || row.nome_fantasia || '',
        modelo_nome: row.modelo_nome,
        liquido,
        pago,
        saldo,
        status,
        os_status: row.os_status,
      });
    }

    res.json(out);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
