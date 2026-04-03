/**
 * Prepara o PostgreSQL: mesma lógica de `initDb` em `src/config/db.js`.
 *
 * Render: Root Directory = `backend` → Start Command:
 *   node scripts/setup-db.js && node src/server.js
 *
 * Local: na pasta backend, com DATABASE_URL (arquivo .env ou export), rode `npm run setup:db`.
 */

const path = require('path');

// Carregar .env ANTES de `require('../src/config/db')`, que valida DATABASE_URL na carga do módulo.
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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
    await pool.end();
  }
}

run();
