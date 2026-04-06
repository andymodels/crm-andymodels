/**
 * Remove orçamentos de teste e tudo que depende deles (O.S., recebimentos, linhas, etc.).
 *
 * Critérios (basta um):
 * - descrição do orçamento contém [SEED-PERFIL-TESTE]
 * - cliente com CNPJ/documento do seed (12.345.678/0001-99)
 * - nome da empresa: "Cliente Teste CRM" ou "Cliente Fictício Perfil Teste"
 *
 *   cd backend && npm run apagar:orcamentos-teste
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL no arquivo backend/.env');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');

const DOC_SEED = '12.345.678/0001-99';

async function listarIdsOrcamentosTeste(client) {
  const { rows } = await client.query(
    `
    SELECT o.id, o.descricao, c.nome_empresa
    FROM orcamentos o
    JOIN clientes c ON c.id = o.cliente_id
    WHERE o.descricao LIKE '%[SEED-PERFIL-TESTE]%'
       OR COALESCE(NULLIF(TRIM(c.documento), ''), NULLIF(TRIM(c.cnpj), '')) = $1
       OR TRIM(c.nome_empresa) IN ('Cliente Teste CRM', 'Cliente Fictício Perfil Teste')
    ORDER BY o.id
    `,
    [DOC_SEED],
  );
  return rows;
}

async function apagarPorOrcamentoIds(client, ids) {
  if (ids.length === 0) return 0;

  await client.query(
    `DELETE FROM recebimentos WHERE os_id IN (
       SELECT id FROM ordens_servico WHERE orcamento_id = ANY($1::int[])
     )`,
    [ids],
  );
  await client.query(
    `DELETE FROM pagamentos_modelo WHERE os_modelo_id IN (
       SELECT om.id FROM os_modelos om
       INNER JOIN ordens_servico os ON os.id = om.os_id
       WHERE os.orcamento_id = ANY($1::int[])
     )`,
    [ids],
  );
  await client.query(
    `DELETE FROM os_documentos WHERE os_id IN (
       SELECT id FROM ordens_servico WHERE orcamento_id = ANY($1::int[])
     )`,
    [ids],
  );
  await client.query(
    `DELETE FROM os_historico WHERE os_id IN (
       SELECT id FROM ordens_servico WHERE orcamento_id = ANY($1::int[])
     )`,
    [ids],
  );
  await client.query(
    `DELETE FROM os_modelos WHERE os_id IN (
       SELECT id FROM ordens_servico WHERE orcamento_id = ANY($1::int[])
     )`,
    [ids],
  );
  await client.query(`DELETE FROM ordens_servico WHERE orcamento_id = ANY($1::int[])`, [ids]);
  await client.query(`DELETE FROM orcamento_modelos WHERE orcamento_id = ANY($1::int[])`, [ids]);
  const del = await client.query(`DELETE FROM orcamentos WHERE id = ANY($1::int[]) RETURNING id`, [ids]);
  return del.rowCount;
}

async function main() {
  await initDb();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lista = await listarIdsOrcamentosTeste(client);
    const ids = lista.map((r) => r.id);

    if (ids.length === 0) {
      await client.query('COMMIT');
      console.log('');
      console.log('Nenhum orçamento de teste encontrado (critérios: seed [SEED-PERFIL-TESTE], CNPJ seed ou nome Cliente Teste CRM / Cliente Fictício Perfil Teste).');
      console.log('');
      return;
    }

    console.log('');
    console.log('Orçamentos de teste a remover:');
    lista.forEach((r) => {
      console.log(`  #${r.id} — ${r.nome_empresa} — ${String(r.descricao).slice(0, 80)}${r.descricao.length > 80 ? '…' : ''}`);
    });
    console.log('');

    const n = await apagarPorOrcamentoIds(client, ids);

    const delClientes = await client.query(
      `
      DELETE FROM clientes c
      WHERE NOT EXISTS (SELECT 1 FROM orcamentos o WHERE o.cliente_id = c.id)
        AND (
          COALESCE(NULLIF(TRIM(c.documento), ''), NULLIF(TRIM(c.cnpj), '')) = $1
          OR TRIM(c.nome_empresa) IN ('Cliente Teste CRM', 'Cliente Fictício Perfil Teste')
        )
      RETURNING id, nome_empresa
      `,
      [DOC_SEED],
    );
    if (delClientes.rowCount > 0) {
      delClientes.rows.forEach((row) => {
        console.log(`  Cliente de teste removido (sem orçamentos): #${row.id} — ${row.nome_empresa}`);
      });
    }

    await client.query('COMMIT');

    console.log(`OK — ${n} orçamento(s) de teste removido(s), com O.S. e vínculos.`);
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
