const express = require('express');
const { pool } = require('../config/db');
const { sanitizeAndValidateModelo } = require('../utils/brValidators');
const { insertModeloRow } = require('../utils/modeloInsert');
const { validateTokenReadOnly, validateAndLockLink } = require('../utils/cadastroLinkHelpers');
const { hashPassword } = require('../utils/auth');
const { persistModeloFotoPerfil } = require('../services/modeloFotoPerfil');
const { syncWebsiteModelIdIntoRow } = require('../services/websiteModelSync');
const { missingRequiredFields, MODEL_POST_REQUIRED_FIELDS } = require('../utils/modeloPostRequired');

const router = express.Router();

const PUBLIC_MAX_OBS = 2000;
const FOTO_MAX_CHARS = 3_000_000;

const SUCCESS_MESSAGE = 'Cadastro recebido com sucesso. Obrigado pela atualização.';

function trimStr(v) {
  return String(v ?? '').trim();
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
 * Mesmo motor que POST /api/modelos (sanitize, foto, insertModeloRow), com token + regras de origem;
 * depois modelo_acessos e cadastro_links. body.token e body.senha_acesso nunca vao para INSERT.
 */
router.post('/public/cadastro-modelo', async (req, res, next) => {
  try {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    const token = trimStr(raw.token);
    if (!token) {
      return res.status(400).json({ message: 'Acesso apenas por link com token valido.' });
    }

    const senhaAcesso = String(raw.senha_acesso || '').trim();
    if (!senhaAcesso || senhaAcesso.length < 8) {
      return res.status(400).json({ message: 'Defina uma senha de acesso com no minimo 8 caracteres.' });
    }

    const body = { ...raw };
    delete body.token;
    delete body.senha_acesso;

    if (body.chave_pix == null) body.chave_pix = '';
    if (body.banco_dados == null) body.banco_dados = '';

    if (body.observacoes != null) {
      let obs = String(body.observacoes).trim();
      if (obs.length > PUBLIC_MAX_OBS) obs = obs.slice(0, PUBLIC_MAX_OBS);
      body.observacoes = obs;
    }

    const fp = body.foto_perfil_base64;
    if (fp != null && String(fp).length > FOTO_MAX_CHARS) {
      return res.status(400).json({ message: 'Foto de perfil muito grande.' });
    }

    const sv = sanitizeAndValidateModelo(body, false);
    if (!sv.ok) return res.status(400).json({ message: sv.message });
    Object.assign(body, sv.body);

    try {
      body.foto_perfil_base64 = await persistModeloFotoPerfil(body.foto_perfil_base64);
    } catch (e) {
      return res.status(400).json({ message: e.message || 'Foto de perfil invalida.' });
    }

    const missing = missingRequiredFields(body, MODEL_POST_REQUIRED_FIELDS);
    if (missing.length > 0) {
      return res.status(400).json({
        message: `Campos obrigatorios faltando ou vazios: ${missing.join(', ')}`,
      });
    }

    body.origem_cadastro = 'cadastro_link';
    body.status_cadastro = 'pendente';
    body.ativo = false;
    body.ativo_site = false;

    if (body.perfil_site && typeof body.perfil_site === 'object') {
      delete body.perfil_site.apiMedia;
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

      let outRow = modeloRow;
      let websiteSyncWarning = null;
      try {
        const sync = await syncWebsiteModelIdIntoRow(pool, modeloRow);
        outRow = sync.row;
        if (sync.error) websiteSyncWarning = sync.error;
      } catch (e) {
        console.warn('[public/cadastro-modelo] sync website_model_id:', e.message);
        websiteSyncWarning = e.message || 'Falha ao sincronizar com o site.';
      }

      const payload = {
        message: SUCCESS_MESSAGE,
        id: outRow.id,
      };
      if (websiteSyncWarning) payload.website_sync_warning = websiteSyncWarning;
      return res.status(201).json(payload);
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
