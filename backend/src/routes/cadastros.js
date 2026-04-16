const express = require('express');
const multer = require('multer');
const { pool } = require('../config/db');
const {
  sanitizeAndValidateCliente,
  sanitizeAndValidateModelo,
  sanitizeAndValidateBooker,
  sanitizeAndValidateParceiro,
} = require('../utils/brValidators');
const { stringifyJsonbColumns } = require('../utils/jsonbBody');
const { insertModeloRow } = require('../utils/modeloInsert');
const {
  persistModeloFotoPerfil,
  replaceModeloFotoPerfil,
  removeStoredModeloFotoIfAny,
} = require('../services/modeloFotoPerfil');

const router = express.Router();

/** Anexos de galeria ao modelo (CRM): vários pedidos pequenos evitam 413/timeout com dezenas de fotos. */
const modeloGaleriaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MODEL_GALLERY_MAX_FILE_BYTES) || 80 * 1024 * 1024,
    files: Number(process.env.MODEL_GALLERY_MAX_FILES_PER_REQUEST) || 40,
  },
});

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

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tryParseJsonString(value) {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (!s) return value;
  if (!(s.startsWith('{') || s.startsWith('['))) return value;
  try {
    return JSON.parse(s);
  } catch {
    return value;
  }
}

function labelForField(field) {
  const map = {
    id: 'ID',
    nome: 'Nome',
    nome_empresa: 'Nome da empresa',
    nome_fantasia: 'Nome fantasia',
    cpf: 'CPF',
    cnpj: 'CNPJ',
    cnpj_ou_cpf: 'CNPJ ou CPF',
    rg: 'RG',
    passaporte: 'Passaporte',
    data_nascimento: 'Data de nascimento',
    sexo: 'Sexo',
    telefones: 'Telefones',
    emails: 'Emails',
    telefone: 'Telefone',
    email: 'Email',
    logradouro: 'Logradouro',
    numero: 'Numero',
    complemento: 'Complemento',
    bairro: 'Bairro',
    cidade: 'Cidade',
    uf: 'UF',
    cep: 'CEP',
    observacoes: 'Observacoes',
    origem_cadastro: 'Origem do cadastro',
    status_cadastro: 'Status do cadastro',
    ativo: 'Ativo',
    created_at: 'Criado em',
    updated_at: 'Atualizado em',
    medida_altura: 'Altura',
    medida_busto: 'Busto',
    medida_torax: 'Torax',
    medida_cintura: 'Cintura',
    medida_quadril: 'Quadril',
    medida_sapato: 'Sapato',
    medida_cabelo: 'Cabelo',
    medida_olhos: 'Olhos',
    formas_pagamento: 'Formas de pagamento',
    emite_nf_propria: 'Emite NF propria',
  };
  return map[field] || field.replace(/_/g, ' ');
}

function fmtValue(v) {
  if (v == null || v === '') return '—';
  const parsed = tryParseJsonString(v);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return '—';
    const first = parsed[0];
    if (first && typeof first === 'object') {
      return parsed
        .map((item, i) => `${i + 1}) ${JSON.stringify(item)}`)
        .map(escHtml)
        .join('<br/>');
    }
    return escHtml(parsed.map((x) => String(x ?? '')).join(', '));
  }
  if (parsed && typeof parsed === 'object') {
    return `<pre>${escHtml(JSON.stringify(parsed, null, 2))}</pre>`;
  }
  if (typeof parsed === 'boolean') return parsed ? 'Sim' : 'Nao';
  return escHtml(String(parsed));
}

