# ANDY MODELS CRM — Blueprint (referência do projeto)

Documento vivo: descreve **o que o produto pretende ser**, **o que já está implementado** e **o que falta**, para alinhar UI, API e regras de negócio. Última revisão alinhada ao código em `backend/` e `frontend/`.

**Visual de referência (PNG):** [`docs/andy-models-crm-blueprint.png`](./docs/andy-models-crm-blueprint.png) — wireframe do layout alvo (sidebar, dashboard, cálculo do job, extrato modelo).

---

## 1. Visão do produto

CRM financeiro e operacional para agência de modelos: cadastros (clientes, modelos, bookers, parceiros), orçamento comercial, ordens de serviço (O.S. / Jobs) com cálculo de repasses, e (planejado) financeiro com recebimentos, pagamentos e extrato por modelo.

**Público v1:** uso interno / admin.

**Fluxo macro**

1. **Cliente** cadastrado.
2. **Orçamento** (rascunho): valores comerciais, sem alocação de modelos na primeira versão.
3. **Aprovar orçamento** → gera **O.S.** com snapshot financeiro inicial (espelhando orçamento + regras de cálculo).
4. **O.S. (Job):** editar tipo (com/sem modelo), linhas de modelo (cachê, NF própria), booker, extras; recálculo server-side.
5. **Contrato (quando aplicável):** flag na O.S. (`emitir_contrato`) — **nem todo trabalho** usa contrato. Quando ativo, o PDF **não** duplica formulário: vem **semi-preenchido** de cadastro + orçamento + O.S. (ver §6.1). Só o **cliente assina**, quando o trabalho estiver **fechado**; arquivo junto da O.S.
6. **Recebimento** (planejado) → após recebido, **bloquear edição de valores** na O.S.
7. **Pagamentos** parcelados e **extrato por modelo** (planejado).

---

## 2. Stack

| Camada   | Tecnologia                          |
|----------|-------------------------------------|
| Frontend | React, Vite, Tailwind CSS           |
| Backend  | Node.js, Express                    |
| Banco    | PostgreSQL (`DATABASE_URL` obrigatório) |
| API      | JSON REST; rotas em `/` e `/api` (espelhadas) |

Variáveis: `backend/.env` (`DATABASE_URL`), `frontend/.env` (`VITE_API_URL`, ex.: `http://localhost:3001`).

---

## 3. Mapa de navegação — alvo vs. implementado

Referência visual original: sidebar com **Dashboard**, **Cadastros** (subitens), **Orçamentos**, **Jobs**, **Financeiro**, **Extrato Modelo**.

| Módulo (wireframe) | Estado no frontend atual (`App.jsx`) |
|--------------------|--------------------------------------|
| Dashboard (cards + alertas + **calendário operacional**) | **Implementado** (`inicio`: resumo, `/dashboard/alertas`, `/dashboard/calendario`; O.S. com `data_vencimento_cliente` e linhas com `data_prevista_pagamento` opcionais) |
| Cadastros → Clientes, Modelos, Bookers, Parceiros | **Implementado** (abas) |
| Orçamentos | **Implementado** (lista + form; aprovar gera O.S.) |
| Jobs / O.S. | **Implementado** (lista + edição + resumo financeiro) |
| Contrato + arquivo na O.S. | **Implementado** (HTML + e-mail; PDF manual pelo navegador) |
| PDFs (orçamento, O.S.) | **v1:** HTML em `GET /orcamentos/:id/pdf` e `GET /ordens-servico/:id/pdf` (imprimir → PDF); contrato já tinha preview HTML |
| Financeiro | **Implementado (v1)** — recebimentos por O.S. + cards de resumo |
| Extrato Modelo | **Implementado (v1)** — líquido / pago / saldo por linha `os_modelos` |

**Próximos passos:** PDF binário server-side se necessário; totais booker/parceiros no resumo; e-mail automático a modelos após aprovação da O.S. (planejado, não implementado).

---

## 4. Regras financeiras da O.S. (implementação atual)

