const express = require('express');
const { pool } = require('../config/db');
const { sanitizeAndValidateModelo, onlyDigits } = require('../utils/brValidators');
const { insertModeloRow } = require('../utils/modeloInsert');

const router = express.Router();

const PUBLIC_MAX_OBS = 2000;

/**
 * Cadastro público de modelo (sem login). Criação apenas; mesma validação do CRUD interno.
 * POST /api/public/cadastro-modelo
 */
router.post('/public/cadastro-modelo', async (req, res, next) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    let obs = String(raw.observacoes ?? '').trim();
    if (obs.length > PUBLIC_MAX_OBS) obs = obs.slice(0, PUBLIC_MAX_OBS);

    const body = {
      nome: raw.nome,
      cpf: raw.cpf,
      data_nascimento: raw.data_nascimento,
      telefones: raw.telefones,
      emails: raw.emails,
      emite_nf_propria: raw.emite_nf_propria,
      responsavel_nome: raw.responsavel_nome,
      responsavel_cpf: raw.responsavel_cpf,
      responsavel_telefone: raw.responsavel_telefone,
      observacoes: obs,
      chave_pix: '',
      banco_dados: '',
      ativo: false,
    };

    const cpfDigits = onlyDigits(String(body.cpf ?? ''));
    body.formas_pagamento = [{ tipo: 'PIX', tipo_chave_pix: 'CPF', chave_pix: cpfDigits }];

    const sv = sanitizeAndValidateModelo(body, false);
    if (!sv.ok) return res.status(400).json({ message: sv.message });
    Object.assign(body, sv.body);

    body.formas_pagamento = [{ tipo: 'PIX', tipo_chave_pix: 'CPF', chave_pix: body.cpf }];
    body.chave_pix = '';
    body.banco_dados = '';
    body.ativo = false;
    body.origem_cadastro = 'cadastro_site';
    body.status_cadastro = 'pendente';

    const row = await insertModeloRow(pool, body);
    return res.status(201).json({
      message: 'Cadastro enviado com sucesso',
      id: row.id,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({
        message:
          'Este CPF ja esta cadastrado. Se voce ja enviou antes, aguarde a analise da equipe.',
      });
    }
    next(error);
  }
});

module.exports = router;
