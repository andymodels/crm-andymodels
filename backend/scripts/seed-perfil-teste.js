/**
 * Perfil de teste (cenário fixo):
 * - Cachê bruto: R$ 1.000,00
 * - Taxa agência: 20% sobre o cachê → R$ 200,00
 * - Extras agência: R$ 300,00
 * - Total ao cliente: R$ 1.500,00 (= 1000 + 200 + 300)
 *
 * Uso (na pasta backend, com DATABASE_URL no .env):
 *   npm run seed:perfil   — remove só o que foi criado pelo seed ([SEED-PERFIL-TESTE]) e recria o cenário.
 *   npm run reset:teste   — zera tudo e recria UM cenário fixo (cliente + orçamento + O.S.).
 *   npm run reset:limpo   — zera tudo e NÃO cria nada (orçamentos / clientes vazios).
 *
 * O cliente criado pelo seed chama-se "Cliente Teste CRM" (não é lixo antigo — é o cenário controlado).
 * Use reset:limpo se quiser lista vazia sem dados de teste.
 */

const path = require('path');
const { loadEnvFile } = require('../src/config/loadEnv');
loadEnvFile(path.join(__dirname, '..'));

if (!process.env.DATABASE_URL) {
  console.error('Erro: defina DATABASE_URL no arquivo backend/.env');
  process.exit(1);
}

const { pool, initDb } = require('../src/config/db');
const { computeOsFinancials } = require('../src/services/osFinanceiro');
const { truncateNegocio } = require('./truncateNegocio');

const SEED_TAG = '[SEED-PERFIL-TESTE]';
const DOC_CLIENTE = '12.345.678/0001-99';
const CPF_MODELO = '529.982.247-25';

const CACHE = 1000;
const TAXA_PCT = 20;
const EXTRAS = 300;
const IMPOSTO_PCT = 10;

async function limparSeedAnterior(client) {
  const like = `%${SEED_TAG}%`;
  await client.query(
    `DELETE FROM recebimentos WHERE os_id IN (
      SELECT os.id FROM ordens_servico os
      INNER JOIN orcamentos o ON o.id = os.orcamento_id
      WHERE o.descricao LIKE $1
    )`,
    [like],
  );
  await client.query(
    `DELETE FROM pagamentos_modelo WHERE os_modelo_id IN (
      SELECT om.id FROM os_modelos om
      INNER JOIN ordens_servico os ON os.id = om.os_id
      INNER JOIN orcamentos o ON o.id = os.orcamento_id
      WHERE o.descricao LIKE $1
    )`,
    [like],
  );
  await client.query(
    `DELETE FROM os_documentos WHERE os_id IN (
      SELECT os.id FROM ordens_servico os
      INNER JOIN orcamentos o ON o.id = os.orcamento_id
      WHERE o.descricao LIKE $1
    )`,
    [like],
  );
  await client.query(
    `DELETE FROM os_modelos WHERE os_id IN (
      SELECT os.id FROM ordens_servico os
      INNER JOIN orcamentos o ON o.id = os.orcamento_id
      WHERE o.descricao LIKE $1
    )`,
    [like],
  );
  await client.query(
    `DELETE FROM ordens_servico WHERE orcamento_id IN (
      SELECT id FROM orcamentos WHERE descricao LIKE $1
    )`,
    [like],
  );
  await client.query(`DELETE FROM orcamentos WHERE descricao LIKE $1`, [like]);
}

async function garantirCliente(client) {
  const r = await client.query(`SELECT id FROM clientes WHERE documento = $1 OR cnpj = $1 LIMIT 1`, [
    DOC_CLIENTE,
  ]);
  if (r.rows.length > 0) return r.rows[0].id;

  const ins = await client.query(
    `
    INSERT INTO clientes (
      tipo_pessoa, documento, nome_empresa, nome_fantasia, cnpj, inscricao_estadual,
      contato_principal, documento_representante, telefone, email, endereco_completo, observacoes,
      telefones, emails, cep, logradouro, numero, bairro, cidade, uf
    )
    VALUES (
      'PJ', $1,
      'Cliente Teste CRM',
      'Marca Seed',
      $1,
      'ISENTO',
      'Contato Seed',
      '11144477735',
      '(11) 98888-7777',
      'cliente.perfil.seed@teste.com',
      'Endereço fictício para seed',
      'Cadastro apenas para testes de cálculo.',
      '["(11) 98888-7777"]'::jsonb,
      '["cliente.perfil.seed@teste.com"]'::jsonb,
      '01310-100', 'Av. Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP'
    )
    RETURNING id
    `,
    [DOC_CLIENTE],
  );
  return ins.rows[0].id;
}

