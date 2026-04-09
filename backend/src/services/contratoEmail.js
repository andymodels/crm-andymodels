const nodemailer = require('nodemailer');

function isValidEmail(raw) {
  const v = String(raw || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Extrai e-mail (e nome opcional) de MAIL_FROM estilo "Nome <a@b.com>" ou só o e-mail. */
function parseSenderAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/<([^>\s]+@[^>\s]+)>/);
  if (m) {
    const email = m[1].trim();
    const name = s.replace(m[0], '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
    return { email, name: name || undefined };
  }
  if (isValidEmail(s)) return { email: s, name: undefined };
  return { email: null, name: undefined };
}

function classifySmtpError(error) {
  const code = String(error?.code || '').toUpperCase();
  const msg = String(error?.message || '').toLowerCase();
  if (code === 'EAUTH' || msg.includes('auth') || msg.includes('invalid login')) return 'autenticacao';
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') return 'conexao';
  return 'envio';
}

/** Mesmo default que `contratoWorkflow.appBaseUrl` e rotas públicas — evita exigir env no Render. */
const DEFAULT_PUBLIC_APP_URL = 'https://crm-andymodels.onrender.com';

function validateContratoEmailEnv() {
  const missing = [];
  const invalid = [];
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const mailFrom = String(process.env.MAIL_FROM || '').trim();
  const appUrlRaw = String(process.env.PUBLIC_APP_URL || '').trim();
  const appUrl = appUrlRaw || DEFAULT_PUBLIC_APP_URL;
  const portRaw = String(process.env.SMTP_PORT || '').trim();
  const secureRaw = String(process.env.SMTP_SECURE || '').trim().toLowerCase();

  if (!host) missing.push('SMTP_HOST');
  if (!portRaw) missing.push('SMTP_PORT');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');
  const remetente = mailFrom || user;
  if (!remetente) missing.push('MAIL_FROM ou SMTP_USER (remetente)');
  else if (!isValidEmail(remetente)) invalid.push('MAIL_FROM / SMTP_USER (remetente inválido)');

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

  try {
    const u = new URL(appUrl);
    if (!/^https?:$/.test(u.protocol)) invalid.push('PUBLIC_APP_URL (use http(s)://...)');
  } catch {
    if (appUrlRaw) invalid.push('PUBLIC_APP_URL (URL inválida)');
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
 * Cabeçalhos no relay Brevo (SMTP) para pedir desativação de tracking de cliques/aberturas.
 */
function brevoAgendaSmtpHeaders() {
  return {
    'X-Sib-Options': JSON.stringify({ trackClicks: false, trackOpens: false }),
  };
}

/** SMTP dedicado à convocação da agenda (ex.: SES, Mailgun) — sem reescrita sendibt. */
function createAgendaDedicatedTransport() {
  const host = String(process.env.AGENDA_SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(process.env.AGENDA_SMTP_PORT || 587);
  const secure = process.env.AGENDA_SMTP_SECURE === 'true' || port === 465;
  const user = process.env.AGENDA_SMTP_USER;
  const pass = process.env.AGENDA_SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

async function sendAgendaViaDedicatedSmtp({ to, subject, html, text }) {
  const transport = createAgendaDedicatedTransport();
  if (!transport) {
    const err = new Error('AGENDA_SMTP_HOST inválido.');
    err.code = 'SMTP_CONFIG_INVALID';
    throw err;
  }
  const from =
    String(process.env.AGENDA_MAIL_FROM || process.env.MAIL_FROM || process.env.SMTP_USER || '').trim() ||
    'noreply@localhost';
  const info = await transport.sendMail({
    from,
    to,
    subject,
    html,
    text: text != null && String(text).trim() ? String(text) : undefined,
  });
  const messageId = info?.messageId || null;
  if (messageId) {
    console.info('[agenda-smtp] convocação via AGENDA_SMTP_* (sem Brevo)', {
      to,
      messageId: String(messageId).slice(0, 200),
    });
  }
  return { messageId: messageId ? String(messageId) : null, accepted: info?.accepted, rejected: info?.rejected };
}

/**
 * POST /v3/smtp/email com tracking desativado no payload (quando a API aceitar o campo).
 * @see https://developers.brevo.com/reference/send-transac-email — campo `headers` suportado
 */
async function postBrevoTransactionalSend(apiKey, body) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Envia convocação da agenda. Ordem:
 * 1) AGENDA_SMTP_HOST — relay próprio (sem Brevo / sem sendibt);
 * 2) BREVO_API_KEY — API REST com tracking desativado no JSON + headers;
 * 3) SMTP global (sou Brevo) + X-Sib-Options + multipart texto.
 */
async function sendAgendaConvocacaoEmail({ to, subject, html, text }) {
  const toAddr = String(to || '').trim();
  if (!toAddr) {
    const err = new Error('Destinatário inválido.');
    err.code = 'SMTP_CONFIG_INVALID';
    throw err;
  }

  if (createAgendaDedicatedTransport()) {
    try {
      return await sendAgendaViaDedicatedSmtp({ to: toAddr, subject, html, text });
    } catch (e) {
      console.warn('[agenda-smtp] falha no SMTP dedicado, a tentar Brevo/SMTP global:', e?.message || e);
      if (process.env.AGENDA_SMTP_FAIL_CLOSED === 'true') {
        throw e;
      }
    }
  }

  const apiKey = String(process.env.BREVO_API_KEY || process.env.BREVO_TRANSACTIONAL_API_KEY || '').trim();
  const senderRaw = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  const parsed = parseSenderAddress(senderRaw);

  if (apiKey) {
    if (!parsed.email || !isValidEmail(parsed.email)) {
      const err = new Error(
        'Com BREVO_API_KEY é obrigatório MAIL_FROM (ou SMTP_USER) com um e-mail válido e autorizado no Brevo.',
      );
      err.code = 'SMTP_CONFIG_INVALID';
      throw err;
    }
    let body = {
      sender: {
        email: parsed.email,
        name: parsed.name || 'Andy Models CRM',
      },
      to: [{ email: toAddr }],
      subject: String(subject || '').trim(),
      htmlContent: html,
      textContent: String(text || '').trim() || undefined,
      tags: ['crm-agenda-convocacao'],
      /** Pedido explícito ao Brevo para não reescrever links (sendibt). */
      tracking: {
        clicks: false,
        opens: false,
      },
      headers: {
        'X-Sib-Options': JSON.stringify({ trackClicks: false, trackOpens: false }),
      },
    };

    let res = await postBrevoTransactionalSend(apiKey, body);
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }

    if (!res.ok && res.status === 400 && body.tracking) {
      const { tracking: _drop, ...withoutTracking } = body;
      console.warn('[brevo-api] HTTP 400: a reenviar sem o campo tracking (versão antiga da API?)');
      res = await postBrevoTransactionalSend(apiKey, withoutTracking);
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
    }

    if (!res.ok) {
      const err = new Error(data?.message || `Brevo API rejeitou o envio (HTTP ${res.status}).`);
      err.code = 'SMTP_SEND_FAILED';
      err.brevo_code = data?.code || null;
      throw err;
    }
    const messageId = data?.messageId != null ? String(data.messageId) : null;
    if (messageId) {
      console.info('[brevo-api] convocação agenda (tracking off no payload)', {
        to: toAddr,
        messageId: messageId.slice(0, 200),
      });
    }
    return { messageId, accepted: [toAddr], rejected: [] };
  }

  return sendContratoEmail({
    to: toAddr,
    subject,
    html,
    text,
    headers: brevoAgendaSmtpHeaders(),
  });
}

/**
 * Envia HTML por SMTP. Requer SMTP_HOST (e credenciais conforme servidor).
 * `text` gera multipart/alternative (URLs em texto simples costumam não ser reescritas pelo Brevo).
 */
async function sendContratoEmail({ to, subject, html, attachments, text, headers }) {
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
    const info = await transport.sendMail({
      from,
      to,
      subject,
      html,
      text: text != null && String(text).trim() ? String(text) : undefined,
      headers: headers && typeof headers === 'object' ? headers : undefined,
      attachments: Array.isArray(attachments) ? attachments : undefined,
    });
    const messageId = info?.messageId || info?.response || null;
    if (messageId) {
      console.info('[smtp] enviado', { to, messageId: String(messageId).slice(0, 200) });
    }
    return { messageId: messageId ? String(messageId) : null, accepted: info?.accepted, rejected: info?.rejected };
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
  sendAgendaConvocacaoEmail,
};
