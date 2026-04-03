# ANDY MODELS CRM

**Blueprint do produto (norte do projeto):** veja [`BLUEPRINT.md`](./BLUEPRINT.md) — visão, módulos implementados vs. planejados, regras financeiras e mapa da API.

Implementado até agora: **Dashboard** (resumo de caixa + alertas), **Cadastros**, **Orçamentos** (aprovação gera O.S.), **Jobs / O.S.**, **Financeiro** (recebimentos e resumo), **Extrato modelo**, exportação **HTML para PDF** (orçamento e O.S. pelo navegador).

## Stack

- Frontend: React + Vite + TailwindCSS
- Backend: Node.js + Express
- Banco: PostgreSQL

## Como rodar localmente

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run setup:db
npm run dev
```

Configure `DATABASE_URL` no arquivo `.env`.

**Perfil de teste (cálculo):** com o `.env` configurado, na pasta `backend` execute `npm run seed:perfil`. Isso cria cliente e modelo fictícios, orçamento **R$ 1.000 + 20% + R$ 300 extras**, aprova a O.S. e inclui linha de modelo **R$ 1.000** — útil para validar totais na tela **Jobs / O.S.** Rodar de novo remove e recria o mesmo cenário (marcador `[SEED-PERFIL-TESTE]`).

### 2) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Endpoints principais

- Cadastros: `clientes` (alias `clients`), `modelos`, `bookers`, `parceiros` — `GET` / `POST` / `PUT` / `DELETE` conforme rota
- Orçamentos: `GET/POST /orcamentos`, `PUT /orcamentos/:id`, `POST /orcamentos/:id/aprovar`, `GET /orcamentos/:id/pdf` (HTML para imprimir / salvar PDF)
- Ordens de serviço: `GET /ordens-servico`, `GET /ordens-servico/:id`, `PUT /ordens-servico/:id`, `GET /ordens-servico/:id/pdf` (HTML)
- Contrato (quando ativo na O.S.): `GET /ordens-servico/:id/contrato-preview`, `POST /ordens-servico/:id/contrato-enviar-email` (se SMTP configurado)
- Dashboard: `GET /dashboard/alertas`, `GET /dashboard/contratos-pendentes`, `GET /dashboard/calendario?from=YYYY-MM-DD&to=YYYY-MM-DD` (eventos derivados de O.S. e financeiro)
- Financeiro: `GET /financeiro/resumo`, recebimentos e pagamentos a modelo (ver `BLUEPRINT.md`)

Detalhes e regras de negócio: **`BLUEPRINT.md`**.

## Deploy (Render)

- **Root Directory:** `backend` (pasta do serviço Node no repositório).
- **Build Command:** `npm install` **ou** `npm install && npm run build` (no Render, após instalar dependências corre automaticamente o build do React para `backend/public`).
- A API HTTP expõe rotas em **`/api/...`** (o frontend já usa esse prefixo; `/health` continua na raiz).
- **Start Command:** `node scripts/setup-db.js && node src/server.js`
- Defina `DATABASE_URL` (e demais variáveis) no painel do Render. O script `setup-db.js` roda `initDb` antes do servidor subir, criando/atualizando tabelas e colunas conforme `src/config/db.js`.

## Observacao

- O setup do banco também pode ser feito manualmente: na pasta `backend`, `npm run setup:db`.
