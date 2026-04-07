const express = require('express');
const { pool } = require('../config/db');
const { sanitizeAndValidateCliente } = require('../utils/brValidators');
const { validateTokenReadOnly, validateAndLockLink } = require('../utils/cadastroLinkHelpers');

const router = express.Router();

const SUCCESS_MESSAGE = 'Cadastro de cliente recebido com sucesso. Obrigado.';

function trimStr(v) {
  return String(v ?? '').trim();
}

router.get('/public/cadastro-cliente/validar', async (req, res, next) => {
  try {
    const token = trimStr(req.query.token);
    const v = await validateTokenReadOnly(pool, token, 'cliente');
    if (!v.ok) return res.status(400).json({ ok: false, message: v.message });
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/public/cadastro-cliente', async (req, res, next) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const token = trimStr(raw.token);
    if (!token) return res.status(400).json({ message: 'Acesso apenas por link com token valido.' });

    const body = {
      tipo_pessoa: raw.tipo_pessoa,
      documento: raw.documento,
      nome_empresa: raw.nome_empresa,
      nome_fantasia: raw.nome_fantasia,
      inscricao_estadual: raw.inscricao_estadual,
      contato_principal: raw.contato_principal,
      documento_representante: raw.documento_representante,
      telefones: raw.telefones,
      emails: raw.emails,
      cep: raw.cep,
      logradouro: raw.logradouro,
      numero: raw.numero,
      bairro: raw.bairro,
      cidade: raw.cidade,
      uf: raw.uf,
      website: raw.website,
      instagram: raw.instagram,
      observacoes: raw.observacoes,
    };

    const sv = sanitizeAndValidateCliente(body, false);
    if (!sv.ok) return res.status(400).json({ message: sv.message });
    Object.assign(body, sv.body);
    body.instagram = trimStr(raw.instagram);
    body.observacoes = trimStr(body.observacoes);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const linkV = await validateAndLockLink(client, token, 'cliente');
      if (!linkV.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: linkV.message });
      }

      const cols = [
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
        'instagram',
        'observacoes',
      ];
      const vals = cols.map((c) => body[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const ins = await client.query(
        `
        INSERT INTO clientes (${cols.join(', ')})
        VALUES (${placeholders})
        RETURNING *
        `,
        vals,
      );
      const clienteRow = ins.rows[0];

      await client.query(
        `UPDATE cadastro_links SET status = 'usado', usado_em = NOW(), cliente_id = $1 WHERE id = $2`,
        [clienteRow.id, linkV.row.id],
      );
      await client.query(
        `
        INSERT INTO cadastro_publico_historico (entidade, entidade_id, acao, detalhes)
        VALUES ('cliente', $1, 'criado_via_link_publico', $2::jsonb)
        `,
        [clienteRow.id, JSON.stringify({ via: 'cadastro-cliente', token_link_id: linkV.row.id })],
      );

      await client.query('COMMIT');
      return res.status(201).json({ message: SUCCESS_MESSAGE, id: clienteRow.id });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      if (err.code === '23505') {
        return res.status(400).json({ message: 'Este CNPJ/CPF já está cadastrado.' });
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
