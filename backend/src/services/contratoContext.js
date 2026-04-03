/**
 * Carrega tudo o que o contrato precisa: O.S., cliente, orçamento, linhas de modelo, nomes de booker/parceiro.
 * Nenhum dado digitado no momento da geração — só leitura do banco.
 */
async function loadContratoContext(pool, osId) {
  const os = await pool.query(
    `
    SELECT
      os.*,
      c.nome_empresa,
      c.nome_fantasia,
      c.cnpj,
      c.documento,
      c.documento_representante,
      c.inscricao_estadual,
      c.endereco_completo,
      c.contato_principal,
      c.telefone,
      c.email AS cliente_email,
      o.id AS orcamento_numero,
      bk.nome AS booker_nome,
      p.razao_social_ou_nome AS parceiro_nome
    FROM ordens_servico os
    JOIN clientes c ON c.id = os.cliente_id
    JOIN orcamentos o ON o.id = os.orcamento_id
    LEFT JOIN bookers bk ON bk.id = os.booker_id
    LEFT JOIN parceiros p ON p.id = os.parceiro_id
    WHERE os.id = $1
    `,
    [osId],
  );
  if (os.rows.length === 0) return null;

  const row = os.rows[0];

  const linhasR = await pool.query(
    `
    SELECT m.nome AS modelo_nome, m.cpf AS modelo_cpf
    FROM os_modelos om
    JOIN modelos m ON m.id = om.modelo_id
    WHERE om.os_id = $1
    ORDER BY om.id
    `,
    [osId],
  );

  const linhas = linhasR.rows.map((l) => ({
    modelo_nome: l.modelo_nome,
    modelo_cpf: l.modelo_cpf,
  }));

  const cliente = {
    nome_empresa: row.nome_empresa,
    nome_fantasia: row.nome_fantasia,
    cnpj: row.cnpj,
    documento: row.documento,
    documento_representante: row.documento_representante,
    inscricao_estadual: row.inscricao_estadual,
    endereco_completo: row.endereco_completo,
    contato_principal: row.contato_principal,
    telefone: row.telefone,
    email: row.cliente_email,
  };

  return {
    os: row,
    cliente,
    linhas,
    orcamentoNumero: row.orcamento_numero,
    bookerNome: row.booker_nome || null,
    parceiroNome: row.parceiro_nome || null,
  };
}

module.exports = {
  loadContratoContext,
};
