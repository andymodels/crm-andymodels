/**
 * Documentos comerciais em HTML para impressão / "Salvar como PDF" no navegador.
 * Orçamento: proposta com totais alinhados à lógica de aprovação (cachê + taxa + extras).
 * O.S.: snapshot dos valores persistidos no job + linhas de modelo.
 */

const { computeOsFinancials } = require('./osFinanceiro');

function esc(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoneyBR(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 1.5rem auto; padding: 0 1rem; color: #0f172a; line-height: 1.5; font-size: 11pt; }
  .ref-bar { background: #0f172a; color: #fff; padding: 0.55rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.88rem; }
  h1 { font-size: 1.1rem; margin: 0 0 0.75rem; color: #1e293b; }
  table.meta { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.95rem; }
  table.meta td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  table.meta td:first-child { width: 38%; color: #64748b; font-weight: 500; }
  .valor { text-align: right; font-variant-numeric: tabular-nums; }
  .totais { margin-top: 1rem; padding: 0.75rem 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .totais p { margin: 0.35rem 0; display: flex; justify-content: space-between; gap: 1rem; }
  .muted { color: #64748b; font-size: 0.85rem; margin-top: 1rem; }
  table.linhas { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.9rem; }
  table.linhas th, table.linhas td { padding: 0.4rem 0.5rem; border: 1px solid #e2e8f0; text-align: left; }
  table.linhas th { background: #f1f5f9; }
  @media print { body { margin: 0; } .ref-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

async function loadOrcamentoDoc(pool, id) {
  const r = await pool.query(
    `
    SELECT o.*, c.nome_empresa, c.nome_fantasia, c.cnpj
    FROM orcamentos o
    JOIN clientes c ON c.id = o.cliente_id
    WHERE o.id = $1
    `,
    [id],
  );
  if (r.rows.length === 0) return null;
  const o = r.rows[0];
  const impostoPadrao = 10;
  const nums = computeOsFinancials({
    tipo_os: 'com_modelo',
    valor_servico: 0,
    cache_modelo_total: o.cache_base_estimado_total,
    agencia_fee_percent: o.taxa_agencia_percent,
    extras_agencia_valor: o.extras_agencia_valor,
    extras_despesa_valor: 0,
    imposto_percent: impostoPadrao,
    parceiro_percent: null,
    booker_percent: null,
    linhas: [],
  });
  return { orc: o, nums, impostoPadrao };
}

function buildOrcamentoHtml(data) {
  const { orc, nums, impostoPadrao } = data;
  const clienteNome = esc(orc.nome_fantasia || orc.nome_empresa || '');
  const razao = esc(orc.nome_empresa || '');
  const cnpj = esc(orc.cnpj || '');
  const dataRef = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orçamento nº ${esc(String(orc.id))}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="ref-bar">
    <strong>ANDY MODELS</strong> · Orçamento comercial nº ${esc(String(orc.id))} · ${esc(dataRef)}
  </div>
  <h1>Proposta comercial</h1>
  <table class="meta">
    <tr><td>Status</td><td>${esc(orc.status || '—')}</td></tr>
    <tr><td>Cliente</td><td>${clienteNome}${razao && razao !== clienteNome ? ` <span class="muted">(${razao})</span>` : ''}</td></tr>
    <tr><td>CNPJ</td><td>${cnpj || '—'}</td></tr>
    <tr><td>Tipo de trabalho</td><td>${esc(orc.tipo_trabalho || '—')}</td></tr>
    <tr><td>Descrição</td><td>${esc(orc.descricao || '—')}</td></tr>
    <tr><td>Uso de imagem</td><td>${esc(orc.uso_imagem || '—')}</td></tr>
    <tr><td>Prazo</td><td>${esc(orc.prazo || '—')}</td></tr>
    <tr><td>Território</td><td>${esc(orc.territorio || '—')}</td></tr>
    <tr><td>Condições de pagamento</td><td>${esc(orc.condicoes_pagamento || '—')}</td></tr>
  </table>
  <p class="muted">Estimativa na aprovação: cachê base total <strong>${fmtMoneyBR(orc.cache_base_estimado_total)}</strong>,
    taxa agência <strong>${esc(String(orc.taxa_agencia_percent))}%</strong> sobre o cachê,
    extras agência <strong>${fmtMoneyBR(orc.extras_agencia_valor)}</strong>,
    imposto estimado <strong>${impostoPadrao}%</strong> sobre o total ao cliente (como na geração da O.S.).</p>
  <div class="totais">
    <p><span>Cachê modelos (base)</span><span class="valor">${fmtMoneyBR(nums.cache_modelo_total)}</span></p>
    <p><span>Taxa agência (valor)</span><span class="valor">${fmtMoneyBR(nums.taxa_agencia_valor)}</span></p>
    <p><span>Extras agência</span><span class="valor">${fmtMoneyBR(orc.extras_agencia_valor)}</span></p>
    <p><strong>Total ao cliente (estimado)</strong><strong class="valor">${fmtMoneyBR(nums.total_cliente)}</strong></p>
    <p><span>Imposto (estim. ${impostoPadrao}%)</span><span class="valor">${fmtMoneyBR(nums.imposto_valor)}</span></p>
    <p><span>Líquido modelos (estim.)</span><span class="valor">${fmtMoneyBR(nums.modelo_liquido_total)}</span></p>
    <p><span>Resultado agência (estim.)</span><span class="valor">${fmtMoneyBR(nums.resultado_agencia)}</span></p>
  </div>
  <p class="muted">Documento para conferência. Valores finais seguem a O.S. após aprovação e ajustes no job.</p>
</body>
</html>`;
}

async function buildOrcamentoDocumentHtml(pool, id) {
  const data = await loadOrcamentoDoc(pool, id);
  if (!data) return null;
  return buildOrcamentoHtml(data);
}

async function loadOsDoc(pool, id) {
  const os = await pool.query(
    `
    SELECT
      os.*,
      c.nome_empresa,
      c.nome_fantasia,
      c.cnpj,
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
    [id],
  );
  if (os.rows.length === 0) return null;
  const row = os.rows[0];
  const linhas = await pool.query(
    `
    SELECT om.cache_modelo, om.emite_nf_propria, m.nome AS modelo_nome
    FROM os_modelos om
    JOIN modelos m ON m.id = om.modelo_id
    WHERE om.os_id = $1
    ORDER BY om.id
    `,
    [id],
  );
  return { os: row, linhas: linhas.rows };
}

function buildOsHtml({ os, linhas }) {
  const clienteNome = esc(os.nome_fantasia || os.nome_empresa || '');
  const dataRef = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const tipo = esc(os.tipo_os || '—');
  const linhasRows =
    linhas.length === 0
      ? '<tr><td colspan="4"><em>Nenhuma linha de modelo — valores usam cachê total ou serviço sem modelo.</em></td></tr>'
      : linhas
          .map(
            (l, i) => `<tr>
    <td>${i + 1}</td>
    <td>${esc(l.modelo_nome)}</td>
    <td class="valor">${fmtMoneyBR(l.cache_modelo)}</td>
    <td>${l.emite_nf_propria ? 'Sim' : 'Não'}</td>
  </tr>`,
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>O.S. nº ${esc(String(os.id))}</title>
  <style>${STYLE}</style>
</head>
<body>
  <div class="ref-bar">
    <strong>ANDY MODELS</strong> · Ordem de serviço nº ${esc(String(os.id))}
    · Orçamento origem nº ${esc(String(os.orcamento_numero))} · ${esc(dataRef)}
  </div>
  <h1>Ordem de serviço (job)</h1>
  <table class="meta">
    <tr><td>Cliente</td><td>${clienteNome}</td></tr>
    <tr><td>CNPJ</td><td>${esc(os.cnpj || '—')}</td></tr>
    <tr><td>Status</td><td>${esc(os.status || '—')}</td></tr>
    <tr><td>Tipo de O.S.</td><td>${tipo}</td></tr>
    <tr><td>Descrição</td><td>${esc(os.descricao || '—')}</td></tr>
    <tr><td>Tipo de trabalho</td><td>${esc(os.tipo_trabalho || '—')}</td></tr>
    <tr><td>Uso de imagem</td><td>${esc(os.uso_imagem || '—')}</td></tr>
    <tr><td>Prazo</td><td>${esc(os.prazo || '—')}</td></tr>
    <tr><td>Território</td><td>${esc(os.territorio || '—')}</td></tr>
    <tr><td>Condições de pagamento</td><td>${esc(os.condicoes_pagamento || '—')}</td></tr>
    <tr><td>Data do trabalho</td><td>${os.data_trabalho ? esc(String(os.data_trabalho).slice(0, 10)) : '—'}</td></tr>
    <tr><td>Vencimento (cliente)</td><td>${os.data_vencimento_cliente ? esc(String(os.data_vencimento_cliente).slice(0, 10)) : '—'}</td></tr>
    <tr><td>Extras agência (R$)</td><td>${fmtMoneyBR(os.extras_agencia_valor)}</td></tr>
    <tr><td>Extras despesa (R$)</td><td>${fmtMoneyBR(os.extras_despesa_valor)}${os.extras_despesa_descricao ? ` — ${esc(os.extras_despesa_descricao)}` : ''}</td></tr>
    <tr><td>Parceiro</td><td>${esc(os.parceiro_nome || '—')}${os.parceiro_percent != null ? ` · ${esc(String(os.parceiro_percent))}%` : ''}</td></tr>
    <tr><td>Booker</td><td>${esc(os.booker_nome || '—')}${os.booker_percent != null ? ` · ${esc(String(os.booker_percent))}%` : ''}</td></tr>
  </table>
  <h1 style="font-size:1rem;margin-top:1.25rem;">Linhas de modelo</h1>
  <table class="linhas">
    <thead><tr><th>#</th><th>Modelo</th><th>Cachê</th><th>NF própria</th></tr></thead>
    <tbody>${linhasRows}</tbody>
  </table>
  <div class="totais">
    <p><span>Total ao cliente</span><span class="valor">${fmtMoneyBR(os.total_cliente)}</span></p>
    <p><span>Imposto (${esc(String(os.imposto_percent))}%)</span><span class="valor">${fmtMoneyBR(os.imposto_valor)}</span></p>
    <p><span>Líquido modelos</span><span class="valor">${fmtMoneyBR(os.modelo_liquido_total)}</span></p>
    <p><span>Parceiro</span><span class="valor">${fmtMoneyBR(os.parceiro_valor)}</span></p>
    <p><span>Booker</span><span class="valor">${fmtMoneyBR(os.booker_valor)}</span></p>
    <p><strong>Resultado agência</strong><strong class="valor">${fmtMoneyBR(os.resultado_agencia)}</strong></p>
    ${os.tipo_os === 'sem_modelo' ? `<p><span>Valor serviço (sem modelo)</span><span class="valor">${fmtMoneyBR(os.valor_servico)}</span></p>` : `<p><span>Cachê modelo total (ref.)</span><span class="valor">${fmtMoneyBR(os.cache_modelo_total)}</span></p>`}
    <p><span>Taxa agência (valor)</span><span class="valor">${fmtMoneyBR(os.taxa_agencia_valor)}</span></p>
    <p><span>Extras agência</span><span class="valor">${fmtMoneyBR(os.extras_agencia_valor)}</span></p>
  </div>
  <p class="muted">Valores conforme gravados na O.S. Use Imprimir → Salvar como PDF no navegador.</p>
</body>
</html>`;
}

async function buildOsDocumentHtml(pool, id) {
  const data = await loadOsDoc(pool, id);
  if (!data) return null;
  return buildOsHtml(data);
}

module.exports = {
  buildOrcamentoDocumentHtml,
  buildOsDocumentHtml,
};
