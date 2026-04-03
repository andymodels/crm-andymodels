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

function buildListaModelosHtml(linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return '<p class="lista-modelos"><em>Sem modelos vinculados a esta O.S. (serviço sem modelo ou pendente de linhas).</em></p>';
  }
  const items = linhas
    .map((l) => {
      const nome = esc(l.modelo_nome);
      const cpf = esc(l.modelo_cpf || '');
      return `<li><strong>${nome}</strong> — CPF ${cpf || '—'}</li>`;
    })
    .join('');
  return `<ul class="lista-modelos">${items}</ul>`;
}

/**
 * Documento completo — mesma origem de dados (loadContratoContext); só muda o texto base.
 */
function buildContratoDocumentHtml(ctx) {
  const { os, cliente, linhas } = ctx;

  const clienteNome = esc(cliente.nome_fantasia || cliente.nome_empresa || '');
  const clienteRazao = esc(cliente.nome_empresa || '');
  const clienteCnpj = esc(cliente.cnpj || '');
  const clienteIe = esc(cliente.inscricao_estadual || '');
  const clienteEndereco = esc(cliente.endereco_completo || '');
  const clienteRepresentante = esc(cliente.contato_principal || '');
  const clienteCpfRepresentante = esc(cliente.documento_representante || '—');
  const osNumero = esc(String(os.id));

  const usoTipo = esc(os.uso_imagem || '—');
  const usoPrazo = esc(os.prazo || '—');
  const usoTerritorio = esc(os.territorio || '—');

  const valorTotal = fmtMoneyBR(os.total_cliente);
  const formaPagamento = esc(os.condicoes_pagamento || '—');

  const clausulasAdicionais = os.contrato_observacao
    ? `<p class="clause">${esc(os.contrato_observacao)}</p>`
    : '<p class="clause muted"><em>Não há cláusulas adicionais registradas na O.S.</em></p>';

  const listaModelos = buildListaModelosHtml(linhas);

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
  <title>Contrato — O.S. nº ${osNumero}</title>
  <style>
    body { font-family: 'Georgia', 'Times New Roman', serif; max-width: 820px; margin: 1.5rem auto; padding: 0 1.25rem; color: #0f172a; line-height: 1.55; font-size: 11pt; }
    .ref-bar { background: #0f172a; color: #fff; padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 1.25rem; font-size: 0.9rem; }
    h1 { font-size: 1.05rem; text-align: center; text-transform: uppercase; letter-spacing: 0.03em; margin: 1.25rem 0 1rem; line-height: 1.35; }
    h2 { font-size: 0.95rem; margin-top: 1.25rem; margin-bottom: 0.45rem; color: #1e293b; font-weight: 700; }
    p.clause { margin: 0.55rem 0; text-align: justify; }
    p.muted { color: #64748b; }
    ul.lista-modelos { margin: 0.5rem 0 0.75rem 1.25rem; }
    ul.lista-modelos li { margin: 0.25rem 0; }
    hr.sep { border: none; border-top: 1px solid #cbd5e1; margin: 2rem 0; }
    .sign { margin-top: 2rem; display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; text-align: center; font-size: 10pt; }
    .sign .line { border-top: 1px solid #000; margin-top: 2.5rem; padding-top: 0.35rem; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="ref-bar">
    <strong>O.S. nº ${osNumero}</strong>
    ${os.contrato_template_versao ? ` · Template ${esc(os.contrato_template_versao)}` : ''}
    · ${esc(dataRef)}
  </div>

  <h1>Instrumento particular de contrato de prestação de serviços e cessão de imagem por tempo determinado para utilização em campanha publicitária</h1>

  <p class="clause">
    Pelo presente instrumento particular, de um lado como <strong>CONTRATANTE/CLIENTE</strong>: ${clienteNome}, razão social
    ${clienteRazao}, inscrito no CNPJ sob nº ${clienteCnpj}, inscrição estadual ${clienteIe}, com endereço em ${clienteEndereco},
    neste ato representado por <strong>${clienteRepresentante}</strong>, portador(a) do CPF nº ${clienteCpfRepresentante}, e de outro lado como <strong>CONTRATADA</strong>:
    ANDY MODELS, razão social MEGA STUDIO LTDA, inscrita no CNPJ nº 01.553.737/0001-02, com sede na Av. Nossa Senhora da Penha,
    386-B, Vila Velha – ES, celebram o presente contrato referente à <strong>O.S. nº ${osNumero}</strong>.
  </p>

  <h2>CLÁUSULA PRIMEIRA – DO OBJETO</h2>
  <p class="clause">
    O presente contrato tem por objeto a prestação de serviços de disponibilização de modelo(s) para realização de trabalho
    publicitário conforme definido entre as partes.
  </p>
  <p class="clause">Os modelos envolvidos neste contrato são:</p>
  ${listaModelos}
  <p class="clause">O trabalho será realizado conforme condições previamente acordadas na O.S.</p>

  <h2>CLÁUSULA SEGUNDA – DO USO DE IMAGEM</h2>
  <p class="clause">O CLIENTE fica autorizado a utilizar a imagem dos modelos conforme as condições abaixo:</p>
  <p class="clause">
    <strong>Tipo de uso:</strong> ${usoTipo}<br />
    <strong>Prazo:</strong> ${usoPrazo}<br />
    <strong>Abrangência territorial:</strong> ${usoTerritorio}
  </p>
  <p class="clause">
    A utilização das imagens está restrita aos meios previamente acordados, sendo vedada qualquer utilização fora do escopo contratado.
    É expressamente proibido o uso das imagens para inteligência artificial, deepfake, machine learning ou qualquer tecnologia similar
    sem autorização formal da CONTRATADA.
  </p>

  <h2>CLÁUSULA TERCEIRA – DO VALOR E PAGAMENTO</h2>
  <p class="clause">O valor total deste contrato é de <strong>${valorTotal}</strong>.</p>
  <p class="clause">A forma de pagamento será conforme acordado entre as partes: <strong>${formaPagamento}</strong>.</p>
  <p class="clause">
    O não pagamento na data acordada implicará aplicação de multa e juros conforme legislação vigente.
  </p>

  <h2>CLÁUSULA QUARTA – DA EXCLUSIVIDADE E INTERMEDIAÇÃO</h2>
  <p class="clause">
    Durante o período de até 2 anos, novas contratações dos modelos envolvidos deverão ser realizadas exclusivamente por
    intermédio da CONTRATADA.
  </p>

  <h2>CLÁUSULA QUINTA – DO PRAZO</h2>
  <p class="clause">O prazo de utilização das imagens será conforme definido neste contrato.</p>
  <p class="clause">Caso haja necessidade de renovação, deverá ser feito novo acordo entre as partes.</p>
  <p class="clause">A não utilização do material não isenta o CLIENTE do pagamento.</p>

  <h2>CLÁUSULA SEXTA – DOS MATERIAIS</h2>
  <p class="clause">
    Os materiais poderão ser utilizados em campanhas publicitárias, mídias digitais, impressos e demais meios acordados.
    Após o término do prazo, fica proibida a continuidade da utilização sem renovação contratual.
  </p>

  <h2>CLÁUSULA SÉTIMA – DA CONFIDENCIALIDADE</h2>
  <p class="clause">As partes se comprometem a manter sigilo sobre todas as informações e condições deste contrato.</p>

  <h2>CLÁUSULA OITAVA – DA MULTA</h2>
  <p class="clause">
    O descumprimento de qualquer cláusula implicará multa equivalente ao valor total do contrato, além de perdas e danos.
  </p>

  <h2>CLÁUSULA NONA – DO FORO</h2>
  <p class="clause">Fica eleito o foro da comarca de Vila Velha – ES para dirimir quaisquer dúvidas oriundas deste contrato.</p>

  <h2>CLÁUSULAS ADICIONAIS</h2>
  ${clausulasAdicionais}

  <p class="clause" style="margin-top:1.5rem">E por estarem de acordo, as partes firmam o presente instrumento.</p>

  <hr class="sep" />

  <div class="sign">
    <div>
      <div class="line">CONTRATANTE / CLIENTE</div>
    </div>
    <div>
      <div class="line">CONTRATADA — ANDY MODELS</div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  buildContratoDocumentHtml,
  buildContratoPreviewHtml: buildContratoDocumentHtml,
};