Fonte de verdade do cálculo: `backend/src/services/osFinanceiro.js` (`computeOsFinancials`, `lineLiquido`).

### 4.1 Tipos de O.S.

- **`com_modelo`:** total faturado ao cliente a partir do **cachê dos modelos**, **taxa da agência (%) sobre o cachê**, **extras da agência (valor)**. Pode haver **linhas** em `os_modelos` ou, temporariamente, só **`cache_modelo_total`** (ex.: logo após aprovar o orçamento).
- **`sem_modelo`:** **valor de serviço** + extras da agência; sem cachê de modelo nem tabela de linhas.

### 4.2 Líquido por linha de modelo

Sobre o **cachê da linha** (`cache_modelo`):

- Se **emite NF própria:** desconta apenas a **taxa da agência (%)** sobre o cachê.
- Caso contrário: desconta **imposto (%)** e **taxa da agência (%)** sobre o cachê (imposto incidente conforme parâmetros do serviço).

### 4.3 Agregados (visão resumida)

- **`total_cliente`:** valor total cobrado do cliente no cenário atual (inclui extras da agência quando `com_modelo` ou `sem_modelo`, conforme fórmulas no arquivo).
- **`imposto_valor`:** incide sobre **`total_cliente`** (percentual configurável na O.S., padrão na criação via aprovação: 10%).
- **`modelo_liquido_total`:** soma dos líquidos das linhas (ou bloco único quando não há linhas e usa `cache_modelo_total`).
- **Cadeia de margem da agência (percentuais ausentes = 0):** `agencia_parcial` = `total_cliente - imposto - modelo_liquido_total`; **parceiro** = % sobre `agencia_parcial`; `agencia_apos_parceiro` = `agencia_parcial - parceiro_valor`; **booker** = % sobre `agencia_apos_parceiro` (nunca sobre o cachê do modelo); `agencia_final` = após booker; **`resultado_agencia`** = `agencia_final - extras_despesa_valor`. **`resultado_agencia`** é o líquido final da agência no job (ver **§4.4**). Listagem e detalhe da O.S. — conferir **`osFinanceiro.js`**.

### 4.4 Desenho conceitual (wireframe “JOB Cálculo”)

**Contrato de produto (não negociável na implementação):** a distribuição financeira da agência **sempre** segue **quatro etapas fixas e nesta ordem**: (1) **imposto** sobre o faturamento ao cliente, (2) **pagamento líquido ao modelo** (cachê / regras de linha), (3) **parceiros** sobre a margem restante da agência, (4) **booker** sobre a margem já após o parceiro. Parceiro e booker são **sempre** calculados sobre o **lucro da agência** (a margem após imposto e modelo), **nunca** sobre o cachê bruto do modelo. Se não houver parceiro ou booker na O.S., os percentuais e valores correspondentes devem ser tratados como **zero** — a cadeia de cálculo **não** é encurtada, para evitar inconsistências e regressões (por exemplo, recalcular booker direto sobre o cachê ou pular etapas).

Montagem do **total faturado ao cliente**:

```text
total_cliente = cache_modelo_total
  + taxa_agencia (valor = % sobre o cachê)
  + extras_agencia_valor
```

**Extras da agência** (`extras_agencia_valor`): entram **apenas** na formação de **`total_cliente`** (receita adicional cobrada do cliente). **Não** entram de novo na distribuição interna nem podem ser somados outra vez em `resultado_agencia` ou em percentuais de parceiro/booker — isso quebraria o financeiro.

**Distribuição da margem** (mesma ordem lógica das quatro etapas; parceiro/booker com % nulo = 0):

```text
agencia_parcial = total_cliente - imposto_valor - modelo_liquido_total
parceiro_valor = agencia_parcial * (parceiro_percent / 100)
agencia_apos_parceiro = agencia_parcial - parceiro_valor
booker_valor = agencia_apos_parceiro * (booker_percent / 100)
agencia_final = agencia_apos_parceiro - booker_valor
resultado_agencia = agencia_final - extras_despesa_valor
```

