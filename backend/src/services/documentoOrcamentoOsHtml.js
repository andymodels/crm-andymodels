/**
 * Documentos comerciais em HTML para impressão / "Salvar como PDF" no navegador.
 * Orçamento (PDF cliente): total ao cliente + texto comercial; detalhamento interno só no CRM.
 * O.S.: snapshot dos valores persistidos no job + linhas de modelo.
 */

const fs = require('fs');
const path = require('path');
const { computeOsFinancials } = require('./osFinanceiro');

const nNum = (v) => Number(v || 0);

/** Dados institucionais exibidos no rodapé do PDF do orçamento (cliente). */
const AGENCIA_RODAPE_ORCAMENTO = {
  nome: 'ANDY MODELS',
  endereco: 'Av. Nsra. da Penha, 386, Ibes, Vila Velha ES. CEP: 29108330.',
  telefones: '27 99237 9073',
};

/** Coloque a logo oficial em `backend/src/assets/logo-andy.png` (ou .svg). */
const LOGO_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'logo-andy.png'),
  path.join(__dirname, '..', 'assets', 'logo-andy.svg'),
  path.join(__dirname, '..', '..', 'public', 'logo-andy.png'),
  path.join(__dirname, '..', '..', 'public', 'logo-andy.svg'),
  path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'logo-andy.png'),
  path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'logo-andy.svg'),
  path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'favicon.svg'),
];

let logoDataUriMemo;

function getAndyLogoDataUri() {
  if (logoDataUriMemo !== undefined) return logoDataUriMemo;
  for (const filePath of LOGO_CANDIDATES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.svg') {
        logoDataUriMemo = `data:image/svg+xml;base64,${buf.toString('base64')}`;
        return logoDataUriMemo;
      }
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
        logoDataUriMemo = `data:${mime};base64,${buf.toString('base64')}`;
        return logoDataUriMemo;
      }
    } catch {
      /* next */
    }
  }
  logoDataUriMemo = null;
  return logoDataUriMemo;
}

function pickClienteDoc(row) {
  const d = row.documento != null && String(row.documento).trim() !== '' ? String(row.documento).trim() : '';
  const c = row.cnpj != null && String(row.cnpj).trim() !== '' ? String(row.cnpj).trim() : '';
  return d || c || '';
}

