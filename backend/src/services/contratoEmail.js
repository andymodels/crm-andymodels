const nodemailer = require('nodemailer');

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
  const transport = createTransport();
  if (!transport) {
    const err = new Error('SMTP nao configurado. Defina SMTP_HOST e demais variaveis no .env do backend.');
    err.code = 'SMTP_DISABLED';
    throw err;
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@localhost';
  await transport.sendMail({
    from,
    to,
    subject,
    html,
    attachments: Array.isArray(attachments) ? attachments : undefined,
  });
}

module.exports = {
  sendContratoEmail,
};