**`resultado_agencia`:** é **sempre** o valor **final líquido** que permanece com a **agência** depois de **todas** as deduções previstas na cadeia (imposto operacional incidente sobre `total_cliente`, repasse líquido aos modelos, parceiro, booker e **extras despesa** atribuídos à O.S.). Não é “receita bruta” nem margem intermediária; é o número a usar em listagens e decisões quando se fala no **resultado da agência** naquele job.

**Extras despesa** (`extras_despesa_valor`): custo operacional atribuído à O.S. (deduzido em `resultado_agencia`).  
Despesas administrativas globais ficam **fora** deste escopo até existir módulo próprio.

### 4.5 Extrato modelo (planejado)

Colunas alvo: **Job | Cliente | Líquido | Pago | Saldo | Status** — o **líquido** exposto ao modelo deve refletir apenas o **valor líquido devido ao modelo** (não misturar com receita da agência).

---

## 5. Modelo de dados (principais tabelas)

Criação/alteração incremental em `backend/src/config/db.js` (na subida da API).

| Tabela / grupo | Conteúdo relevante |
|----------------|-------------------|
| `clientes` | PF/PJ, documento, endereço estruturado, telefones/emails (JSONB) |
| `modelos` | Dados pessoais, responsável se menor, PIX/formas, NF própria |
| `bookers`, `parceiros` | Contatos e formas de pagamento |
| `orcamentos` | Rascunho → aprovado; vínculo com cliente |
| `ordens_servico` | O.S.: tipo, valores financeiros persistidos, status (`aberta`, `recebida`, …), booker, texto (prazo, território, **uso_imagem**, etc.); **evolução:** flag `emitir_contrato` + metadados de contrato — ver §6.2 |
| `os_modelos` | Linhas: `os_id`, `modelo_id`, `cache_modelo`, `emite_nf_propria` — **nomes** alimentam o contrato (modelo anuente) |
| `os_documentos` | PDFs/arquivos ligados à O.S. |
| `recebimentos` | Valores recebidos do **cliente**, sempre com `os_id` |
| `pagamentos_modelo` | Pagamentos a **modelo** por linha (`os_modelo_id`) |

**Regra:** O.S. com status **`recebida`** não aceita `PUT` de edição (valores travados).

---

## 6. Contrato com cliente (regra de negócio)

- **Quem assina:** apenas o **cliente** (contratante).
- **Modelo(s):** figuram no texto como **parte anuente** / identificados **nominalmente** (e, na O.S., ligados em `os_modelos`), sem fluxo de assinatura eletrônica do modelo no v1, salvo evolução futura.
- **Conteúdo típico alinhado ao que já existe no sistema:** descrição do trabalho, **valores** (totais e, quando aplicável, repartição coerente com o cálculo), **prazo**, **território**, **condições de pagamento**, **uso de imagem** (campo já previsto em orçamento/O.S.).
- **Amarração:** o contrato é sempre **filho do contexto da O.S.** (não “solto”); o orçamento aprovado é o caminho que **gera** a O.S., e o contrato **espelha** o combinado na O.S. na data da geração (com **versão** do template para auditoria).

### 6.1 Na prática: quando há contrato, assinatura e preenchimento automático

**Momento:** o contrato só é **assinado pelo cliente** quando o trabalho está **fechado** (combinado comercialmente). O sistema deve suportar **gerar** o PDF antes (para conferência/envio), mas o fluxo mental é: O.S. correta → opcionalmente gerar contrato → cliente assina fora ou assinatura arquivada depois.

**Nem todo trabalho tem contrato.** Exemplos: trabalhos em que não há necessidade de formalizar **uso de imagem** (ou política interna de não emitir contrato naquele caso). Isso se controla na O.S. com um **flag explícito**, por exemplo `emitir_contrato` / “Este trabalho possui contrato” — **desligado por padrão** ou sugerido pela regra de negócio (ex.: sugerir “sim” quando há uso de imagem preenchido).

