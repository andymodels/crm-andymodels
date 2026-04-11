/**
 * POST /api/applications — formulário público de inscrição (multipart).
 * Ficheiros: apenas B2/local via storage.saveFile (sem gravar paths em /uploads manualmente).
 * Espelha o contrato esperado pelo site: campos de texto + photos[] + pdf opcional.
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { pool } = require('../config/db');
const storageSvc = require('../services/storage');

const router = express.Router();

const memStorage = multer.memoryStorage();
const upload = multer({
  storage: memStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
});

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 5;
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png']);

function trimStr(v) {
  return v == null ? '' : String(v).trim();
}

function photoSuffix(mimetype, originalname) {
  const m = String(mimetype || '').toLowerCase();
  if (m === 'image/png') return '.png';
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  const ext = path.extname(originalname || '').toLowerCase();
  if (ext === '.png') return '.png';
  if (ext === '.jpg' || ext === '.jpeg') return '.jpg';
  return '.jpg';
}

function uniqueRelPath(ext) {
  const stamp = Date.now();
  const rand = crypto.randomBytes(8).toString('hex');
  return `applications/${stamp}-${rand}${ext}`;
}

/**
 * Upload buffer → storage (B2 ou local conforme STORAGE_DRIVER); devolve URL pública.
 */
async function uploadBufferToStorage(buffer, relativePath, contentType) {
  await storageSvc.saveFile({
    buffer,
    relativePath,
    contentType: contentType || 'application/octet-stream',
  });
  const url = storageSvc.getPublicUrl(relativePath);
  if (!url) {
    throw new Error('storage: URL publica indisponivel (configure B2 ou PUBLIC_APP_URL).');
  }
  return url;
}

router.post(
  '/applications',
  upload.fields([
    { name: 'photos', maxCount: MAX_PHOTOS },
    { name: 'pdf', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      if (!pool) {
        return res.status(503).json({ error: 'Servico indisponivel.' });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const website = trimStr(body.website);
      if (website) {
        return res.status(200).json({ ok: true });
      }

      const photoFiles = Array.isArray(req.files?.photos) ? req.files.photos : [];
      const pdfFiles = Array.isArray(req.files?.pdf) ? req.files.pdf : [];

      if (photoFiles.length < MIN_PHOTOS) {
        return res.status(400).json({ error: `Envie pelo menos ${MIN_PHOTOS} fotos.` });
      }
      if (photoFiles.length > MAX_PHOTOS) {
        return res.status(400).json({ error: `No maximo ${MAX_PHOTOS} fotos.` });
      }

      for (const f of photoFiles) {
        const mime = String(f.mimetype || '').toLowerCase();
        if (!PHOTO_MIMES.has(mime)) {
          return res.status(400).json({ error: 'Apenas imagens JPG e PNG sao permitidas para fotos.' });
        }
      }

      let pdfFile = pdfFiles[0];
      if (pdfFile && pdfFile.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: 'Apenas arquivos PDF sao aceitos no campo PDF.' });
      }

      const name = trimStr(body.name);
      const email = trimStr(body.email);
      const phone = trimStr(body.phone);
      const age = trimStr(body.age);
      const height = trimStr(body.height);
      const city = trimStr(body.city);
      const state = trimStr(body.state);
      const instagram = trimStr(body.instagram);

      if (!name || !email || !phone || !age || !height || !city) {
        return res.status(400).json({ error: 'Preencha os campos obrigatorios.' });
      }

      /** @type {string[]} */
      const photoUrls = [];
      for (const f of photoFiles) {
        if (!f.buffer || !f.buffer.length) continue;
        const ext = photoSuffix(f.mimetype, f.originalname);
        const relPath = uniqueRelPath(ext);
        const url = await uploadBufferToStorage(f.buffer, relPath, f.mimetype || 'image/jpeg');
        photoUrls.push(url);
      }

      if (photoUrls.length < MIN_PHOTOS) {
        return res.status(400).json({ error: 'Falha ao processar fotos.' });
      }

      let pdfUrl = null;
      if (pdfFile && pdfFile.buffer && pdfFile.buffer.length) {
        const relPdf = uniqueRelPath('.pdf');
        pdfUrl = await uploadBufferToStorage(pdfFile.buffer, relPdf, 'application/pdf');
      }

      const photosJson = JSON.stringify(photoUrls);

      const ins = await pool.query(
        `
        INSERT INTO applications (
          name, email, phone, age, height, city, state, instagram,
          photos, pdf_url, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'new')
        RETURNING id, created_at
        `,
        [
          name,
          email,
          phone,
          age,
          height,
          city,
          state || null,
          instagram || null,
          photosJson,
          pdfUrl,
        ],
      );

      const row = ins.rows[0];
      return res.status(201).json({
        ok: true,
        id: row.id,
        created_at: row.created_at,
      });
    } catch (e) {
      return next(e);
    }
  },
);

module.exports = router;