function cadastroPdfHtml({ title, row }) {
  const foto = row?.foto_perfil_base64 ? String(row.foto_perfil_base64) : '';
  const entries = Object.entries(row || {}).filter(([k]) => k !== 'foto_perfil_base64');
  const rows = entries
    .map(([k, v]) => `<tr><th>${escHtml(labelForField(k))}</th><td>${fmtValue(v)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escHtml(title)}</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:28px;color:#0f172a;background:#f8fafc}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px}
    .head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
    .title{margin:0;font-size:24px;line-height:1.2}
    .sub{margin:6px 0 0;color:#64748b;font-size:13px}
    .photo{width:108px;height:108px;border-radius:12px;object-fit:cover;border:1px solid #cbd5e1;background:#fff}
    table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border:1px solid #e2e8f0;border-radius:10px}
    th,td{padding:9px 10px;vertical-align:top;font-size:13px;border-bottom:1px solid #eef2f7}
    tr:last-child th,tr:last-child td{border-bottom:none}
    th{width:230px;text-align:left;background:#f8fafc;color:#334155;font-weight:600}
    td{background:#fff}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1e293b}
  </style>
</head>
<body>
  <section class="card">
    <div class="head">
      <div>
        <h1 class="title">${escHtml(title)}</h1>
        <p class="sub">Documento de cadastro</p>
      </div>
      ${foto ? `<img src="${escHtml(foto)}" alt="Foto de perfil" class="photo" />` : ''}
    </div>
    <table>${rows}</table>
  </section>
</body>
</html>`;
}

/**
 * Resposta JSON: se existir URL http(s), devolve-a (nunca preferir base64 sobre URL).
 * Suporta legado em base64 puro ou data URL; se o texto misturar lixo com URL, extrai a URL.
 */
function fotoPerfilBase64ForApiResponse(stored) {
  if (stored == null) return '';
  const s = String(stored).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0].replace(/[,;.)]+$/, '');
  return s;
}