function formatClienteEndereco(row) {
  const ec = row.endereco_completo != null && String(row.endereco_completo).trim();
  if (ec) return String(row.endereco_completo).trim();
  const parts = [
    [row.logradouro, row.numero].filter(Boolean).join(', '),
    row.bairro,
    [row.cidade, row.uf].filter(Boolean).join('/'),
    row.cep ? `CEP ${row.cep}` : '',
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  return parts.join(' · ');
}

function formatClienteTelefones(row) {
  const raw = row.telefones;
  if (Array.isArray(raw) && raw.length) {
    const parts = raw
      .map((t) => (typeof t === 'string' ? t : t && (t.valor ?? t.telefone ?? '')))
      .filter((s) => s && String(s).trim());
    if (parts.length) return parts.join(' · ');
  }
  if (row.telefone != null && String(row.telefone).trim()) return String(row.telefone).trim();
  return '';
}

function formatClienteEmails(row) {
  const raw = row.emails;
  if (Array.isArray(raw) && raw.length) {
    const parts = raw
      .map((e) => (typeof e === 'string' ? e : e && (e.valor ?? e.email ?? '')))
      .filter((s) => s && String(s).trim());
    if (parts.length) return parts.join(' · ');
  }
  if (row.email != null && String(row.email).trim()) return String(row.email).trim();
  return '';
}

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

function fmtDateBR(d) {
  if (d == null || d === '') return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('pt-BR');
}

const STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 1.5rem auto; padding: 0 1rem; color: #0f172a; line-height: 1.5; font-size: 11pt; }
  .doc-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; padding-bottom: 0.85rem; border-bottom: 1px solid #e2e8f0; }
  .doc-header img.doc-logo { height: 52px; width: auto; max-width: 220px; object-fit: contain; flex-shrink: 0; }
  .doc-header .doc-header-text { flex: 1; min-width: 0; }
  .ref-bar { background: #0f172a; color: #fff; padding: 0.55rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.88rem; }
  h1 { font-size: 1.1rem; margin: 0 0 0.75rem; color: #1e293b; }
  .cliente-discreto { margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid #f1f5f9; font-size: 0.8rem; color: #64748b; line-height: 1.5; }
  .cliente-discreto .linha { margin: 0.2rem 0; }
  .cliente-discreto .rotulo { color: #94a3b8; font-weight: 500; margin-right: 0.35rem; }
  table.meta { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.95rem; }
  table.meta td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  table.meta td:first-child { width: 38%; color: #64748b; font-weight: 500; }
  .valor { text-align: right; font-variant-numeric: tabular-nums; }
  .totais { margin-top: 1rem; padding: 0.75rem 1rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .totais p { margin: 0.35rem 0; display: flex; justify-content: space-between; gap: 1rem; }
  .muted { color: #64748b; font-size: 0.85rem; margin-top: 1rem; }
  .rodape-agencia { margin-top: 1.75rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.82rem; color: #475569; line-height: 1.45; text-align: center; }
  .rodape-agencia-nome { margin: 0 0 0.35rem; font-weight: 700; font-size: 0.88rem; letter-spacing: 0.04em; color: #334155; }
  .rodape-agencia-linha { margin: 0.15rem 0; }
  .bloco { margin: 1rem 0; padding: 0.75rem 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
  .bloco h2 { font-size: 0.95rem; margin: 0 0 0.5rem; color: #334155; }
  .para-cliente { margin: 0 0 1rem; font-size: 1rem; color: #334155; }
  .valor-bruto-box { margin-top: 0; padding: 1rem 1.25rem; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center; }
  .valor-bruto-box .rotulo { font-size: 0.9rem; color: #64748b; margin: 0 0 0.35rem; font-weight: 600; }
  .valor-bruto-num { font-size: 1.65rem; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; margin: 0; }
  table.linhas { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.9rem; }
  table.linhas th, table.linhas td { padding: 0.4rem 0.5rem; border: 1px solid #e2e8f0; text-align: left; }
  table.linhas th { background: #f1f5f9; }
  @media print { body { margin: 0; } .ref-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .rodape-agencia { break-inside: avoid; } }
`;

async function loadOrcamentoDoc(pool, id) {
  const r = await pool.query(
    `
    SELECT
      o.*,
      c.nome_empresa,
      c.nome_fantasia,
      c.cnpj,
      c.documento,
      c.endereco_completo,
      c.telefone,
      c.telefones,
      c.email,
      c.emails,
      c.cep,
      c.logradouro,
      c.numero,
      c.bairro,
      c.cidade,
      c.uf
    FROM orcamentos o
    JOIN clientes c ON c.id = o.cliente_id
    WHERE o.id = $1
    `,
    [id],
  );
  if (r.rows.length === 0) return null;
  const o = r.rows[0];
  const mod = await pool.query(
    `
    SELECT
      om.cache_modelo,
      om.emite_nf_propria,
      COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'Modelo') AS modelo_nome
    FROM orcamento_modelos om
    LEFT JOIN modelos m ON m.id = om.modelo_id
    WHERE om.orcamento_id = $1
    ORDER BY om.id
    `,
    [id],
  );
  const tipo = o.tipo_proposta_os === 'sem_modelo' ? 'sem_modelo' : 'com_modelo';
  const linhasFin = mod.rows.map((row) => ({
    cache_modelo: row.cache_modelo,
    emite_nf_propria: row.emite_nf_propria,
  }));
  const impostoPctRaw = nNum(o.imposto_percent);
  const impostoUsado =
    Number.isFinite(impostoPctRaw) && impostoPctRaw >= 0 && impostoPctRaw <= 100 ? impostoPctRaw : 10;
  const nums = computeOsFinancials({
    tipo_os: tipo,
    valor_servico: tipo === 'sem_modelo' ? nNum(o.valor_servico_sem_modelo) : 0,
    cache_modelo_total:
      tipo === 'com_modelo' && linhasFin.length > 0
        ? linhasFin.reduce((s, l) => s + nNum(l.cache_modelo), 0)
        : nNum(o.cache_base_estimado_total),
    agencia_fee_percent: o.taxa_agencia_percent,
    extras_agencia_valor: o.extras_agencia_valor,
    extras_despesa_valor: 0,
    imposto_percent: impostoUsado,
    parceiro_percent: null,
    booker_percent: null,
    linhas: tipo === 'com_modelo' ? linhasFin : [],
  });
  return { orc: o, nums, linhasModelos: mod.rows };
}

/**
 * PDF para o cliente: dados do cliente, descrição, trabalho, condições, lista de modelos (só nomes), valor total.
 * Não discrimina: valor de extras agência, valor de nota fiscal nem taxa % — só o total ao cliente.
 */
function buildOrcamentoHtml(data) {
  const { orc, nums, linhasModelos = [] } = data;
  const logoUri = getAndyLogoDataUri();
  const clienteNome = esc(orc.nome_fantasia || orc.nome_empresa || '');
  const razao = esc(orc.nome_empresa || '');
  const docCliente = pickClienteDoc(orc);
  const cnpjLinha = esc(docCliente);
  const enderecoTxt = formatClienteEndereco(orc);
  const telTxt = formatClienteTelefones(orc);
  const emailTxt = formatClienteEmails(orc);
  const dataRef = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const horaLoc = esc(orc.horario_trabalho || '');
  const loc = esc(orc.local_trabalho || '');
  const dataTrab = fmtDateBR(orc.data_trabalho);
  const tipoPropLabel =
    orc.tipo_proposta_os === 'sem_modelo' ? 'Serviço sem modelo' : 'Com modelos';
  const qtdRef =
    orc.quantidade_modelos_referencia != null && orc.quantidade_modelos_referencia !== ''
      ? esc(String(orc.quantidade_modelos_referencia))
      : '—';

  const logoHtml = logoUri
    ? `<img class="doc-logo" src="${logoUri}" alt="Andy Models" />`
    : `<span class="doc-logo" style="font-size:1.15rem;font-weight:700;color:#0f172a;letter-spacing:0.02em;">Andy Models</span>`;

  const discretoLinhas = [];
  if (docCliente) {
    discretoLinhas.push(
      `<div class="linha"><span class="rotulo">CNPJ / Documento</span>${cnpjLinha}</div>`,
    );
  }
  if (enderecoTxt) {
    discretoLinhas.push(
      `<div class="linha"><span class="rotulo">Endereço</span>${esc(enderecoTxt)}</div>`,
    );
  }
  if (telTxt) {
    discretoLinhas.push(`<div class="linha"><span class="rotulo">Telefone</span>${esc(telTxt)}</div>`);
  }
  if (emailTxt) {
    discretoLinhas.push(`<div class="linha"><span class="rotulo">Email</span>${esc(emailTxt)}</div>`);
  }
  const clienteDiscretoHtml =
    discretoLinhas.length > 0
      ? `<div class="cliente-discreto">${discretoLinhas.join('')}</div>`
      : '';

  const linhasModelosRows =
    linhasModelos.length === 0
      ? '<tr><td><em>Nenhum modelo do cadastro neste orçamento.</em></td></tr>'
      : linhasModelos.map((l) => `<tr><td>${esc(l.modelo_nome)}</td></tr>`).join('');

  const blocoModelosOuServico =
    orc.tipo_proposta_os === 'sem_modelo'
      ? `<div class="bloco">
    <h2>Valor do serviço (referência)</h2>
    <p style="margin:0;">${fmtMoneyBR(orc.valor_servico_sem_modelo)} <span class="muted">(base sem modelo)</span></p>
  </div>`
      : `<div class="bloco">
    <h2>Quantidade de modelos (referência)</h2>
    <p style="margin:0;">${qtdRef}</p>
  </div>
  <div class="bloco">
    <h2>Modelos</h2>
    <table class="linhas">
      <thead><tr><th>Modelo</th></tr></thead>
      <tbody>${linhasModelosRows}</tbody>
    </table>
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orçamento nº ${esc(String(orc.id))}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header class="doc-header">
    ${logoHtml}
    <div class="doc-header-text">
      <div class="ref-bar" style="margin-bottom:0;">
        <strong>ANDY MODELS</strong> · Orçamento nº ${esc(String(orc.id))} · Emitido em ${esc(dataRef)}
      </div>
    </div>
  </header>
  <h1>Orçamento</h1>

  <div class="bloco">
    <h2>Cliente</h2>
    <table class="meta">
      <tr><td>Nome / fantasia</td><td>${clienteNome}${razao && razao !== clienteNome ? ` <span class="muted">(${razao})</span>` : ''}</td></tr>
    </table>
    ${clienteDiscretoHtml}
  </div>

  <div class="bloco">
    <h2>Descrição do trabalho</h2>
    <p style="margin:0; white-space: pre-wrap;">${esc(orc.descricao || '—')}</p>
  </div>

  <div class="bloco">
    <h2>Trabalho</h2>
    <table class="meta">
      <tr><td>Tipo de trabalho</td><td>${esc(orc.tipo_trabalho || '—')}</td></tr>
      <tr><td>Proposta</td><td>${esc(tipoPropLabel)}</td></tr>
      <tr><td>Data do trabalho</td><td>${esc(dataTrab)}</td></tr>
      <tr><td>Horário</td><td>${horaLoc || '—'}</td></tr>
      <tr><td>Local</td><td>${loc || '—'}</td></tr>
      <tr><td>Uso de imagem</td><td>${esc(orc.uso_imagem || '—')}</td></tr>
      <tr><td>Prazo</td><td>${esc(orc.prazo || '—')}</td></tr>
      <tr><td>Território</td><td>${esc(orc.territorio || '—')}</td></tr>
    </table>
  </div>

  ${blocoModelosOuServico}

  <div class="bloco">
    <h2>Condições de pagamento</h2>
    <p style="margin:0; white-space: pre-wrap;">${esc(orc.condicoes_pagamento || '—')}</p>
  </div>

  <div class="bloco">
    <h2>Valor total da proposta</h2>
    <p style="margin:0 0 0.75rem; font-size:0.95rem;">
      Valor total incluindo serviços da agência e cachê dos modelos.
    </p>
    <div class="valor-bruto-box">
      <p class="rotulo">Total ao cliente</p>
      <p class="valor-bruto-num">${fmtMoneyBR(nums.total_cliente)}</p>
    </div>
  </div>

  <footer class="rodape-agencia">
    <p class="rodape-agencia-nome">${esc(AGENCIA_RODAPE_ORCAMENTO.nome)}</p>
    <p class="rodape-agencia-linha">${esc(AGENCIA_RODAPE_ORCAMENTO.endereco)}</p>
    <p class="rodape-agencia-linha">${esc(AGENCIA_RODAPE_ORCAMENTO.telefones)}</p>
  </footer>

  <p class="muted">Proposta para impressão ou PDF pelo navegador.</p>
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
    SELECT
      om.cache_modelo,
      om.emite_nf_propria,
      COALESCE(NULLIF(TRIM(m.nome), ''), NULLIF(TRIM(om.rotulo), ''), 'Modelo') AS modelo_nome
    FROM os_modelos om
    LEFT JOIN modelos m ON m.id = om.modelo_id
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
