/**
 * Esvazia todas as tabelas de negócio (Postgres). Só ambiente de teste.
 * @param {import('pg').PoolClient} client
 */
async function truncateNegocio(client) {
  await client.query(`
    TRUNCATE TABLE
      pagamentos_modelo,
      recebimentos,
      os_documentos,
      os_historico,
      os_modelos,
      despesas,
      ordens_servico,
      orcamento_modelos,
      orcamentos,
      clientes,
      modelos,
      bookers,
      parceiros
    RESTART IDENTITY CASCADE
  `);
}

module.exports = { truncateNegocio };
