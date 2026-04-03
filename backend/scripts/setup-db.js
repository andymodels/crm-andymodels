/**
 * Prepara o PostgreSQL: mesma lógica de `initDb` em `src/config/db.js`.
 *
 * Render: Root Directory = `backend` → Start Command:
 *   node scripts/setup-db.js && node src/server.js
 *
 * Local: na pasta backend, com DATABASE_URL (arquivo .env ou export), rode `npm run setup:db`.
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');

// Local: backend/.env. Render: variáveis vêm do painel.
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error(
    'Defina DATABASE_URL (variável de ambiente no Render ou arquivo backend/.env localmente).',
  );
  process.exit(1);
}

const { initDb, pool } = require('../src/config/db');

async function run() {
  try {
    console.log('Executando initDb (CREATE TABLE / ALTER column incremental)...');
    await initDb();
    console.log('Setup do banco concluído.');
  } catch (err) {
    console.error('Falha no setup do banco:', err.message || err);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

run();
