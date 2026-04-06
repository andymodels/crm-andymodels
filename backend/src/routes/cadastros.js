const express = require('express');
const { pool } = require('../config/db');
const {
  sanitizeAndValidateCliente,
  sanitizeAndValidateModelo,
  sanitizeAndValidateBooker,
  sanitizeAndValidateParceiro,
} = require('../utils/brValidators');
const { stringifyJsonbColumns } = require('../utils/jsonbBody');
const { insertModeloRow } = require('../utils/modeloInsert');

const router = express.Router();

/** Campos obrigatorios: strings vazias e arrays vazios contam como faltando (backend nao confia no frontend). */
function missingRequiredFields(body, requiredFields) {
  return requiredFields.filter((field) => {
    const v = body[field];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}

const makeCrudRoutes = ({
  path,
  table,
  requiredFields,
  updateFields,
  validatePayload,
}) => {
  router.get(`/${path}`, async (_req, res, next) => {
    try {
      const result = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
      res.json(result.rows);
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${path}`, async (req, res, next) => {
    try {
      const body = { ...req.body };
      if (table === 'modelos') {
        if (body.chave_pix == null) body.chave_pix = '';
        if (body.banco_dados == null) body.banco_dados = '';
      }
      if (table === 'bookers' || table === 'parceiros') {
        if (body.chave_pix == null) body.chave_pix = '';
      }

      if (table === 'clientes') {
        const sv = sanitizeAndValidateCliente(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'modelos') {
        const sv = sanitizeAndValidateModelo(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'bookers') {
        const sv = sanitizeAndValidateBooker(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'parceiros') {
        const sv = sanitizeAndValidateParceiro(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (validatePayload) {
        const validation = validatePayload(body);
        if (!validation.valid) return res.status(400).json({ message: validation.message });
      }

      const missing = missingRequiredFields(body, requiredFields);
      if (missing.length > 0) {
        return res.status(400).json({
          message: `Campos obrigatorios faltando ou vazios: ${missing.join(', ')}`,
        });
      }

      if (table === 'modelos') {
        const result = await insertModeloRow(pool, body);
        return res.status(201).json(result);
      }

      stringifyJsonbColumns(body);

      const columns = Object.keys(body);
      const values = Object.values(body);
      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

      const query = `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;
      const result = await pool.query(query, values);
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({
          message:
            'Este CPF ou CNPJ ja esta cadastrado. Nao e permitido duplicar documento na base.',
        });
      }
      next(error);
    }
  });

  router.put(`/${path}/:id`, async (req, res, next) => {
    try {
      const body = { ...req.body };

      if (table === 'clientes') {
        const sv = sanitizeAndValidateCliente(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'modelos') {
        const sv = sanitizeAndValidateModelo(body, false);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'bookers') {
        const sv = sanitizeAndValidateBooker(body, true);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (table === 'parceiros') {
        const sv = sanitizeAndValidateParceiro(body, true);
        if (!sv.ok) return res.status(400).json({ message: sv.message });
        Object.assign(body, sv.body);
      } else if (validatePayload) {
        const validation = validatePayload(body, true);
        if (!validation.valid) return res.status(400).json({ message: validation.message });
      }

      if (table === 'clientes' || table === 'modelos') {
        const missing = missingRequiredFields(body, requiredFields);
        if (missing.length > 0) {
          return res.status(400).json({
            message: `Campos obrigatorios faltando ou vazios: ${missing.join(', ')}`,
          });
        }
      }

      stringifyJsonbColumns(body);

      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'ID invalido.' });
      }

      const setFields = updateFields
        .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        .map((field, idx) => `${field} = $${idx + 1}`);

      if (setFields.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
      }

      const values = updateFields
        .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
        .map((field) => body[field]);

      values.push(id);

      const query = `
        UPDATE ${table}
        SET ${setFields.join(', ')}, updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING *
      `;
      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Registro nao encontrado.' });
      }

      return res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(400).json({
          message:
            'Este CPF ou CNPJ ja esta cadastrado. Nao e permitido duplicar documento na base.',
        });
      }
      next(error);
    }
  });

  router.delete(`/${path}/:id`, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'ID invalido.' });
      }

      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Registro nao encontrado.' });
      }

      return res.status(204).send();
    } catch (error) {
      if (error.code === '23503') {
        return res.status(409).json({
          message:
            'Nao e possivel excluir: existem registros ligados (orcamentos, ordens de servico ou outros). Apague ou altere esses dados antes.',
        });
      }
      next(error);
    }
  });
};

