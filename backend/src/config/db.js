const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const connectionString = process.env.DATABASE_URL;

/** Sem DATABASE_URL o processo sobe na mesma; rotas de dados respondem 503 (ver app.js). */
let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 12_000,
  });
}

const initDb = async () => {
  if (!pool) {
    console.warn('[initDb] DATABASE_URL ausente — migrações não executadas.');
    return;
  }
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
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS instagram TEXT NOT NULL DEFAULT '';
  `);

  try {
    await pool.query(`
      UPDATE clientes SET documento = cnpj
      WHERE documento IS NULL OR btrim(documento) = '';
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS clientes_documento_unique ON clientes (documento);
    `);
  } catch (e) {
    console.warn('[initDb] indice unico em clientes.documento:', e.message);
  }

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
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS origem_cadastro TEXT NOT NULL DEFAULT 'interno';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS status_cadastro TEXT NOT NULL DEFAULT 'aprovado';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS sexo TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_altura TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_busto TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_torax TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_cintura TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_quadril TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_sapato TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_cabelo TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS medida_olhos TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS passaporte TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS foto_perfil_base64 TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS rg TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS instagram TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS tiktok TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS cep TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS logradouro TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS numero TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS complemento TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS bairro TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS cidade TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS uf TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE modelos
    ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT NOT NULL DEFAULT 'PF';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cadastro_links (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      usado_em TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'ativo',
      tipo TEXT NOT NULL DEFAULT 'modelo',
      modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL
    );
  `);
  await pool.query(`
    ALTER TABLE cadastro_links
    ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'modelo';
  `);
  await pool.query(`
    ALTER TABLE cadastro_links
    ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    UPDATE cadastro_links SET tipo = 'modelo' WHERE tipo IS NULL OR TRIM(tipo) = '';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cadastro_links_token ON cadastro_links (token);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cadastro_links_tipo_status ON cadastro_links (tipo, status);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cadastro_publico_historico (
      id SERIAL PRIMARY KEY,
      entidade TEXT NOT NULL,
      entidade_id INTEGER NOT NULL,
      acao TEXT NOT NULL,
      detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modelo_acessos (
      id SERIAL PRIMARY KEY,
      modelo_id INTEGER NOT NULL UNIQUE REFERENCES modelos(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@andymodels.com').trim().toLowerCase();
  const adminNome = String(process.env.ADMIN_NOME || 'Administrador').trim() || 'Administrador';
  let adminSenha = String(process.env.ADMIN_PASSWORD || '').trim();
  const resetOnStart = String(process.env.ADMIN_RESET_ON_START || '').trim().toLowerCase() === 'true';
  const usersCount = await pool.query('SELECT COUNT(*)::int AS c FROM usuarios');
  if ((usersCount.rows[0]?.c || 0) === 0) {
    if (!adminSenha || adminSenha.length < 12 || adminSenha === 'Admin@123') {
      adminSenha = crypto.randomBytes(24).toString('base64url');
      console.warn(
        `[initDb] ADMIN_PASSWORD ausente/fraca. Senha inicial aleatoria gerada para ${adminEmail}: ${adminSenha}`,
      );
      console.warn('[initDb] Altere a senha imediatamente apos o primeiro login.');
    }
    const senhaHash = await bcrypt.hash(adminSenha, 12);
    await pool.query(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, 'admin')",
      [adminNome, adminEmail, senhaHash],
    );
    console.warn('[initDb] usuario admin inicial criado. Altere a senha apos o primeiro login.');
  } else if (resetOnStart && adminSenha && adminSenha.length >= 8) {
    const senhaHash = await bcrypt.hash(adminSenha, 12);
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email)
       DO UPDATE SET
         nome = EXCLUDED.nome,
         senha_hash = EXCLUDED.senha_hash,
         tipo = 'admin',
         updated_at = NOW()`,
      [adminNome, adminEmail, senhaHash],
    );
    console.warn(
      `[initDb] admin ${adminEmail} sincronizado por ADMIN_RESET_ON_START=true (usuario criado/atualizado).`,
    );
  }

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
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT NOT NULL DEFAULT 'PF';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS cep TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS logradouro TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS numero TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS complemento TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS bairro TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS cidade TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE bookers
    ADD COLUMN IF NOT EXISTS uf TEXT NOT NULL DEFAULT '';
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
    ALTER TABLE parceiros
    ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT NOT NULL DEFAULT 'PF';
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
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS data_trabalho DATE;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS horario_trabalho TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS local_trabalho TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS data_vencimento DATE;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS tipo_proposta_os TEXT NOT NULL DEFAULT 'com_modelo';
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS valor_servico_sem_modelo NUMERIC(12, 2) NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS os_id_gerada INTEGER;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS modelos_definicao TEXT NOT NULL DEFAULT 'cadastrados';
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS quantidade_modelos_referencia INTEGER;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS valor_nota_fiscal NUMERIC(12, 2) NOT NULL DEFAULT 0;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS imposto_percent NUMERIC(5, 2) NOT NULL DEFAULT 10;
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS parceiro_id INTEGER REFERENCES parceiros(id);
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS parceiro_percent NUMERIC(5, 2);
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS booker_id INTEGER REFERENCES bookers(id);
  `);
  await pool.query(`
    ALTER TABLE orcamentos
    ADD COLUMN IF NOT EXISTS booker_percent NUMERIC(5, 2);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orcamento_modelos (
      id SERIAL PRIMARY KEY,
      orcamento_id INTEGER NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
      modelo_id INTEGER NOT NULL REFERENCES modelos(id),
      cache_modelo NUMERIC(12, 2) NOT NULL,
      emite_nf_propria BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_orcamento_modelos_orcamento ON orcamento_modelos(orcamento_id);
  `);
  await pool.query(`
    ALTER TABLE orcamento_modelos
    ADD COLUMN IF NOT EXISTS rotulo TEXT NOT NULL DEFAULT '';
  `);
  try {
    await pool.query(`ALTER TABLE orcamento_modelos ALTER COLUMN modelo_id DROP NOT NULL;`);
  } catch (e) {
    console.warn('[initDb] orcamento_modelos.modelo_id nullable:', e.message);
  }

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
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_assinatura_token TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_assinado_nome TEXT;`);
  await pool.query(`ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS contrato_assinado_documento TEXT;`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ordens_servico_contrato_assinatura_token ON ordens_servico(contrato_assinatura_token) WHERE contrato_assinatura_token IS NOT NULL`,
  );
  await pool.query(`
    ALTER TABLE ordens_servico
    ADD COLUMN IF NOT EXISTS data_vencimento_cliente DATE;
  `);

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
    ALTER TABLE os_modelos
    ADD COLUMN IF NOT EXISTS data_prevista_pagamento DATE;
  `);
  await pool.query(`
    ALTER TABLE os_modelos
    ADD COLUMN IF NOT EXISTS rotulo TEXT NOT NULL DEFAULT '';
  `);
  try {
    await pool.query(`ALTER TABLE os_modelos ALTER COLUMN modelo_id DROP NOT NULL;`);
  } catch (e) {
    console.warn('[initDb] os_modelos.modelo_id nullable:', e.message);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS os_historico (
      id SERIAL PRIMARY KEY,
      os_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      usuario TEXT NOT NULL,
      campo TEXT NOT NULL,
      valor_anterior TEXT,
      valor_novo TEXT
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_os_historico_os ON os_historico(os_id);
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_os_documentos_contrato_pdf_unico
    ON os_documentos (os_id, tipo)
    WHERE tipo = 'contrato_pdf_gerado';
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS despesas (
      id SERIAL PRIMARY KEY,
      data_despesa DATE NOT NULL,
      descricao TEXT NOT NULL,
      valor NUMERIC(12, 2) NOT NULL,
      categoria TEXT NOT NULL,
      os_id INTEGER REFERENCES ordens_servico(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT despesas_categoria_chk CHECK (
        categoria IN ('impostos', 'operacional', 'outros')
      ),
      CONSTRAINT despesas_valor_chk CHECK (valor > 0)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_despesas_data ON despesas (data_despesa DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_despesas_os ON despesas (os_id);
  `);

  try {
    await pool.query(`
      UPDATE despesas SET categoria = 'outros'
      WHERE categoria IN ('caches', 'comissoes');
    `);
    await pool.query(`ALTER TABLE despesas DROP CONSTRAINT IF EXISTS despesas_categoria_chk`);
    await pool.query(`
      ALTER TABLE despesas ADD CONSTRAINT despesas_categoria_chk CHECK (
        categoria IN ('impostos', 'operacional', 'outros')
      );
    `);
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) {
      console.warn('[initDb] despesas categoria constraint:', e.message);
    }
  }

  try {
    await pool.query(`
      ALTER TABLE orcamentos
      ADD CONSTRAINT orcamentos_os_id_gerada_fkey
      FOREIGN KEY (os_id_gerada) REFERENCES ordens_servico(id) ON DELETE SET NULL;
    `);
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) {
      console.warn('[initDb] FK orcamentos.os_id_gerada:', e.message);
    }
  }
};

module.exports = {
  pool,
  initDb,
  isDbReady: () => Boolean(pool),
};
