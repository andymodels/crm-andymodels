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
  const s = String(d).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('pt-BR');
}

/** Impressão/PDF do orçamento ao cliente: A4, limpo, sem detalhe interno de comissões. */
const STYLE_ORCAMENTO_CLIENTE = `
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, system-ui, -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #0f172a;
    -webkit-font-smoothing: antialiased;
  }
  .doc-shell { max-width: 100%; }
  .doc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 12px;
    border-bottom: 2px solid #e2e8f0;
    margin-bottom: 18px;
  }
  .doc-header .brand { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
  .doc-header img.doc-logo { height: 48px; width: auto; max-width: 200px; object-fit: contain; flex-shrink: 0; }
  .doc-header .brand-text { font-size: 1.05rem; font-weight: 800; letter-spacing: 0.04em; color: #0f172a; }
  .doc-header .title-block { text-align: right; flex: 1; min-width: 0; }
  .doc-header .title-block h1 { margin: 0; font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em; color: #0f172a; }
  .doc-header .title-block .sub { margin-top: 4px; font-size: 9pt; color: #64748b; }
  .section { margin-bottom: 18px; page-break-inside: avoid; }
  .section h2 {
    margin: 0 0 8px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 5px;
  }
  .section .body { font-size: 10.5pt; color: #1e293b; }
  .section .body p { margin: 0 0 10px; white-space: pre-wrap; }
  .section .body p:last-child { margin-bottom: 0; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 9.5pt; color: #475569; }
  .meta-grid .k { color: #94a3b8; font-weight: 600; }
  .cliente-nome { font-size: 11pt; font-weight: 600; color: #0f172a; margin-bottom: 6px; }
  .cliente-extras { font-size: 9pt; color: #64748b; line-height: 1.5; }
  .cliente-extras .linha { margin: 2px 0; }
  ul.modelos-nomes { margin: 6px 0 0; padding-left: 1.15rem; }
  ul.modelos-nomes li { margin: 4px 0; }
  .muted-mini { margin: 0; font-size: 9.5pt; color: #64748b; font-style: italic; }
  .condicoes { font-size: 10pt; color: #334155; white-space: pre-wrap; margin: 0; }
  .valor-total-wrap {
    margin-top: 6px;
    padding: 16px 18px;
    background: #fafafa;
    border: 1px solid #e4e4e7;
    border-radius: 8px;
    text-align: center;
  }
  .valor-total-wrap .rotulo {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #52525b;
    margin-bottom: 8px;
  }
  .valor-total-wrap .num {
    font-size: 1.85rem;
    font-weight: 700;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
    margin: 0;
    line-height: 1.2;
  }
  .valor-total-wrap .nota-legal {
    margin-top: 10px;
    font-size: 8.5pt;
    color: #71717a;
    line-height: 1.4;
    max-width: 42rem;
    margin-left: auto;
    margin-right: auto;
  }
  .rodape-agencia {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid #e2e8f0;
    font-size: 8.5pt;
    color: #64748b;
    line-height: 1.45;
    text-align: center;
  }
  .rodape-agencia-nome { margin: 0 0 4px; font-weight: 700; font-size: 9pt; letter-spacing: 0.06em; color: #475569; }
  .rodape-agencia-linha { margin: 2px 0; }
  .print-hint { margin-top: 14px; font-size: 8pt; color: #94a3b8; text-align: center; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section { break-inside: avoid; }
    .rodape-agencia { break-inside: avoid; }
  }
`;

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
 * PDF para o cliente: A4, marca no topo, seções enxutas — cliente, descrição, modelos (só nomes), valor total.
 * Sem detalhamento interno (comissões, taxas, divisão de cachê).
 */