**Objetivo de UX: contrato semi-preenchido automaticamente, sem segundo formulário duplicado.**

| Origem | O que alimenta o contrato |
|--------|---------------------------|
| **Cadastro de clientes** | Razão social, documento, endereço, contatos — pela O.S. `cliente_id`. |
| **Cadastro de modelos** | Nome (e demais dados necessários ao texto jurídico) — ao **incluir o modelo na O.S.** (`os_modelos`), o sistema já **puxa** do cadastro; não se redigem nomes à mão só para o contrato. |
| **Orçamento → O.S.** | O que já veio do orçamento e está na O.S.: **descrição, prazo, território, uso de imagem, condições de pagamento** (e demais campos espelhados). |
| **O.S. (edição)** | **Valores**, ajustes finos de condições, linhas de modelo/cachê, etc. — é aqui que o usuário **concentra** o trabalho manual operacional; o **contrato só lê** o estado atual da O.S. + cadastros. |

Quando o usuário **marca** que aquele trabalho **tem contrato**, a ação **“Gerar contrato (PDF)”** deve **montar o documento** a partir desses dados: modelos envolvidos, condições de uso de imagem **já definidas na O.S.** (herdadas do orçamento), valores e textos — **sem** exigir um passo extra de “preencher contrato” com os mesmos campos. O único “manual” permanece o que já é manual na O.S. (valores, condições de pagamento, etc.); o template jurídico fixo (cláusulas padrão) vem do **modelo de contrato** da agência, não de digitação livre repetida.

**Validação de produto (sugestão):** se `emitir_contrato = true` e o tipo de trabalho exige clareza legal (ex.: uso de imagem), garantir que **uso de imagem** e **modelos** (quando `com_modelo`) estejam preenchidos antes de liberar a geração do PDF — com mensagem clara, não com campos duplicados.

### 6.2 Onde guardar o contrato (sugestão de modelo de dados)

Duas camadas complementares:

1. **Metadados na própria O.S.** (simples, para filtros e tela):
   - `contrato_template_versao` (ex.: `2025.1`) — qual revisão do seu modelo Word/PDF base foi usada.
   - `contrato_gerado_em` (timestamp) — quando o PDF foi gerado no sistema.
   - `contrato_enviado_em` (timestamp, opcional — evolução) — quando o envio ao cliente foi disparado pelo sistema.
   - `contrato_status` (opcional — evolução) — ex.: `pendente_envio` \| `aguardando_assinatura` \| `recebido` \| `recusado` \| `nao_aplicavel` (deriva também de `emitir_contrato`).
   - `contrato_assinado_em` (timestamp, opcional) — quando o arquivo assinado foi arquivado no CRM.
   - `contrato_observacao` (texto curto, opcional) — nota interna (“reenviado por e-mail em …”).

2. **Tabela `os_documentos` (recomendado para arquivamento limpo)** — um ou mais arquivos por O.S.:

   | Campo (exemplo) | Uso |
   |-----------------|-----|
   | `os_id` | FK para `ordens_servico` |
   | `tipo` | `contrato_pdf_gerado` \| `contrato_assinado_scan` \| `anexo_extra` |
   | `nome_arquivo` | Nome amigável |
   | `mime` | `application/pdf` / `image/jpeg` |
   | `storage_key` ou `url` | Caminho em disco, **S3**, ou URL assinada — **evitar** guardar PDF inteiro no PostgreSQL |
   | `sha256` (opcional) | Integridade |
   | `created_at` | Auditoria |

Assim o **contrato fica arquivado junto da O.S.** sem misturar binário no banco; backups = pasta ou bucket.

**Evolução do schema da O.S. (além dos campos acima):** flag `emitir_contrato` (boolean), opcionalmente com **data prevista / realizada** de assinatura se precisar de relatório.

### 6.3 UI (alvo)

Na tela da **O.S. / Job:** bloco **“Documentos”** com ações **Gerar contrato (PDF)**, **Baixar orçamento (PDF)**, **Baixar O.S. (PDF)**, **Enviar contrato assinado** (upload manual do scan — **v1**), e em evolução **Enviar ao cliente pelo sistema** / **Ver status da assinatura** (§6.4).

