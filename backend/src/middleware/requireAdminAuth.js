const { readAuthToken, verifyUserToken } = require('../utils/auth');

function requireAdminAuth(req, res, next) {
  try {
    const token = readAuthToken(req);
    if (!token) return res.status(401).json({ message: 'Sessao expirada. Faca login novamente.' });
    const payload = verifyUserToken(token);
    if (!payload || payload.tipo !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores.' });
    }
    req.authUser = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Sessao invalida. Faca login novamente.' });
  }
}

module.exports = { requireAdminAuth };
