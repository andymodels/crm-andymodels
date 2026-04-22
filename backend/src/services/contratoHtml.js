const fs = require('fs');
const path = require('path');

/**
 * Contrato: texto jurídico fixo da agência + apenas dados da O.S. e cadastros.
 * Exibe ao cliente: dados do cliente, modelos, valor total, uso de imagem e condições de pagamento.
 * Demais valores (parceiro, booker, impostos, etc.) permanecem apenas na O.S.
 */

function esc(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoneyBR(n) {
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function onlyDigits(v) {
  return String(v || '').replace(/\D+/g, '');
}

function formatCpfDisplay(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (!d) return '';
  if (d.length !== 11) return d;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function loadAssinaturaDataUri() {
  try {
    const assinaturaPath = path.join(__dirname, '..', 'assets', 'assinatura-andy-models.png');
    const buf = fs.readFileSync(assinaturaPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

function buildListaModelosHtml(linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return '<p class="lista-modelos"><strong>Sem modelos vinculados a esta O.S.</strong></p>';
  }
  const items = linhas
    .map((l) => {
      const nome = esc(String(l.modelo_nome || '').trim() || 'Modelo sem nome no cadastro');
      const cpfFmt = formatCpfDisplay(l.modelo_cpf || '');
      const cpf = esc(cpfFmt);
      return `<li><strong>${nome}</strong> — <strong>${cpf || 'CPF não informado'}</strong></li>`;
    })
    .join('');
  return `<ul class="lista-modelos">${items}</ul>`;
}

/**
 * Documento completo — mesma origem de dados (loadContratoContext); só muda o texto base.
 */
function buildContratoDocumentHtml(ctx) {
  const { os, cliente, linhas } = ctx;

  const clienteNome = esc(cliente.nome_fantasia || cliente.nome_empresa || '—');
  const clienteRazao = esc(cliente.nome_empresa || '—');
  const clienteDocumento = esc(cliente.documento || cliente.cnpj || '—');
  const clienteEndereco = esc(cliente.endereco_completo || '—');
  const clienteRepresentante = esc(cliente.contato_principal || '—');
  const clienteCpfRepresentante = esc(cliente.documento_representante || '—');
  const osNumero = esc(String(os.id));

  const usoTipo = esc(os.uso_imagem || '—');
  const usoPrazo = esc(os.prazo || '—');
  const usoTerritorio = esc(os.territorio || '—');

  const valorTotal = fmtMoneyBR(os.total_cliente);

  const listaModelos = buildListaModelosHtml(linhas);

  const dataRef = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const assinaturaDataUri = loadAssinaturaDataUri();

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Contrato — O.S. nº ${osNumero}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    html, body { background: #fff; color: #111827; }
    body {
      font-family: 'Times New Roman', Georgia, serif;
      font-size: 12pt;
      line-height: 1.5;
      margin: 0;
      width: 100%;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .documento {
      width: 100%;
      max-width: 794px;
      margin: 0;
      padding: 0 8mm;
      box-sizing: border-box;
    }
    h1 {
      font-size: 12.5pt;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.01em;
      margin: 0 0 6mm 0;
      line-height: 1.4;
      font-weight: 700;
    }
    h2 {
      font-size: 12pt;
      margin: 5.2mm 0 2.2mm;
      font-weight: 700;
      text-transform: uppercase;
      page-break-after: avoid;
    }
    p.clause {
      margin: 0 0 2.2mm 0;
      text-align: justify;
      orphans: 3;
      widows: 3;
      page-break-inside: avoid;
    }
    ul.lista-modelos {
      margin: 0 0 3mm 0;
      padding-left: 6mm;
      page-break-inside: avoid;
    }
    ul.lista-modelos li { margin: 0 0 1.8mm 0; }
    .rodape-local-data {
      margin-top: 6mm;
      text-align: right;
      page-break-inside: avoid;
    }
    .sign {
      margin-top: 8mm;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12mm;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .assinatura-agencia {
      display: block;
      width: 250px;
      max-width: 100%;
      height: auto;
      margin: 0 auto 14px;
      object-fit: contain;
      opacity: 0.78;
      page-break-inside: avoid;
    }
    .line {
      border-top: 1px solid #111827;
      padding-top: 2.8mm;
      font-size: 10.5pt;
      font-weight: 700;
    }
    @media print {
      @page { size: A4; margin: 20mm; }
      html, body { width: 100%; margin: 0; }
      .documento {
        width: 100%;
        max-width: none;
        margin: 0;
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <main class="documento">
  <h1>INSTRUMENTO PARTICULAR DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS E CESSÃO DE USO DE IMAGEM</h1>

  <p class="clause">
    Pelo presente instrumento, de um lado como CONTRATANTE/CLIENTE: <strong>${clienteNome}</strong>, razão social
    <strong>${clienteRazao}</strong>, inscrito sob nº <strong>${clienteDocumento}</strong>, com endereço em
    <strong>${clienteEndereco}</strong>, neste ato representado por <strong>${clienteRepresentante}</strong>, CPF nº
    <strong>${clienteCpfRepresentante}</strong>, e de outro lado como CONTRATADA: ANDY MODELS, razão social MEGA STUDIO LTDA,
    inscrita no CNPJ nº 01.553.737/0001-02, referente à O.S. nº <strong>${osNumero}</strong>.
  </p>

  <h2>CLÁUSULA PRIMEIRA – DO OBJETO</h2>
  <p class="clause">
    Prestação de serviços de agenciamento, intermediação e disponibilização de modelo(s), bem como cessão de uso de imagem
    para fins publicitários, conforme definido na O.S.
  </p>
  <p class="clause">Modelos envolvidos:</p>
  ${listaModelos}

  <h2>CLÁUSULA SEGUNDA – DA REPRESENTAÇÃO</h2>
  <p class="clause">
    A CONTRATADA declara que possui autorização formal dos modelos para representá-los, negociar e firmar contratos de cessão
    de uso de imagem em seu nome.
  </p>

  <h2>CLÁUSULA TERCEIRA – DO USO DE IMAGEM</h2>
  <p class="clause">
    Tipo de uso: <strong>${usoTipo}</strong><br />
    Prazo: <strong>${usoPrazo}</strong><br />
    Abrangência: <strong>${usoTerritorio}</strong>
  </p>
  <p class="clause">
    O uso está limitado às condições acima. É proibido uso para IA, deepfake ou similares sem autorização.
    O uso não pode prejudicar honra ou imagem dos modelos.
  </p>

  <h2>CLÁUSULA QUARTA – DO VALOR</h2>
  <p class="clause">Valor total: <strong>${valorTotal}</strong></p>
  <p class="clause">
    As condições de pagamento são aquelas definidas na O.S.
  </p>
  <p class="clause">
    O valor inclui serviços da CONTRATADA, intermediação e custos operacionais, além da remuneração dos modelos.
  </p>

  <h2>CLÁUSULA QUINTA – DA EXCLUSIVIDADE</h2>
  <p class="clause">
    Durante o uso da campanha e até 2 anos após sua veiculação, novas contratações devem ser feitas via CONTRATADA.
  </p>

  <h2>CLÁUSULA SEXTA – DO PRAZO</h2>
  <p class="clause">O uso será pelo período definido na O.S.</p>
  <p class="clause">Renovação exige novo acordo.</p>

  <h2>CLÁUSULA SÉTIMA – DOS MATERIAIS</h2>
  <p class="clause">
    O uso se limita aos meios definidos.
  </p>
  <p class="clause">
    Uso após prazo caracteriza uso indevido.
  </p>

  <h2>CLÁUSULA OITAVA – CONFIDENCIALIDADE</h2>
  <p class="clause">As partes mantêm sigilo, salvo obrigação legal.</p>

  <h2>CLÁUSULA NONA – PENALIDADES</h2>
  <p class="clause">
    Descumprimento gera multa equivalente ao valor do contrato, além de perdas e danos.
  </p>

  <h2>CLÁUSULA DÉCIMA – FORO</h2>
  <p class="clause">Foro de Vila Velha – ES.</p>

  <p class="clause" style="margin-top:6mm">E por estarem de acordo, as partes firmam o presente instrumento.</p>
  <p class="rodape-local-data">Vila Velha – ES, ${esc(dataRef)}.</p>

  <div class="sign">
    <div>
      <div style="height: 54px;"></div>
      <div class="line">CONTRATANTE / CLIENTE</div>
    </div>
    <div>
      ${assinaturaDataUri ? `<img class="assinatura-agencia" src="${assinaturaDataUri}" alt="Assinatura Andy Models" />` : '<div style="height: 54px;"></div>'}
      <div class="line">CONTRATADA – ANDY MODELS</div>
    </div>
  </div>
  </main>
</body>
</html>`;
}

module.exports = {
  buildContratoDocumentHtml,
  buildContratoPreviewHtml: buildContratoDocumentHtml,
};
