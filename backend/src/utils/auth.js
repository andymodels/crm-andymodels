const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const AUTH_COOKIE_NAME = 'crm_auth';
const JWT_TTL_SECONDS = 60 * 60 * 12; // 12h

function jwtSecret() {
  return process.env.JWT_SECRET || 'crm-dev-secret-change-me';
}

function parseCookieHeader(header) {
  const out = {};
  const raw = String(header || '');
  if (!raw) return out;
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function readAuthToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const cookies = parseCookieHeader(req.headers.cookie);
  return String(cookies[AUTH_COOKIE_NAME] || '').trim();
}

function signUserToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, tipo: user.tipo, nome: user.nome },
    jwtSecret(),
    { expiresIn: JWT_TTL_SECONDS },
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, jwtSecret());
}

function appendSetCookieHeader(res, value) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, value]);
    return;
  }
  res.setHeader('Set-Cookie', [existing, value]);
}

function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${JWT_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  appendSetCookieHeader(res, parts.join('; '));
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  appendSetCookieHeader(res, parts.join('; '));
}

async function hashPassword(raw) {
  return bcrypt.hash(String(raw || ''), 12);
}

async function comparePassword(raw, hash) {
  return bcrypt.compare(String(raw || ''), String(hash || ''));
}

module.exports = {
  AUTH_COOKIE_NAME,
  readAuthToken,
  signUserToken,
  verifyUserToken,
  setAuthCookie,
  clearAuthCookie,
  hashPassword,
  comparePassword,
};