async function garantirModelo(client) {
  const r = await client.query(`SELECT id FROM modelos WHERE cpf = $1 LIMIT 1`, [CPF_MODELO]);
  if (r.rows.length > 0) return r.rows[0].id;

  const ins = await client.query(
    `
    INSERT INTO modelos (
      nome, cpf, telefone, email, chave_pix, banco_dados,
      emite_nf_propria, observacoes, ativo,
      data_nascimento, telefones, emails, formas_pagamento
    )
    VALUES (
      'Modelo Fictício Perfil',
      $1,
      '(11) 97777-6666',
      'modelo.perfil.seed@teste.com',
      '52998224725',
      '',
      FALSE,
      'Cadastro seed para teste de O.S.',
      TRUE,
      '1995-06-15',
      '["(11) 97777-6666"]'::jsonb,
      '["modelo.perfil.seed@teste.com"]'::jsonb,
      '[{"tipo":"PIX","tipo_chave_pix":"CPF","chave_pix":"11144477735"}]'::jsonb
    )
    RETURNING id
    `,
    [CPF_MODELO],
  );
  return ins.rows[0].id;
}

async function recalcularFinanceiroOs(client, osId) {
  const { rows: [os] } = await client.query('SELECT * FROM ordens_servico WHERE id = $1', [osId]);
  const { rows: linhas } = await client.query(
    'SELECT cache_modelo, emite_nf_propria FROM os_modelos WHERE os_id = $1 ORDER BY id',
    [osId],
  );

  const nums = computeOsFinancials({
    tipo_os: os.tipo_os,
    valor_servico: os.valor_servico,
    cache_modelo_total: os.cache_modelo_total,
    agencia_fee_percent: os.agencia_fee_percent,
    extras_agencia_valor: os.extras_agencia_valor,
    extras_despesa_valor: os.extras_despesa_valor,
    imposto_percent: os.imposto_percent,
    parceiro_percent: os.parceiro_percent,
    booker_percent: os.booker_percent,
    linhas: linhas.map((l) => ({
      cache_modelo: l.cache_modelo,
      emite_nf_propria: l.emite_nf_propria,
    })),
  });

  await client.query(
    `
    UPDATE ordens_servico SET
      cache_modelo_total = $1,
      taxa_agencia_valor = $2,
      imposto_valor = $3,
      modelo_liquido_total = $4,
      agencia_parcial = $5,
      parceiro_valor = $6,
      agencia_apos_parceiro = $7,
      booker_valor = $8,
      agencia_final = $9,
      resultado_agencia = $10,
      total_cliente = $11,
      updated_at = NOW()
    WHERE id = $12
    `,
    [
      nums.cache_modelo_total,
      nums.taxa_agencia_valor,
      nums.imposto_valor,
      nums.modelo_liquido_total,
      nums.agencia_parcial,
      nums.parceiro_valor,
      nums.agencia_apos_parceiro,
      nums.booker_valor,
      nums.agencia_final,
      nums.resultado_agencia,
      nums.total_cliente,
      osId,
    ],
  );
}

