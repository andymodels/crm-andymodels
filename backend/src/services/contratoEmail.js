const nodemailer = require('nodemailer');

function isValidEmail(raw) {
  const v = String(raw || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function classifySmtpError(error) {
  const code = String(error?.code || '').toUpperCase();
  const msg = String(error?.message || '').toLowerCase();
  if (code === 'EAUTH' || msg.includes('auth') || msg.includes('invalid login')) return 'autenticacao';
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') return 'conexao';
  return 'envio';
}

function validateContratoEmailEnv() {
  const missing = [];
  const invalid = [];
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const mailFrom = String(process.env.MAIL_FROM || '').trim();
  const appUrl = String(process.env.PUBLIC_APP_URL || '').trim();
  const portRaw = String(process.env.SMTP_PORT || '').trim();
  const secureRaw = String(process.env.SMTP_SECURE || '').trim().toLowerCase();

  if (!host) missing.push('SMTP_HOST');
  if (!portRaw) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');
  if (!mailFrom) missing.push('MAIL_FROM');
  if (!appUrl) missing.push('PUBLIC_APP_URL');

  const port = Number(portRaw || 0);
  if (portRaw && (!Number.isFinite(port) || port <= 0)) invalid.push('SMTP_PORT (deve ser número válido)');

  if (secureRaw && secureRaw !== 'true' && secureRaw !== 'false') {
    invalid.push('SMTP_SECURE (use true ou false)');
  }
  if (Number.isFinite(port) && port > 0) {
    const secure = secureRaw === 'true' || port === 465;
    if (port === 465 && !secure) invalid.push('SMTP_SECURE (porta 465 exige secure=true)');
    if (port === 587 && secureRaw === 'true') invalid.push('SMTP_SECURE (porta 587 recomenda secure=false)');
  }

  if (mailFrom && !isValidEmail(mailFrom)) invalid.push('MAIL_FROM (e-mail inválido)');
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      if (!/^https?:$/.test(u.protocol)) invalid.push('PUBLIC_APP_URL (use http(s)://...)');
    } catch {
      invalid.push('PUBLIC_APP_URL (URL inválida)');
    }
  }

  return { missing, invalid };
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

/**
 * Envia HTML por SMTP. Requer SMTP_HOST (e credenciais conforme servidor).
 */
async function sendContratoEmail({ to, subject, html, attachments }) {
  const { missing, invalid } = validateContratoEmailEnv();
  if (missing.length > 0 || invalid.length > 0) {
    const detail = [
      missing.length ? `faltando: ${missing.join(', ')}` : '',
      invalid.length ? `inválido: ${invalid.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
    const err = new Error(`Configuração SMTP inválida (${detail}).`);
    err.code = 'SMTP_CONFIG_INVALID';
    err.meta = { missing, invalid };
    throw err;
  }

  const transport = createTransport();
  if (!transport) {
    const err = new Error('SMTP nao configurado. Defina SMTP_HOST e demais variaveis no .env do backend.');
    err.code = 'SMTP_DISABLED';
    throw err;
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      attachments: Array.isArray(attachments) ? attachments : undefined,
    });
  } catch (error) {
    const tipo = classifySmtpError(error);
    const err = new Error(`Falha SMTP (${tipo}): ${error?.message || 'erro desconhecido'}`);
    err.code = 'SMTP_SEND_FAILED';
    err.smtp_type = tipo;
    err.smtp_raw_code = error?.code || null;
    throw err;
  }
}

module.exports = {
  validateContratoEmailEnv,
  sendContratoEmail,
};
