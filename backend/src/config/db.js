const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Keep startup explicit: user must provide PostgreSQL connection.
  throw new Error('DATABASE_URL is required in environment variables.');
}

const pool = new Pool({
  connectionString,
});

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nome_empresa TEXT NOT NULL,
      nome_fantasia TEXT NOT NULL,
      cnpj TEXT NOT NULL UNIQUE,
      inscricao_estadual TEXT NOT NULL,
      contato_principal TEXT NOT NULL,
      telefone TEXT NOT NULL,
      email TEXT NOT NULL,
      endereco_completo TEXT NOT NULL,
      observacoes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS telefones JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT NOT NULL DEFAULT 'PJ';
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS documento TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS cep TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS logradouro TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS numero TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS bairro TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS cidade TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS uf TEXT;
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS documento_representante TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE ordens_servico
    ADD COLUMN IF NOT EXISTS data_vencimento_cliente DATE;
  `);
  await pool.query(`
    ALTER TABLE os_modelos
    ADD COLUMN IF NOT EXISTS data_prevista_pagamento DATE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS modelos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      telefone TEXT NOT NULL,
      email TEXT NOT NULL,
      chave_pix TEXT NOT NULL,
      banco_dados TEXT NOT NULL DEFAULT '',
      emite_nf_propria BOOLEAN NOT NULL DEFAULT FALSE,
      observacoes TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS formas_pagamento JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS data_nascimento DATE;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS telefones JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS responsavel_nome TEXT;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS responsavel_cpf TEXT;
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS responsavel_telefone TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookers (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      telefone TEXT NOT NULL,
      email TEXT NOT NULL,
      chave_pix TEXT NOT NULL,
      observacoes TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS formas_pagamento JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS telefones JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceiros (
      id SERIAL PRIMARY KEY,
      razao_social_ou_nome TEXT NOT NULL,
      cnpj_ou_cpf TEXT NOT NULL UNIQUE,
      tipo_servico TEXT NOT NULL,
      contato TEXT NOT NULL,
      telefone TEXT NOT NULL,
      email TEXT NOT NULL,
      chave_pix TEXT NOT NULL,
      observacoes TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE parceiros
    ADD COLUMN IF NOT EXISTS formas_pagamento JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE parceiros
    ADD COLUMN IF NOT EXISTS telefones JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE parceiros
    ADD COLUMN IF NOT EXISTS emails JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orcamentos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      tipo_trabalho TEXT NOT NULL,
      descricao TEXT NOT NULL,
      cache_base_estimado_total NUMERIC(12, 2) NOT NULL,
      taxa_agencia_percent NUMERIC(5, 2) NOT NULL,
      extras_agencia_valor NUMERIC(12, 2) NOT NULL,
      condicoes_pagamento TEXT NOT NULL,
      uso_imagem TEXT NOT NULL,
      prazo TEXT NOT NULL,
      territorio TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'rascunho',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ordens_servico (
      id SERIAL PRIMARY KEY,
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id),
      cliente_id INTEGER NOT NULL REFERENCES clientes(id),
      descricao TEXT NOT NULL,
      tipo_os TEXT NOT NULL DEFAULT 'com_modelo',
      data_trabalho DATE,
      uso_imagem TEXT NOT NULL,
      total_cliente NUMERIC(12, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'aberta',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS tipo_trabalho TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS prazo TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS territorio TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS condicoes_pagamento TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS valor_servico NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS cache_modelo_total NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS agencia_fee_percent NUMERIC(5, 2) NOT NULL DEFAULT 20;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS taxa_agencia_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS extras_agencia_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS extras_despesa_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS extras_despesa_descricao TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS imposto_percent NUMERIC(5, 2) NOT NULL DEFAULT 10;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS imposto_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS modelo_liquido_total NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS agencia_parcial NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id);`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS parceiro_percent NUMERIC(5, 2);`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS parceiro_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS agencia_apos_parceiro NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS booker_id INTEGER REFERENCES bookers(id);`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS booker_percent NUMERIC(5, 2);`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS booker_valor NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS agencia_final NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS resultado_agencia NUMERIC(12, 2) NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS emitir_contrato BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_template_versao TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_gerado_em TIMESTAMP;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_enviado_em TIMESTAMP;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_assinado_em TIMESTAMP;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_status TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_observacao TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS os_modelos (
      id SERIAL PRIMARY KEY,
      os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      modelo_id INTEGER NOT NULL REFERENCES modelos(id),
      cache_modelo NUMERIC(12, 2) NOT NULL,
      emite_nf_propria BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS os_documentos (
      id SERIAL PRIMARY KEY,
      os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      nome_arquivo TEXT NOT NULL,
      mime TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      sha256 TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recebimentos (
      id SERIAL PRIMARY KEY,
      os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      valor NUMERIC(12, 2) NOT NULL,
      data_recebimento DATE NOT NULL,
      observacao TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pagamentos_modelo (
      id SERIAL PRIMARY KEY,
      os_modelo_id INTEGER NOT NULL REFERENCES os_modelos(id) ON DELETE CASCADE,
      valor NUMERIC(12, 2) NOT NULL,
      data_pagamento DATE NOT NULL,
      observacao TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
};

module.exports = {
  pool,
  initDb,
};
