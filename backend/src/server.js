const path = require('path');
const fs = require('fs');
const { loadEnvFile } = require('./config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

const app = require('./app');
const { initDb } = require('./config/db');

// Render define PORT; localmente o projeto usa 3030 por defeito (evita conflito com Replit/outros na 3001).
const PORT = Number(process.env.PORT) || 3030;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST);

/** Uploads grandes (vídeo via proxy → site) podem demorar vários minutos; evitar fechar a socket cedo. */
const longMs = Number(process.env.HTTP_SERVER_LONG_TIMEOUT_MS) || 920000;
server.timeout = longMs;
if ('requestTimeout' in server && typeof server.requestTimeout !== 'undefined') {
  server.requestTimeout = longMs;
}
server.headersTimeout = longMs + 20000;

server.once('listening', () => {
  console.log(`API running on http://${HOST}:${PORT}`);
  try {
    const storage = require('./services/storage');
    const d = storage.driver();
    const hint =
      d === 'b2'
        ? storage.resolveB2PublicBase()
          ? 'OK (URL pública B2)'
          : 'ERRO: falta B2_PUBLIC_BASE_URL ou B2_DOWNLOAD_HOST+B2_BUCKET — fotos ficam em erro ao gravar'
        : 'local (uploads/)';
    console.log(`[storage] driver=${d} ${hint}`);
  } catch (e) {
    console.warn('[storage] ao verificar:', e.message || e);
  }
  const publicIndex = path.join(__dirname, '..', 'public', 'index.html');
  if (!fs.existsSync(publicIndex)) {
    console.log(
      '[dica] Sem interface em backend/public. Em dev: rode também "npm run dev" na pasta frontend e abra http://localhost:5173 — ou "npm run build" na pasta backend para servir o CRM nesta porta.',
    );
  }
  try {
    initDb()
      .then(() => require('./jobs/purgeRadioTestPlaylistsOnce').purgeRadioTestPlaylistsOnce())
      .catch((err) => {
        console.error('[initDb] falhou (API continua ativa):', err.message || err);
      });
  } catch (err) {
    console.error('[initDb] erro ao agendar:', err.message || err);
  }
  try {
    const { startHomeOrderShuffle } = require('./jobs/homeOrderShuffle');
    startHomeOrderShuffle();
  } catch (err) {
    console.warn('[home-shuffle] ao iniciar:', err.message || err);
  }
});

server.on('error', (err) => {
  console.error('[server] erro ao escutar:', err.message || err);
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[server] A porta ${PORT} já está em uso. Feche o outro programa ou defina PORT=3031 no backend/.env e VITE_DEV_PROXY_PORT=3031 no frontend/.env`,
    );
  }
  process.exit(1);
});
