const express = require('express');
const { pool } = require('../config/db');
const { sanitizeAndValidateModelo } = require('../utils/brValidators');
const { insertModeloRow } = require('../utils/modeloInsert');
const { validateTokenReadOnly, validateAndLockLink } = require('../utils/cadastroLinkHelpers');
const { hashPassword } = require('../utils/auth');
const { persistModeloFotoPerfil } = require('../services/modeloFotoPerfil');

const router = express.Router();

const PUBLIC_MAX_OBS = 2000;
const MEDIDA_MAX_LEN = 120;
const FOTO_MAX_CHARS = 3_000_000;

const SUCCESS_MESSAGE = 'Cadastro recebido com sucesso. Obrigado pela atualização.';

function trimStr(v) {
  return String(v ?? '').trim();
}

function parseSexo(raw) {
  const t = trimStr(raw).toLowerCase();
  if (t === 'masculino') return { ok: true, label: 'Masculino', feminino: false };
  if (t === 'feminino') return { ok: true, label: 'Feminino', feminino: true };
  return { ok: false, message: 'Informe o sexo como Masculino ou Feminino.' };
}

const MEDIDA_LABEL = {
  medida_altura: 'Altura',
  medida_busto: 'Busto',
  medida_torax: 'Torax',
  medida_cintura: 'Cintura',
  medida_quadril: 'Quadril',
  medida_sapato: 'Sapato',
  medida_cabelo: 'Cabelo',
  medida_olhos: 'Olhos',
};

function validateMedidas(sexoParsed, raw) {
  const req = (key) => {
    const s = trimStr(raw[key]);
    const lab = MEDIDA_LABEL[key] || key;
    if (!s) return { ok: false, message: `${lab} e obrigatorio.` };
    if (s.length > MEDIDA_MAX_LEN) {
      return { ok: false, message: `${lab}: maximo ${MEDIDA_MAX_LEN} caracteres.` };
    }
    return { ok: true, value: s };
  };

  const altura = req('medida_altura');
  if (!altura.ok) return { ...altura, field: 'medida_altura' };
  const cintura = req('medida_cintura');
  if (!cintura.ok) return { ...cintura, field: 'medida_cintura' };
  const sapato = req('medida_sapato');
  if (!sapato.ok) return { ...sapato, field: 'medida_sapato' };
  const cabelo = req('medida_cabelo');
  if (!cabelo.ok) return { ...cabelo, field: 'medida_cabelo' };
  const olhos = req('medida_olhos');
  if (!olhos.ok) return { ...olhos, field: 'medida_olhos' };

  if (sexoParsed.feminino) {
    const busto = req('medida_busto');
    if (!busto.ok) return { ...busto, field: 'medida_busto' };
    const quadril = req('medida_quadril');
    if (!quadril.ok) return { ...quadril, field: 'medida_quadril' };
    return {
      ok: true,
      values: {
        medida_altura: altura.value,
        medida_busto: busto.value,
        medida_torax: '',
        medida_cintura: cintura.value,
        medida_quadril: quadril.value,
        medida_sapato: sapato.value,
        medida_cabelo: cabelo.value,
        medida_olhos: olhos.value,
      },
    };
  }

  const torax = req('medida_torax');
  if (!torax.ok) return { ...torax, field: 'medida_torax' };
  return {
    ok: true,
    values: {
      medida_altura: altura.value,
      medida_busto: '',
      medida_torax: torax.value,
      medida_cintura: cintura.value,
      medida_quadril: '',
      medida_sapato: sapato.value,
      medida_cabelo: cabelo.value,
      medida_olhos: olhos.value,
    },
  };
}

/**
 * GET /api/public/cadastro-modelo/validar?token=
 */
