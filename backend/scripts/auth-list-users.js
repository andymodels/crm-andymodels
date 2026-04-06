const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
const { pool } = require('../src/config/db');

loadEnvFile(path.join(__dirname, '..'));

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ausente.');
    process.exit(1);
  }
  if (!pool) {
    console.error('Pool de banco indisponivel. Verifique DATABASE_URL.');
    process.exit(1);
  }
  try {
    const r = await pool.query(
      `SELECT id, nome, email, tipo, created_at, updated_at
       FROM usuarios
       ORDER BY id ASC`,
    );
    if (r.rows.length === 0) {
      console.log('Nenhum usuario encontrado.');
      return;
    }
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.error('Falha ao listar usuarios:', e.message || e);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

run();
