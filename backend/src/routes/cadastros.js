const express = require('express');
const { pool } = require('../config/db');

const router = express.Router();

const getAge = (birthDate) => {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
};

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
      if (validatePayload) {
        const validation = validatePayload(req.body);
        if (!validation.valid) return res.status(400).json({ message: validation.message });
      }

      const missing = requiredFields.filter((field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
      if (missing.length > 0) {
        return res.status(400).json({
          message: `Campos obrigatorios faltando: ${missing.join(', ')}`,
        });
      }

      const columns = Object.keys(req.body);
      const values = Object.values(req.body);
      const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

      const query = `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;
      const result = await pool.query(query, values);
      return res.status(201).json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${path}/:id`, async (req, res, next) => {
    try {
      if (validatePayload) {
        const validation = validatePayload(req.body, true);
        if (!validation.valid) return res.status(400).json({ message: validation.message });
      }

      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ message: 'ID invalido.' });
      }

      const setFields = updateFields
        .filter((field) => Object.prototype.hasOwnProperty.call(req.body, field))
        .map((field, idx) => `${field} = $${idx + 1}`);

      if (setFields.length === 0) {
        return res.status(400).json({ message: 'Nenhum campo para atualizar.' });
      }

      const values = updateFields
        .filter((field) => Object.prototype.hasOwnProperty.call(req.body, field))
        .map((field) => req.body[field]);

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
    'observacoes',
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
    'observacoes',
  ],
  validatePayload: (payload, partial = false) => {
    const telefones = Array.isArray(payload.telefones) ? payload.telefones.filter(Boolean) : [];
    const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
    if ((!partial || payload.telefones !== undefined) && telefones.length === 0) {
      return { valid: false, message: 'Informe ao menos um telefone.' };
    }
    if ((!partial || payload.emails !== undefined) && emails.length === 0) {
      return { valid: false, message: 'Informe ao menos um email.' };
    }
    if ((!partial || payload.tipo_pessoa !== undefined) && !['PF', 'PJ'].includes(payload.tipo_pessoa)) {
      return { valid: false, message: 'Tipo de pessoa deve ser PF ou PJ.' };
    }
    if ((!partial || payload.documento !== undefined) && !String(payload.documento || '').trim()) {
      return { valid: false, message: 'Documento e obrigatorio (CPF ou CNPJ conforme tipo; usado no contrato).' };
    }
    if ((!partial || payload.contato_principal !== undefined) && !String(payload.contato_principal || '').trim()) {
      return { valid: false, message: 'Nome do representante (contato principal) e obrigatorio.' };
    }
    if ((!partial || payload.documento_representante !== undefined) && !String(payload.documento_representante || '').trim()) {
      return { valid: false, message: 'CPF do representante legal e obrigatorio (campo proprio; contrato).' };
    }
    return { valid: true };
  },
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
    'observacoes',
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
    'observacoes',
  ],
  validatePayload: (payload, partial = false) => {
    const telefones = Array.isArray(payload.telefones) ? payload.telefones.filter(Boolean) : [];
    const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
    if ((!partial || payload.telefones !== undefined) && telefones.length === 0) {
      return { valid: false, message: 'Informe ao menos um telefone.' };
    }
    if ((!partial || payload.emails !== undefined) && emails.length === 0) {
      return { valid: false, message: 'Informe ao menos um email.' };
    }
    if ((!partial || payload.tipo_pessoa !== undefined) && !['PF', 'PJ'].includes(payload.tipo_pessoa)) {
      return { valid: false, message: 'Tipo de pessoa deve ser PF ou PJ.' };
    }
    if ((!partial || payload.documento !== undefined) && !String(payload.documento || '').trim()) {
      return { valid: false, message: 'Documento e obrigatorio (CPF ou CNPJ conforme tipo; usado no contrato).' };
    }
    if ((!partial || payload.contato_principal !== undefined) && !String(payload.contato_principal || '').trim()) {
      return { valid: false, message: 'Nome do representante (contato principal) e obrigatorio.' };
    }
    if ((!partial || payload.documento_representante !== undefined) && !String(payload.documento_representante || '').trim()) {
      return { valid: false, message: 'CPF do representante legal e obrigatorio (campo proprio; contrato).' };
    }
    return { valid: true };
  },
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
    'observacoes',
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
  ],
  validatePayload: (payload, partial = false) => {
    const telefones = Array.isArray(payload.telefones) ? payload.telefones.filter(Boolean) : [];
    const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
    const formas = Array.isArray(payload.formas_pagamento) ? payload.formas_pagamento : [];

    if (!partial || payload.telefones !== undefined) {
      if (telefones.length === 0) {
        return { valid: false, message: 'Informe ao menos um telefone.' };
      }
    }

    if (!partial || payload.emails !== undefined) {
      if (emails.length === 0) {
        return { valid: false, message: 'Informe ao menos um email.' };
      }
    }

    if (!partial || payload.formas_pagamento !== undefined) {
      if (formas.length === 0) {
        return { valid: false, message: 'Informe ao menos uma forma de recebimento.' };
      }
      const pixWithoutType = formas.some((item) => item?.tipo === 'PIX' && !item?.tipo_chave_pix);
      if (pixWithoutType) {
        return { valid: false, message: 'Selecione o tipo de chave para todas as formas PIX.' };
      }
    }

    const age = getAge(payload.data_nascimento);
    if (age !== null && age < 18) {
      if (!payload.responsavel_nome || !payload.responsavel_cpf || !payload.responsavel_telefone) {
        return { valid: false, message: 'Modelo menor de idade exige dados completos do responsável.' };
      }
    }

    if ((!partial || payload.cpf !== undefined) && !String(payload.cpf || '').trim()) {
      return { valid: false, message: 'CPF do modelo e obrigatorio (contrato).' };
    }

    return { valid: true };
  },
});

makeCrudRoutes({
  path: 'bookers',
  table: 'bookers',
  requiredFields: ['nome', 'cpf', 'telefones', 'emails', 'formas_pagamento', 'observacoes', 'ativo'],
  updateFields: ['nome', 'cpf', 'telefone', 'email', 'telefones', 'emails', 'formas_pagamento', 'observacoes', 'ativo'],
  validatePayload: (payload, partial = false) => {
    const telefones = Array.isArray(payload.telefones) ? payload.telefones.filter(Boolean) : [];
    const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
    if ((!partial || payload.telefones !== undefined) && telefones.length === 0) {
      return { valid: false, message: 'Informe ao menos um telefone.' };
    }
    if ((!partial || payload.emails !== undefined) && emails.length === 0) {
      return { valid: false, message: 'Informe ao menos um email.' };
    }
    return { valid: true };
  },
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
    'observacoes',
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
  validatePayload: (payload, partial = false) => {
    const telefones = Array.isArray(payload.telefones) ? payload.telefones.filter(Boolean) : [];
    const emails = Array.isArray(payload.emails) ? payload.emails.filter(Boolean) : [];
    if ((!partial || payload.telefones !== undefined) && telefones.length === 0) {
      return { valid: false, message: 'Informe ao menos um telefone.' };
    }
    if ((!partial || payload.emails !== undefined) && emails.length === 0) {
      return { valid: false, message: 'Informe ao menos um email.' };
    }
    return { valid: true };
  },
});

module.exports = router;
