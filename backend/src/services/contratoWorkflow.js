const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadContratoContext } = require('./contratoContext');
const { validarContratoPronto } = require('./contratoReadiness');
const { buildContratoDocumentHtml } = require('./contratoHtml');
const { renderContratoPdfBuffer } = require('./contratoPdf');
const { sendContratoEmail, validateContratoEmailEnv } = require('./contratoEmail');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

function appBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com').replace(/\/$/, '');
}

function contratoAssinaturaPath(token) {
  return `/assinatura-contrato?token=${encodeURIComponent(token)}`;
}

function contratoAssinaturaUrl(token) {
  return `${appBaseUrl()}${contratoAssinaturaPath(token)}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureContratoToken(db, osId) {
  const current = await db.query(
    `SELECT contrato_assinatura_token FROM ordens_servico WHERE id = $1`,
    [osId],
  );
  if (current.rows.length === 0) return null;
  const existing = current.rows[0].contrato_assinatura_token;
  if (existing && String(existing).trim()) return String(existing).trim();
  const token = crypto.randomUUID();
  await db.query(
    `
    UPDATE ordens_servico
    SET contrato_assinatura_token = $2, updated_at = NOW()
    WHERE id = $1
    `,
    [osId, token],
  );
  return token;
}

async function deleteOldGeneratedDoc(db, osId) {
  const old = await db.query(
    `
    DELETE FROM os_documentos
    WHERE os_id = $1 AND tipo = 'contrato_pdf_gerado'
    RETURNING storage_path
    `,
    [osId],
  );
  for (const row of old.rows) {
    if (!row.storage_path) continue;
    const abs = path.join(UPLOAD_ROOT, ...String(row.storage_path).split('/'));
    try {
      fs.unlinkSync(abs);
    } catch {
      // arquivo já removido/indisponível
    }
  }
}

async function saveGeneratedContractSnapshot(db, osId, pdfBuffer) {
  ensureDir(UPLOAD_ROOT);
  const dir = path.join(UPLOAD_ROOT, 'os', String(osId));
  ensureDir(dir);
  const fileName = `contrato-os-${osId}.pdf`;
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, pdfBuffer);
  const relPath = `os/${osId}/${fileName}`;
  const sha = sha256Hex(pdfBuffer);

  await deleteOldGeneratedDoc(db, osId);
  await db.query(
    `
    INSERT INTO os_documentos (os_id, tipo, nome_arquivo, mime, storage_path, sha256)
    VALUES ($1, 'contrato_pdf_gerado', $2, 'application/pdf', $3, $4)
    `,
    [osId, fileName, relPath, sha],
  );
}

async function generateContratoForOs(db, osId) {
  const ctx = await loadContratoContext(db, osId);
  if (!ctx) return { ok: false, message: 'O.S. nao encontrada.' };
  if (!ctx.os.emitir_contrato) return { ok: false, message: 'O.S. sem emissao de contrato ativa.' };
  const erros = await validarContratoPronto(db, osId, ctx.os, ctx.os.tipo_os || 'com_modelo');
  if (erros.length > 0) return { ok: false, message: `Dados incompletos para contrato: ${erros.join('; ')}` };

  const token = await ensureContratoToken(db, osId);
  const html = buildContratoDocumentHtml(ctx);
  const pdfBuffer = await renderContratoPdfBuffer(html);
  await saveGeneratedContractSnapshot(db, osId, pdfBuffer);
  await db.query(
    `
    UPDATE ordens_servico
    SET contrato_gerado_em = NOW(),
        contrato_status = 'aguardando_assinatura',
        contrato_assinado_em = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [osId],
  );
  return {
    ok: true,
    token,
    assinatura_link: token ? contratoAssinaturaUrl(token) : null,
    assinatura_path: token ? contratoAssinaturaPath(token) : null,
  };
}

async function sendContratoAssinaturaEmail(db, osId, destinatario) {
  const ctx = await loadContratoContext(db, osId);
  if (!ctx) return { ok: false, message: 'O.S. nao encontrada.' };
  const token = await ensureContratoToken(db, osId);
  const link = contratoAssinaturaUrl(token);
  const htmlContrato = buildContratoDocumentHtml(ctx);
  const pdfBuffer = await renderContratoPdfBuffer(htmlContrato);
  const fileName = `contrato-os-${osId}.pdf`;
  const previewLink = `${appBaseUrl()}/api/ordens-servico/${osId}/contrato-preview`;
  const pdfLink = `${appBaseUrl()}/api/ordens-servico/${osId}/contrato-pdf`;
  const html = `
    <p>Olá,</p>
    <p>Segue o contrato da O.S. nº <strong>${osId}</strong>.</p>
    <p><strong>Visualização:</strong> <a href="${previewLink}" target="_blank" rel="noreferrer">${previewLink}</a></p>
    <p><strong>PDF:</strong> <a href="${pdfLink}" target="_blank" rel="noreferrer">${pdfLink}</a></p>
    <p>Assine neste link:</p>
    <p><a href="${link}" target="_blank" rel="noreferrer">${link}</a></p>
  `;
  const subject =
    process.env.CONTRATO_EMAIL_ASSUNTO ||
    `Contrato — O.S. nº ${osId} — ${ctx.cliente.nome_fantasia || ctx.cliente.nome_empresa || 'Cliente'}`;
  const to = String(destinatario || '').trim();
  try {
    const envCheck = validateContratoEmailEnv();
    if (envCheck.missing.length > 0 || envCheck.invalid.length > 0) {
      const msg = `Configuração SMTP inválida. Faltando: ${envCheck.missing.join(', ') || 'nenhum'}; Inválido: ${envCheck.invalid.join(', ') || 'nenhum'}.`;
      const cfgErr = new Error(msg);
      cfgErr.code = 'SMTP_CONFIG_INVALID';
      cfgErr.meta = envCheck;
      throw cfgErr;
    }

    await sendContratoEmail({
      to,
      subject,
      html,
      attachments: [{ filename: fileName, content: pdfBuffer, contentType: 'application/pdf' }],
    });
    await db.query(
      `UPDATE ordens_servico SET contrato_enviado_em = NOW(), updated_at = NOW() WHERE id = $1`,
      [osId],
    );
    const errPayload = {
      destinatario: to,
      status: 'erro',
      erro: String(error?.message || 'falha no envio'),
      code: String(error?.code || ''),
      smtp_type: String(error?.smtp_type || ''),
      smtp_raw_code: String(error?.smtp_raw_code || ''),
    };
    console.error('[contrato][email] falha no envio', { osId, ...errPayload });
    await db.query(
      `
      INSERT INTO os_historico (os_id, usuario, campo, valor_anterior, valor_novo)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [osId, 'sistema', 'contrato_email_envio', '', JSON.stringify({ destinatario: to, status: 'enviado' })],
    );
    return { ok: true, assinatura_link: link, preview_link: previewLink, pdf_link: pdfLink };
  } catch (error) {
    await db.query(
      `
      INSERT INTO os_historico (os_id, usuario, campo, valor_anterior, valor_novo)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        osId,
        'sistema',
        'contrato_email_envio',
        '',
        JSON.stringify(errPayload),
      ],
    );
    throw error;
  }
}

module.exports = {
  contratoAssinaturaPath,
  contratoAssinaturaUrl,
  ensureContratoToken,
  generateContratoForOs,
  sendContratoAssinaturaEmail,
};