function mapModeloRowFotoForApi(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    foto_perfil_base64: fotoPerfilBase64ForApiResponse(row.foto_perfil_base64),
  };
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
      if (table === 'modelos') {
        res.json(result.rows.map(mapModeloRowFotoForApi));
      } else {
        res.json(result.rows);
      }
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${path}`, async (req, res, next) => {
    try {
      const body = { ...(req.body != null && typeof req.body === 'object' ? req.body : {}) };
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

      if (table === 'modelos') {
        try {
          body.foto_perfil_base64 = await persistModeloFotoPerfil(body.foto_perfil_base64);
        } catch (e) {
          return res.status(400).json({ message: e.message || 'Foto de perfil invalida.' });
        }
      }

      const missing = missingRequiredFields(body, requiredFields);
      if (missing.length > 0) {
        return res.status(400).json({
          message: `Campos obrigatorios faltando ou vazios: ${missing.join(', ')}`,
        });
      }

      if (table === 'modelos') {
        const result = await insertModeloRow(pool, body);
        return res.status(201).json(mapModeloRowFotoForApi(result));
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

  router.get(`/${path}/:id/pdf`, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).send('ID invalido.');
      const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      if (result.rows.length === 0) return res.status(404).send('Registro nao encontrado.');
      const label = path === 'clientes' ? 'clientes' : path;
      const html = cadastroPdfHtml({ title: `Cadastro - ${label} #${id}`, row: result.rows[0] });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${path}/:id`, async (req, res, next) => {
    try {
      const body = { ...(req.body != null && typeof req.body === 'object' ? req.body : {}) };

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

      if (
        table === 'modelos' &&
        body.perfil_site &&
        typeof body.perfil_site === 'object' &&
        !Object.prototype.hasOwnProperty.call(body.perfil_site, 'apiMedia')
      ) {
        try {
          const prevQ = await pool.query('SELECT perfil_site FROM modelos WHERE id = $1', [id]);
          const prevRow = prevQ.rows[0];
          let prevP = prevRow?.perfil_site;
          if (typeof prevP === 'string') {
            try {
              prevP = JSON.parse(prevP);
            } catch {
              prevP = {};
            }
          }
          if (!prevP || typeof prevP !== 'object') prevP = {};
          const prevMedia = Array.isArray(prevP.apiMedia) ? prevP.apiMedia : [];
          body.perfil_site = { ...prevP, ...body.perfil_site, apiMedia: prevMedia };
        } catch {
          /* mantém body */
        }
      }

      if (table === 'modelos' && Object.prototype.hasOwnProperty.call(body, 'foto_perfil_base64')) {
        const prevQ = await pool.query('SELECT foto_perfil_base64 FROM modelos WHERE id = $1', [id]);
        if (prevQ.rows.length === 0) {
          return res.status(404).json({ message: 'Registro nao encontrado.' });
        }
        try {
          body.foto_perfil_base64 = await replaceModeloFotoPerfil(
            body.foto_perfil_base64,
            prevQ.rows[0].foto_perfil_base64 || '',
          );
        } catch (e) {
          return res.status(400).json({ message: e.message || 'Foto de perfil invalida.' });
        }
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

      if (table === 'modelos') {
        return res.json(mapModeloRowFotoForApi(result.rows[0]));
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

      if (table === 'modelos') {
        const prevQ = await pool.query('SELECT foto_perfil_base64 FROM modelos WHERE id = $1', [id]);
        if (prevQ.rows.length > 0) {
          await removeStoredModeloFotoIfAny(prevQ.rows[0].foto_perfil_base64);
        }
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

/** Antes de GET /modelos (lista): detalhe e ligação ao ID do modelo no site. */
router.get('/modelos/by-website/:wid', async (req, res, next) => {
  try {
    const wid = Number(req.params.wid);
    if (Number.isNaN(wid) || wid <= 0) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const result = await pool.query(
      'SELECT * FROM modelos WHERE website_model_id = $1 ORDER BY id DESC LIMIT 1',
      [wid],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    return res.json(mapModeloRowFotoForApi(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.get('/modelos/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id) || id <= 0) {
      return res.status(400).json({ message: 'ID invalido.' });
    }
    const result = await pool.query('SELECT * FROM modelos WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Nao encontrado.' });
    }
    return res.json(mapModeloRowFotoForApi(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/modelos/:id/galeria-append — acrescenta imagens à galeria em `perfil_site.apiMedia` (multipart, campo `photos`).
 * Vários pedidos em sequência evitam um único JSON gigante no PUT /modelos/:id.
 */
router.post(
  '/modelos/:id/galeria-append',
  modeloGaleriaUpload.array('photos', Number(process.env.MODEL_GALLERY_MAX_FILES_PER_REQUEST) || 40),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id) || id <= 0) {
        return res.status(400).json({ message: 'ID invalido.' });
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ message: 'Envie imagens no campo photos.' });
      }
      const r = await pool.query('SELECT * FROM modelos WHERE id = $1', [id]);
      if (r.rows.length === 0) {
        return res.status(404).json({ message: 'Nao encontrado.' });
      }
      const row = r.rows[0];
      let perfil = row.perfil_site;
      if (typeof perfil === 'string') {
        try {
          perfil = perfil ? JSON.parse(perfil) : {};
        } catch {
          perfil = {};
        }
      }
      if (!perfil || typeof perfil !== 'object') perfil = {};
      const apiMedia = Array.isArray(perfil.apiMedia) ? [...perfil.apiMedia] : [];
      let polaroids = [];
      const rawPol = req.body && req.body.polaroids;
      if (typeof rawPol === 'string' && rawPol.trim()) {
        try {
          const parsed = JSON.parse(rawPol);
          polaroids = Array.isArray(parsed) ? parsed.map((x) => Boolean(x)) : [];
        } catch {
          polaroids = [];
        }
      }
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        if (!f || !f.buffer) continue;
        const mime = String(f.mimetype || 'image/jpeg').split(';')[0] || 'image/jpeg';
        if (!mime.startsWith('image/')) {
          return res.status(400).json({ message: 'Apenas imagens sao aceites em galeria-append.' });
        }
        const b64 = f.buffer.toString('base64');
        const dataUrl = `data:${mime};base64,${b64}`;
        const polaroid = polaroids.length > i ? polaroids[i] : false;
        apiMedia.push({ type: 'image', url: dataUrl, thumb: dataUrl, polaroid });
      }
      const nextPerfil = { ...perfil, apiMedia };
      const result2 = await pool.query(
        `UPDATE modelos SET perfil_site = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [nextPerfil, id],
      );
      return res.json(mapModeloRowFotoForApi(result2.rows[0]));
    } catch (error) {
      next(error);
    }
  },
);

makeCrudRoutes({
  path: 'clientes',
  table: 'clientes',
  requiredFields: [
    'tipo_pessoa',
    'documento',
    'nome_empresa',
    'nome_fantasia',
    'contato_principal',
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
    'instagram',
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
    'contato_principal',
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
    'instagram',
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
    'instagram',
    'tiktok',
    'sexo',
    'passaporte',
    'rg',
    'cep',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'cidade',
    'uf',
    'foto_perfil_base64',
    'medida_altura',
    'medida_busto',
    'medida_torax',
    'medida_cintura',
    'medida_quadril',
    'medida_sapato',
    'medida_cabelo',
    'medida_olhos',
    'ativo_site',
    'website_model_id',
    'perfil_site',
  ],
});

makeCrudRoutes({
  path: 'bookers',
  table: 'bookers',
  requiredFields: [
    'nome',
    'cpf',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'cidade',
    'uf',
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
    'cep',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'cidade',
    'uf',
    'telefones',
    'emails',
    'formas_pagamento',
    'observacoes',
    'ativo',
  ],
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