async function main() {
  const resetCompleto =
    process.argv.includes('--reset-completo') ||
    process.argv.includes('--zerar-tudo') ||
    process.env.RESET_TESTE === '1';

  await initDb();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (resetCompleto) {
      console.log('');
      console.log('>>> RESET COMPLETO — todas as tabelas de negócio foram esvaziadas.');
      console.log('    Em seguida será criado apenas o cenário de teste com valores controlados.');
      console.log('');
      await truncateNegocio(client);
    } else {
      await limparSeedAnterior(client);
    }

    const clienteId = await garantirCliente(client);
    const modeloId = await garantirModelo(client);

    const descricao = `Job teste: R$ ${CACHE} bruto + ${TAXA_PCT}% agência + R$ ${EXTRAS} extras ${SEED_TAG}`;

    const orc = await client.query(
      `
      INSERT INTO orcamentos (
        cliente_id, tipo_trabalho, descricao,
        cache_base_estimado_total, taxa_agencia_percent, extras_agencia_valor,
        condicoes_pagamento, uso_imagem, prazo, territorio
      )
      VALUES ($1, 'Fotografia', $2, $3, $4, $5, '50% na reserva, 50% na entrega', 'Uso conforme briefing', '30 dias', 'Brasil')
      RETURNING *
      `,
      [clienteId, descricao, CACHE, TAXA_PCT, EXTRAS],
    );
    const budget = orc.rows[0];

    const nums = computeOsFinancials({
      tipo_os: 'com_modelo',
      valor_servico: 0,
      cache_modelo_total: budget.cache_base_estimado_total,
      agencia_fee_percent: budget.taxa_agencia_percent,
      extras_agencia_valor: budget.extras_agencia_valor,
      extras_despesa_valor: 0,
      imposto_percent: IMPOSTO_PCT,
      parceiro_percent: null,
      booker_percent: null,
      linhas: [],
    });

    const osIns = await client.query(
      `
      INSERT INTO ordens_servico (
        orcamento_id, cliente_id, descricao, tipo_os, uso_imagem, total_cliente, status,
        tipo_trabalho, prazo, territorio, condicoes_pagamento,
        valor_servico, cache_modelo_total, agencia_fee_percent, taxa_agencia_valor,
        extras_agencia_valor, extras_despesa_valor, extras_despesa_descricao,
        imposto_percent, imposto_valor, modelo_liquido_total, agencia_parcial,
        parceiro_id, parceiro_percent, parceiro_valor, agencia_apos_parceiro,
        booker_id, booker_percent, booker_valor, agencia_final, resultado_agencia
      )
      VALUES (
        $1, $2, $3, 'com_modelo', $4, $5, 'aberta',
        $6, $7, $8, $9,
        0, $10, $11, $12, $13, 0, '',
        $14, $15, $16, $17, NULL, NULL, $18, $19, NULL, NULL, $20, $21, $22
      )
      RETURNING id
      `,
      [
        budget.id,
        clienteId,
        budget.descricao,
        budget.uso_imagem,
        nums.total_cliente,
        budget.tipo_trabalho,
        budget.prazo,
        budget.territorio,
        budget.condicoes_pagamento,
        nums.cache_modelo_total,
        budget.taxa_agencia_percent,
        nums.taxa_agencia_valor,
        budget.extras_agencia_valor,
        IMPOSTO_PCT,
        nums.imposto_valor,
        nums.modelo_liquido_total,
        nums.agencia_parcial,
        nums.parceiro_valor,
        nums.agencia_apos_parceiro,
        nums.booker_valor,
        nums.agencia_final,
        nums.resultado_agencia,
      ],
    );

    const osId = osIns.rows[0].id;

    await client.query(
      `UPDATE orcamentos SET status = 'aprovado', updated_at = NOW() WHERE id = $1`,
      [budget.id],
    );

    await client.query(
      `
      INSERT INTO os_modelos (os_id, modelo_id, cache_modelo, emite_nf_propria)
      VALUES ($1, $2, $3, FALSE)
      `,
      [osId, modeloId, CACHE],
    );

    await recalcularFinanceiroOs(client, osId);

    await client.query('COMMIT');

    const { rows: [finalOs] } = await pool.query(
      `
      SELECT os.*, c.nome_empresa
      FROM ordens_servico os
      JOIN clientes c ON c.id = os.cliente_id
      WHERE os.id = $1
      `,
      [osId],
    );

    console.log('');
    console.log('=== Perfil de teste criado com sucesso ===');
    console.log('');
    console.log('Cliente ID:', clienteId, '(documento', DOC_CLIENTE + ')');
    console.log('Modelo ID:', modeloId, '(CPF', CPF_MODELO + ')');
    console.log('Orçamento ID:', budget.id);
    console.log('O.S. ID:', osId);
    console.log('');
    console.log('Referência manual (orçamento):');
    console.log('  Cachê bruto ........ R$', CACHE.toFixed(2));
    console.log('  Taxa 20% ........... R$', (CACHE * (TAXA_PCT / 100)).toFixed(2));
    console.log('  Extras agência ..... R$', EXTRAS.toFixed(2));
    console.log('  Total cliente ...... R$', (CACHE + CACHE * (TAXA_PCT / 100) + EXTRAS).toFixed(2));
    console.log('');
    console.log('Valores na O.S. após linha de modelo R$', CACHE.toFixed(2), '(sem NF própria):');
    console.log('  total_cliente ........ R$', Number(finalOs.total_cliente).toFixed(2));
    console.log('  modelo_liquido_total . R$', Number(finalOs.modelo_liquido_total).toFixed(2));
    console.log('  imposto_valor ........ R$', Number(finalOs.imposto_valor).toFixed(2));
    console.log('  resultado_agencia .... R$', Number(finalOs.resultado_agencia).toFixed(2));
    console.log('');
    console.log('Abra o CRM em Jobs / O.S. e localize a O.S. #' + osId + ' para conferir na interface.');
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