router.get('/public/cadastro-modelo/validar', async (req, res, next) => {
  try {
    const token = trimStr(req.query.token);
    const v = await validateTokenReadOnly(pool, token, 'modelo');
    if (!v.ok) {
      return res.status(400).json({ ok: false, message: v.message });
    }
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/public/cadastro-modelo
 * body.token obrigatorio (link de uso unico).
 */
router.post('/public/cadastro-modelo', async (req, res, next) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const token = trimStr(raw.token);
    if (!token) {
      return res.status(400).json({ message: 'Acesso apenas por link com token valido.' });
    }

    let obs = String(raw.observacoes ?? '').trim();
    if (obs.length > PUBLIC_MAX_OBS) obs = obs.slice(0, PUBLIC_MAX_OBS);
    const passaporte = trimStr(raw.passaporte);
    const rg = trimStr(raw.rg);
    const cep = trimStr(raw.cep);
    const logradouro = trimStr(raw.logradouro);
    const numero = trimStr(raw.numero);
    const complemento = trimStr(raw.complemento);
    const bairro = trimStr(raw.bairro);
    const cidade = trimStr(raw.cidade);
    const uf = trimStr(raw.uf);
    const fotoPerfilBase64 = trimStr(raw.foto_perfil_base64);
    const senhaAcesso = String(raw.senha_acesso || '').trim();
    if (!senhaAcesso || senhaAcesso.length < 8) {
      return res.status(400).json({ message: 'Defina uma senha de acesso com no minimo 8 caracteres.' });
    }
    if (!cep || !logradouro || !numero || !bairro || !cidade || !uf) {
      return res.status(400).json({
        message: 'Endereco incompleto. Preencha CEP, logradouro, numero, bairro, cidade e UF.',
      });
    }
    if (fotoPerfilBase64 && fotoPerfilBase64.length > FOTO_MAX_CHARS) {
      return res.status(400).json({ message: 'Foto de perfil muito grande.' });
    }

    const sexoParsed = parseSexo(raw.sexo);
    if (!sexoParsed.ok) {
      return res.status(400).json({ message: sexoParsed.message });
    }

    const med = validateMedidas(sexoParsed, raw);
    if (!med.ok) {
      return res.status(400).json({ message: med.message });
    }

    const body = {
      nome: raw.nome,
      ativo_site: false,
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
      sexo: sexoParsed.label,
      passaporte,
      rg,
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      uf,
      foto_perfil_base64: fotoPerfilBase64,
      formas_pagamento: raw.formas_pagamento,
      ...med.values,
    };

    const sv = sanitizeAndValidateModelo(body, false);
    if (!sv.ok) return res.status(400).json({ message: sv.message });
    Object.assign(body, sv.body);

    body.formas_pagamento = sv.body.formas_pagamento;
    body.chave_pix = '';
    body.banco_dados = '';
    body.ativo = false;
    body.origem_cadastro = 'cadastro_site';
    body.status_cadastro = 'pendente';
    body.sexo = sexoParsed.label;
    Object.assign(body, med.values);

    try {
      body.foto_perfil_base64 = await persistModeloFotoPerfil(body.foto_perfil_base64);
    } catch (e) {
      return res.status(400).json({ message: e.message || 'Foto de perfil invalida.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const linkV = await validateAndLockLink(client, token, 'modelo');
      if (!linkV.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: linkV.message });
      }

      let modeloRow;
      try {
        modeloRow = await insertModeloRow(client, body);
      } catch (insertErr) {
        await client.query('ROLLBACK');
        if (insertErr.code === '23505') {
          return res.status(400).json({
            message:
              'Este CPF ja esta cadastrado. Se voce ja enviou antes, aguarde a analise da equipe.',
          });
        }
        throw insertErr;
      }

      const senhaHash = await hashPassword(senhaAcesso);
      try {
        await client.query(
          `INSERT INTO modelo_acessos (modelo_id, email, senha_hash)
           VALUES ($1, $2, $3)`,
          [modeloRow.id, String(modeloRow.email || '').toLowerCase(), senhaHash],
        );
      } catch (acessoErr) {
        await client.query('ROLLBACK');
        if (acessoErr.code === '23505') {
          return res.status(400).json({
            message: 'Ja existe acesso de modelo com este email. Use outro email no cadastro.',
          });
        }
        throw acessoErr;
      }

      await client.query(
        `UPDATE cadastro_links SET status = 'usado', usado_em = NOW(), modelo_id = $1 WHERE id = $2`,
        [modeloRow.id, linkV.row.id],
      );
      await client.query('COMMIT');

      return res.status(201).json({
        message: SUCCESS_MESSAGE,
        id: modeloRow.id,
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
