const fs = require('fs');
const path = require('path');

/**
 * Carrega backend/.env em process.env sem o pacote dotenv (evita MODULE_NOT_FOUND
 * se o script correr antes de npm install completo; no Render usa só variáveis do painel).
 */
function loadEnvFile(backendRootDir) {
  const envPath = path.join(backendRootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

module.exports = { loadEnvFile };