### 6.4 Envio ao cliente, retorno assinado e alerta na home (evolução — “tudo pelo CRM”)

**Objetivo:** enviar o contrato **a partir do sistema** e **receber de volta** o PDF/imagem assinado **sem depender só** de WhatsApp/e-mail manual como único fluxo; a **home (Dashboard)** mostra **alerta** enquanto o contrato não voltar (“contrato pendente” / “aguardando assinatura”).

**Estado para o painel:** considerar `emitir_contrato = true` e contrato **ainda não recebido** (`contrato_assinado_em` nulo e `contrato_status` não `recebido`) → entra na lista de **pendências de assinatura**. Quando o arquivo assinado for anexado (upload interno ou retorno via fluxo abaixo), o alerta **some** para aquela O.S.

**Formas técnicas possíveis (escolher na implementação):**

| Abordagem | Envio | Retorno | Observação |
|-----------|--------|---------|------------|
| **E-mail transacional** | API (SES, SendGrid, etc.) com PDF anexo ou link | Cliente responde com anexo — **fraco** (operacional) ou link “responder no portal” | Exige provedor e `SMTP`/API configurados. |
| **Link mágico (portal mínimo)** | E-mail/WhatsApp **gerado pelo CRM** com URL assinada (`token` + validade) | Página só para **baixar** o PDF enviado e **subir** o assinado (drag-and-drop) | Sem login do cliente; token expira; arquivo cai em `os_documentos`. |
| **Assinatura eletrônica (Brasil)** | ClickSign, ZapSign, D4Sign, etc. | Webhook “assinado” → PDF final no storage → atualiza `contrato_status` | Melhor para **prova** jurídica e rastreio; custo/API por documento. |

**Recomendação de produto:** começar com **portal por link mágico** (envio + upload de volta) ou **integração com um provedor de assinatura** se quiser validade jurídica forte desde o início; manter sempre **upload manual na O.S.** como escape (cliente manda por fora, operador anexa).

**Dashboard / home:** além dos cards financeiros planejados, um bloco fixo ou faixa:

- **“Contratos pendentes”** — contagem + atalho para lista filtrada (O.S. com contrato esperado e sem retorno).
- Opcional: **lembrete** por data (`contrato_enviado_em` + N dias) para “cobrar assinatura”.

**Endpoints (planejados):**

- `POST /ordens-servico/:id/contrato/enviar` — dispara envio (e-mail/link/integração).
- `POST /public/contrato-retorno/:token` — upload do assinado via link mágico (rota pública sem sessão admin).
- Webhook do provedor de assinatura → atualiza O.S. e `os_documentos`.

---

## 7. Geração de PDF (orçamento, O.S., contrato)

**Escopo desejado:** todo trabalho gera documentação padronizada — **orçamento**, **O.S.** e **contrato** exportáveis com layout institucional.

**Implementado (v1):** rotas `GET /orcamentos/:id/pdf` e `GET /ordens-servico/:id/pdf` devolvem **HTML** pronto para **Imprimir → Salvar como PDF** no navegador (`documentoOrcamentoOsHtml.js`). Contrato continua com `contrato-preview` (HTML).

**Evolução (opcional):**

**Sugestão técnica (a definir na implementação):**

- **Opção A — Template HTML + motor headless:** gerar HTML com os dados (mesma fonte que a API) e imprimir para PDF (ex.: Puppeteer/Playwright no backend). Bom para seu **contrato padrão** em HTML com placeholders.
- **Opção B — Biblioteca PDF programática:** PDFKit / pdf-lib no Node para orçamento e O.S. mais tabulares.
- **Opção C — Docx:** manter o **.docx** oficial como arquivo mestre no repositório ou storage, preencher com merge (ex.: `docxtemplater`) e converter para PDF se necessário.