function buildOrcamentoHtml(data) {
  const { orc, nums, linhasModelos = [] } = data;
  const logoUri = getAndyLogoDataUri();
  const clienteNome = esc(orc.nome_fantasia || orc.nome_empresa || '');
  const razao = esc(orc.nome_empresa || '');
  const docCliente = pickClienteDoc(orc);
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

  const logoHtml = logoUri
    ? `<img class="doc-logo" src="${logoUri}" alt="${esc(AGENCIA_RODAPE_ORCAMENTO.nome)}" />`
    : '';

  const discretoLinhas = [];
  if (docCliente) discretoLinhas.push(`<div class="linha"><strong>Doc.</strong> ${esc(docCliente)}</div>`);
  if (enderecoTxt) discretoLinhas.push(`<div class="linha">${esc(enderecoTxt)}</div>`);
  if (telTxt) discretoLinhas.push(`<div class="linha"><strong>Tel.</strong> ${esc(telTxt)}</div>`);
  if (emailTxt) discretoLinhas.push(`<div class="linha"><strong>Email</strong> ${esc(emailTxt)}</div>`);
  const clienteExtrasHtml =
    discretoLinhas.length > 0 ? `<div class="cliente-extras">${discretoLinhas.join('')}</div>` : '';

  const metaLinhas = [];
  if (orc.tipo_trabalho && String(orc.tipo_trabalho).trim()) {
    metaLinhas.push(
      `<div><span class="k">Tipo</span> ${esc(String(orc.tipo_trabalho).trim())}</div>`,
    );
  }
  if (dataTrab !== '—') metaLinhas.push(`<div><span class="k">Data</span> ${esc(dataTrab)}</div>`);
  if (horaLoc) metaLinhas.push(`<div><span class="k">Horário</span> ${horaLoc}</div>`);
  if (loc) metaLinhas.push(`<div><span class="k">Local</span> ${loc}</div>`);
  const uso = orc.uso_imagem != null && String(orc.uso_imagem).trim();
  const prazo = orc.prazo != null && String(orc.prazo).trim();
  const terr = orc.territorio != null && String(orc.territorio).trim();
  if (uso) metaLinhas.push(`<div><span class="k">Uso de imagem</span> ${esc(uso)}</div>`);
  if (prazo) metaLinhas.push(`<div><span class="k">Prazo</span> ${esc(prazo)}</div>`);
  if (terr) metaLinhas.push(`<div><span class="k">Território</span> ${esc(terr)}</div>`);
  const metaGridHtml =
    metaLinhas.length > 0 ? `<div class="meta-grid">${metaLinhas.join('')}</div>` : '';

  const rawDesc = orc.descricao != null ? String(orc.descricao).trim() : '';
  const descricaoTxt = rawDesc ? esc(rawDesc) : '—';

  let modelosSectionBody;
  if (orc.tipo_proposta_os === 'sem_modelo') {
    modelosSectionBody =
      '<p class="muted-mini">Serviço contratado sem listagem de modelos nesta proposta.</p>';
  } else if (linhasModelos.length === 0) {
    modelosSectionBody =
      '<p class="muted-mini">Modelos a confirmar na contratação.</p>';
  } else {
    modelosSectionBody = `<ul class="modelos-nomes">${linhasModelos.map((l) => `<li>${esc(l.modelo_nome)}</li>`).join('')}</ul>`;
  }

  const condicoesBlock =
    orc.condicoes_pagamento != null && String(orc.condicoes_pagamento).trim()
      ? `<div class="section">
    <h2>Condições comerciais</h2>
    <p class="condicoes">${esc(orc.condicoes_pagamento)}</p>
  </div>`
      : '';

  const brandBlock = logoHtml
    ? `<div class="brand">${logoHtml}</div>`
    : `<div class="brand"><span class="brand-text">${esc(AGENCIA_RODAPE_ORCAMENTO.nome)}</span></div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orçamento nº ${esc(String(orc.id))}</title>
  <style>${STYLE_ORCAMENTO_CLIENTE}</style>
</head>
<body>
  <div class="doc-shell">
  <header class="doc-header">
    ${brandBlock}
    <div class="title-block">
      <h1>Orçamento</h1>
      <div class="sub">Nº ${esc(String(orc.id))} · ${esc(dataRef)}</div>
    </div>
  </header>

  <div class="section">
    <h2>Cliente</h2>
    <div class="body">
      <div class="cliente-nome">${clienteNome}${razao && razao !== clienteNome ? ` <span style="color:#64748b;font-weight:500;">(${razao})</span>` : ''}</div>
      ${clienteExtrasHtml}
    </div>
  </div>

  <div class="section">
    <h2>Descrição do trabalho</h2>
    <div class="body">
      <p>${descricaoTxt}</p>
      ${metaGridHtml}
    </div>
  </div>

  <div class="section">
    <h2>Modelos</h2>
    <div class="body">${modelosSectionBody}</div>
  </div>

  ${condicoesBlock}

  <div class="section">
    <h2>Valor total</h2>
    <div class="valor-total-wrap">
      <div class="rotulo">Investimento (total ao cliente)</div>
      <p class="num">${fmtMoneyBR(nums.total_cliente)}</p>
      <p class="nota-legal">
        Valor global da prestação de serviços de casting e contratação de modelos, incluindo encargos operacionais
        aplicáveis à proposta, conforme combinado com a agência.
      </p>
    </div>
  </div>

  <footer class="rodape-agencia">
    <p class="rodape-agencia-nome">${esc(AGENCIA_RODAPE_ORCAMENTO.nome)}</p>
    <p class="rodape-agencia-linha">${esc(AGENCIA_RODAPE_ORCAMENTO.endereco)}</p>
    <p class="rodape-agencia-linha">${esc(AGENCIA_RODAPE_ORCAMENTO.telefones)}</p>
  </footer>

  <p class="print-hint">Use Imprimir → Salvar como PDF · Formato A4</p>
  </div>
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
