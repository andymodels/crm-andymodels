const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { pool } = require('../config/db');

const router = express.Router();

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

function ensureUploadRoot() {
  if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    ensureUploadRoot();
    const osId = req.params.id;
    const dir = path.join(UPLOAD_ROOT, 'os', String(osId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const safe = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

const TIPOS = ['contrato_pdf_gerado', 'contrato_assinado_scan', 'anexo_extra'];

router.post('/ordens-servico/:id/documentos', upload.single('arquivo'), async (req, res, next) => {
  try {
    const osId = Number(req.params.id);
    if (Number.isNaN(osId)) return res.status(400).json({ message: 'ID invalido.' });
    const tipo = req.body.tipo;
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ message: `tipo deve ser: ${TIPOS.join(', ')}` });
    }
    if (!req.file) return res.status(400).json({ message: 'Arquivo obrigatorio (campo arquivo).' });

    const osCheck = await pool.query('SELECT id, status FROM ordens_servico WHERE id = $1', [osId]);
    if (osCheck.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const st = String(osCheck.rows[0].status || '');
    if (st === 'cancelada') {
      return res.status(400).json({ message: 'O.S. cancelada nao aceita novos documentos.' });
    }

    const relPath = `os/${osId}/${path.basename(req.file.path)}`;
    const buf = fs.readFileSync(req.file.path);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    const ins = await pool.query(
      `
      INSERT INTO os_documentos (os_id, tipo, nome_arquivo, mime, storage_path, sha256)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, os_id, tipo, nome_arquivo, mime, storage_path, sha256, created_at
      `,
      [osId, tipo, req.file.originalname || path.basename(req.file.filename), req.file.mimetype, relPath, sha256],
    );

    if (tipo === 'contrato_assinado_scan') {
      await pool.query(
        `
        UPDATE ordens_servico
        SET contrato_assinado_em = COALESCE(contrato_assinado_em, NOW()),
            contrato_status = 'recebido',
            updated_at = NOW()
        WHERE id = $1
        `,
        [osId],
      );
    }

    res.status(201).json(ins.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/ordens-servico/:id/documentos/:docId/download', async (req, res, next) => {
  try {
    const osId = Number(req.params.id);
    const docId = Number(req.params.docId);
    if (Number.isNaN(osId) || Number.isNaN(docId)) {
      return res.status(400).json({ message: 'IDs invalidos.' });
    }
    const r = await pool.query(
      'SELECT nome_arquivo, mime, storage_path FROM os_documentos WHERE id = $1 AND os_id = $2',
      [docId, osId],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Documento nao encontrado.' });
    const row = r.rows[0];
    const abs = path.join(UPLOAD_ROOT, ...row.storage_path.split('/'));
    if (!fs.existsSync(abs)) return res.status(404).json({ message: 'Arquivo nao encontrado no disco.' });
    res.setHeader('Content-Type', row.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.nome_arquivo)}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    next(e);
  }
});

router.delete('/ordens-servico/:id/documentos/:docId', async (req, res, next) => {
  try {
    const osId = Number(req.params.id);
    const docId = Number(req.params.docId);
    if (Number.isNaN(osId) || Number.isNaN(docId)) {
      return res.status(400).json({ message: 'IDs invalidos.' });
    }
    const osCheck = await pool.query('SELECT id FROM ordens_servico WHERE id = $1', [osId]);
    if (osCheck.rows.length === 0) return res.status(404).json({ message: 'O.S. nao encontrada.' });
    const r = await pool.query(
      'DELETE FROM os_documentos WHERE id = $1 AND os_id = $2 RETURNING storage_path, tipo',
      [docId, osId],
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Documento nao encontrado.' });
    const abs = path.join(UPLOAD_ROOT, ...r.rows[0].storage_path.split('/'));
    try {
      fs.unlinkSync(abs);
    } catch {
      // arquivo ja removido
    }
    if (r.rows[0].tipo === 'contrato_assinado_scan') {
      const still = await pool.query(
        `SELECT 1 FROM os_documentos WHERE os_id = $1 AND tipo = 'contrato_assinado_scan' LIMIT 1`,
        [osId],
      );
      if (still.rows.length === 0) {
        await pool.query(
          `
          UPDATE ordens_servico
          SET contrato_assinado_em = NULL,
              contrato_status = CASE WHEN emitir_contrato THEN 'aguardando_assinatura' ELSE NULL END,
              updated_at = NOW()
          WHERE id = $1
          `,
          [osId],
        );
      }
    }
    res.json({ message: 'Documento removido.' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