**Regra de consistência:** ao **gerar o contrato**, usar **snapshot** dos campos da O.S. naquele momento (e `contrato_template_versao`). Se a O.S. for editada depois, **novo PDF** = novo registro em `os_documentos` ou nova versão explícita — evita ambiguidade jurídica.

**Endpoints (planejados):**

- `GET /orcamentos/:id/pdf`
- `GET /ordens-servico/:id/pdf`
- `GET /ordens-servico/:id/contrato/pdf` (gera e opcionalmente persiste)
- `POST /ordens-servico/:id/documentos` (upload do assinado)
- `POST /ordens-servico/:id/contrato/enviar`, `POST /public/contrato-retorno/:token` (§6.4)

---

## 8. API — rotas principais (estado atual)

| Área | Rotas |
|------|--------|
| Saúde | `GET /health` |
| Cadastros | CRUD em `clientes` (alias `clients`), `modelos`, `bookers`, `parceiros` |
| Orçamentos | `GET/POST /orcamentos`, `PUT /orcamentos/:id`, `POST /orcamentos/:id/aprovar`, `GET /orcamentos/:id/pdf` (HTML para impressão) |
| O.S. | `GET /ordens-servico`, `GET /ordens-servico/:id`, `PUT /ordens-servico/:id`, `GET /ordens-servico/:id/pdf` (HTML para impressão) |
| Documentos O.S. | `POST /ordens-servico/:id/documentos`, `GET .../documentos/:docId/download`, `DELETE ...` |
| Dashboard | `GET /dashboard/contratos-pendentes`, `GET /dashboard/alertas`, `GET /dashboard/calendario?from=&to=` |
| Extrato modelo | `GET /extrato-modelo/resumo` (lista + saldo) · `GET /extrato-modelo/:id/linhas` (?ver_tudo, mes, data_de, data_ate) |
| Financeiro | `GET /financeiro/resumo`, `GET/POST /financeiro/recebimentos`, `GET/POST /financeiro/pagamentos-modelo` |

---

## 9. Wireframe ASCII (atualizado — espelho do produto alvo)

```text
+------------------------------------------------------------------+
|  ANDY MODELS CRM                                                  |
+------------------------------------------------------------------+
| SIDEBAR              |  MAIN                                      |
| -------------------- | ------------------------------------------ |
| [ok] Dashboard       |  Calendário operacional + cards; listas         |
|                      |  contrato / a receber / pagar modelos           |
| Cadastros            |  financeiro agregado                       |
|   - Clientes    [ok] |                                            |
|   - Modelos     [ok] |  JOB / O.S. (parcialmente na UI)            |
|   - Bookers     [ok] |  Calculo server-side + formulario Jobs      |
|   - Parceiros   [ok] |                                            |
| Orçamentos      [ok] |  EXTRATO MODELO (planejado)                 |
| Jobs / O.S.     [ok] |  Tabela: Job | Cliente | Liquido | ...     |
| Financeiro      [ok] |  Recebimentos + resumo (v1)                 |
| Extrato Modelo  [ok] |  Tabela liquido/pago/saldo (v1)             |
+----------------------+--------------------------------------------+
```

Legenda: `[ok]` = existe tela útil na aplicação atual; `[ ]` = ainda não construído no front.

---

## 10. Itens conscientemente fora do escopo atual (código)

- Multi-usuário / autenticação / perfis.
- Implementação de `os_documentos`, uploads e rotas de PDF (especificados nas §6–7; ainda não codificados).
- Envio de contrato pelo sistema, portal por link mágico ou assinatura eletrônica, e alertas na home (§6.4).
- Integração bancária ou NF-e automática.

---

## 11. Como manter este documento

Ao alterar regras de cálculo, **atualizar `osFinanceiro.js` e este blueprint** na mesma tarefa. Ao criar Dashboard, Financeiro ou **documentos/PDF**, **marcar a tabela da seção 3** e acrescentar endpoints na seção 8. Qualquer mudança no **modelo de contrato** deve incrementar **`contrato_template_versao`** e ser registrada aqui em uma linha de changelog (data + versão).
