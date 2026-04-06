/**
 * Zera o banco de negócio e NÃO recria nada — lista de orçamentos fica vazia.
 *
 *   cd backend && npm run reset:limpo
 *
 * Requer DATABASE_URL no .env.
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL no arquivo backend/.env');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');
const { truncateNegocio } = require('./truncateNegocio');

async function main() {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateNegocio(client);
    await client.query('COMMIT');
    console.log('');
    console.log('OK — todas as tabelas de negócio foram esvaziadas (sem criar cliente/orçamento de teste).');
    console.log('');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
