const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
const { pool } = require('../src/config/db');
const { hashPassword } = require('../src/utils/auth');

loadEnvFile(path.join(__dirname, '..'));

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL ausente.');
    process.exit(1);
  }
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const senha = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!email) {
    console.error('ADMIN_EMAIL ausente.');
    process.exit(1);
  }
  if (!senha || senha.length < 8) {
    console.error('ADMIN_PASSWORD ausente ou curta (minimo 8).');
    process.exit(1);
  }

  try {
    const hash = await hashPassword(senha);
    const r = await pool.query(
      `UPDATE usuarios
       SET senha_hash = $1, tipo = 'admin', updated_at = NOW()
       WHERE lower(email) = $2
       RETURNING id, email`,
      [hash, email],
    );
    if (r.rows.length === 0) {
      console.error(`Usuario admin nao encontrado para email: ${email}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Senha atualizada com sucesso para ${r.rows[0].email} (id=${r.rows[0].id}).`);
  } catch (e) {
    console.error('Falha ao resetar senha:', e.message || e);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}

run();
