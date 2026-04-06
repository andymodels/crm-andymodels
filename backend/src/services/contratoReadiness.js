/**
 * Garante dados mínimos para gerar o contrato (sem validação avançada de formato).
 */

const t = (v) => String(v ?? '').trim();

function errosCamposOs(os) {
  const erros = [];
  if (!t(os.uso_imagem)) erros.push('uso de imagem');
  if (!t(os.prazo)) erros.push('prazo');
  if (!t(os.territorio)) erros.push('território');
  if (!t(os.condicoes_pagamento)) erros.push('condições de pagamento');
  return erros;
}

function errosClienteContrato(c) {
  if (!c) return ['cadastro do cliente não encontrado'];
  const erros = [];
  if (!t(c.cnpj)) erros.push('CNPJ do cliente');
  if (!t(c.documento)) erros.push('documento da empresa (CPF ou CNPJ conforme tipo)');
  if (!t(c.contato_principal)) erros.push('nome do representante legal (contato principal)');
  if (!t(c.endereco_completo)) erros.push('endereço completo');
  return erros;
}

/**
 * @returns {Promise<string[]>} lista de mensagens (vazia = ok)
 */
async function validarContratoPronto(pool, osId, osCampos, tipoOs) {
  const erros = [];
  erros.push(...errosCamposOs(osCampos));

  const { rows: [osRow] } = await pool.query('SELECT cliente_id FROM ordens_servico WHERE id = $1', [osId]);
  if (!osRow) return ['O.S. não encontrada'];

  const { rows: [cli] } = await pool.query(
    `
    SELECT cnpj, documento, contato_principal, documento_representante, inscricao_estadual, endereco_completo
    FROM clientes WHERE id = $1
    `,
    [osRow.cliente_id],
  );
  erros.push(...errosClienteContrato(cli));

  if (tipoOs === 'com_modelo') {
    const mod = await pool.query(
      `
      SELECT om.modelo_id, om.rotulo, m.nome, m.cpf
      FROM os_modelos om
      LEFT JOIN modelos m ON m.id = om.modelo_id
      WHERE om.os_id = $1
      ORDER BY om.id
      `,
      [osId],
    );
    if (mod.rows.length === 0) {
      erros.push(
        'O.S. tipo “com modelo”: é obrigatório ter pelo menos uma linha de modelo vinculada (não basta apenas cachê total sem linhas).',
      );
    }
    for (const row of mod.rows) {
      const rot = t(row.nome) || t(row.rotulo) || 'Modelo';
      if (row.modelo_id == null) {
        erros.push(
          `Contrato: a linha "${rot}" ainda não está vinculada a um modelo do cadastro — associe o cadastro na O.S. antes de gerar o contrato.`,
        );
        continue;
      }
      if (!t(row.cpf)) erros.push(`CPF do modelo "${rot}" no cadastro`);
    }
  }

  return erros;
}

module.exports = {
  validarContratoPronto,
  errosCamposOs,
  errosClienteContrato,
};
