const path = require('path');
const { loadEnvFile } = require('./config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

const app = require('./app');
const { initDb } = require('./config/db');

// Render (e outros PaaS) definhem PORT; localmente usa 3001.
const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

// O HTTP sobe de imediato; initDb corre em background e não bloqueia o arranque.
app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
  try {
    initDb().catch((err) => {
      console.error('[initDb] falhou (API continua ativa):', err.message || err);
    });
  } catch (err) {
    console.error('[initDb] erro ao agendar:', err.message || err);
  }
});
