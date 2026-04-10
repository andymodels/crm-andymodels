/**
 * Pré-visualização de migração de fotos de perfil para Backblaze B2.
 * Conta quantos modelos têm foto "antiga" (URL que não começa pelo host B2 indicado).
 * Não faz upload nem altera dados.
 *
 *   cd backend && node scripts/migrateModelImagesToB2.js
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

/** Prefixo público B2 alvo (ajuste se o bucket usar outro host fXXX). */
const B2_PUBLIC_PREFIX = 'https://f005.backblazeb2.com';

function needsMigration(foto) {
  const s = foto == null ? '' : String(foto).trim();
  if (!s) return false;
  return !s.startsWith(B2_PUBLIC_PREFIX);
}

async function main() {
  await initDb();
  if (!pool) {
    console.error('Erro: pool da base de dados indisponível.');
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT id, foto_perfil_base64 FROM modelos ORDER BY id`,
  );

  let countNeedMigration = 0;
  for (const r of rows) {
    if (needsMigration(r.foto_perfil_base64)) countNeedMigration += 1;
  }

  console.log('');
  console.log(`[migrateModelImagesToB2] Prefixo B2 considerado "já migrado": ${B2_PUBLIC_PREFIX}`);
  console.log(`[migrateModelImagesToB2] Total de modelos na base: ${rows.length}`);
  console.log(`[migrateModelImagesToB2] Modelos que precisam ser migrados: ${countNeedMigration}`);
  console.log('');

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