makeCrudRoutes({
  path: 'clientes',
  table: 'clientes',
  requiredFields: [
    'tipo_pessoa',
    'documento',
    'nome_empresa',
    'nome_fantasia',
    'inscricao_estadual',
    'contato_principal',
    'documento_representante',
    'telefones',
    'emails',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
  ],
  updateFields: [
    'tipo_pessoa',
    'documento',
    'nome_empresa',
    'nome_fantasia',
    'cnpj',
    'inscricao_estadual',
    'contato_principal',
    'documento_representante',
    'telefone',
    'email',
    'telefones',
    'emails',
    'endereco_completo',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'website',
    'observacoes',
  ],
});

makeCrudRoutes({
  path: 'clients',
  table: 'clientes',
  requiredFields: [
    'tipo_pessoa',
    'documento',
    'nome_empresa',
    'nome_fantasia',
    'inscricao_estadual',
    'contato_principal',
    'documento_representante',
    'telefones',
    'emails',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
  ],
  updateFields: [
    'tipo_pessoa',
    'documento',
    'nome_empresa',
    'nome_fantasia',
    'cnpj',
    'inscricao_estadual',
    'contato_principal',
    'documento_representante',
    'telefone',
    'email',
    'telefones',
    'emails',
    'endereco_completo',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
    'website',
    'observacoes',
  ],
});

makeCrudRoutes({
  path: 'modelos',
  table: 'modelos',
  requiredFields: [
    'nome',
    'cpf',
    'telefone',
    'email',
    'emite_nf_propria',
    'data_nascimento',
    'telefones',
    'emails',
    'formas_pagamento',
    'ativo',
  ],
  updateFields: [
    'nome',
    'cpf',
    'telefone',
    'email',
    'emite_nf_propria',
    'data_nascimento',
    'telefones',
    'emails',
    'responsavel_nome',
    'responsavel_cpf',
    'responsavel_telefone',
    'formas_pagamento',
    'observacoes',
    'ativo',
    'origem_cadastro',
    'status_cadastro',
    'sexo',
    'passaporte',
    'foto_perfil_base64',
    'medida_altura',
    'medida_busto',
    'medida_torax',
    'medida_cintura',
    'medida_quadril',
    'medida_sapato',
    'medida_cabelo',
    'medida_olhos',
  ],
});

makeCrudRoutes({
  path: 'bookers',
  table: 'bookers',
  requiredFields: ['nome', 'cpf', 'telefones', 'emails', 'formas_pagamento', 'ativo'],
  updateFields: ['nome', 'cpf', 'telefone', 'email', 'telefones', 'emails', 'formas_pagamento', 'observacoes', 'ativo'],
});

makeCrudRoutes({
  path: 'parceiros',
  table: 'parceiros',
  requiredFields: [
    'razao_social_ou_nome',
    'cnpj_ou_cpf',
    'tipo_servico',
    'contato',
    'telefones',
    'emails',
    'formas_pagamento',
    'ativo',
  ],
  updateFields: [
    'razao_social_ou_nome',
    'cnpj_ou_cpf',
    'tipo_servico',
    'contato',
    'telefone',
    'email',
    'telefones',
    'emails',
    'formas_pagamento',
    'observacoes',
    'ativo',
  ],
});

module.exports = router;
