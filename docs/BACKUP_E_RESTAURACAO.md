# Backup e restauração (CRM Andy Models)

Este documento descreve o **backup da base de dados** (PostgreSQL) para o **Backblaze B2**, a **retenção** de cópias antigas e como **restaurar** em emergência. O código da aplicação continua a ser o **GitHub**; ficheiros grandes (fotos, áudio) estão no **B2** — o maior risco residual é a **base relacional**, daí o foco do backup.

**Nota de repositório:** não incluímos ficheiros em **`.github/workflows/`** neste projeto. Motivo: pushes com workflows exigem token/credencial com permissão **`workflow`**; muitos PATs bloqueiam. O script `backupDatabaseToB2.js` mantém-se no `backend/scripts/`. Para agendamento automático (ex.: GitHub Actions), **crie o workflow no painel do GitHub** ou cole o YAML do [anexo](#anexo-yaml-github-actions-opcional) quando tiverem permissões — **não** voltar a comitar `.github/workflows/backup-database-weekly.yml` sem alinhar com a equipa.

---

## 1. Que base de dados é esta?

| Ambiente | Tecnologia | Como é acedida |
|----------|------------|----------------|
| **Produção (Render)** | **PostgreSQL** (serviço gerido, ver `render.yaml`) | Variável **`DATABASE_URL`** no serviço Web — **não** é um ficheiro `.sqlite` no disco. |
| **Local** | PostgreSQL (ex.: Docker ou instalado na máquina) | **`DATABASE_URL`** no `backend/.env` (ver `backend/.env.example`). |

**Não existe** `DB_PATH` nem SQLite de produção neste projeto: o backup oficial é **`pg_dump`** sobre `DATABASE_URL`.

---

## 2. Onde ficam os backups no B2?

- **Bucket:** o mesmo configurado em **`B2_BUCKET`** (partilhado com uploads do CRM), num **prefixo dedicado** para não misturar com fotos/rádio.
- **Pasta lógica (prefixo):** `backups/database/` (alterável com `BACKUP_B2_PREFIX`).

Ficheiros por execução:

| Ficheiro | Conteúdo |
|----------|----------|
| `backups/database/crm-backup-YYYY-MM-DD-HHMMSS.sql` | Dump textual PostgreSQL (`pg_dump` formato plain). |
| `backups/database/crm-backup-YYYY-MM-DD-HHMMSS.meta.json` | Metadados: data ISO, tamanho, ambiente, versão da app, commit Git (se disponível), chaves B2 (sem segredos). |

Cada execução gera **um novo par** de ficheiros; **nunca** sobrescreve um backup anterior (o nome inclui data e hora).

---

## 3. Variáveis de ambiente (backup)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Sim | URL `postgresql://...` (no Render use a URL **externa** da base se o backup correr fora do datacenter, p.ex. CI ou máquina local). |
| `STORAGE_DRIVER` | Sim (upload) | Tem de ser **`b2`** para enviar para o B2. |
| `B2_S3_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET` | Sim | Iguais ao CRM em produção. |
| `B2_PUBLIC_BASE_URL` | Sim | Obrigatório para o módulo `storage` gravar no B2 (mesmo valor que no Render). |
| `B2_REGION` | Não | Predefinição usada pelo SDK se omitido. |
| `BACKUP_B2_PREFIX` | Não | Predefinição: `backups/database/`. |
| `BACKUP_RETENTION_KEEP` | Não | Número de backups **mais recentes** a manter (predef.: **12**). Os mais antigos são apagados no B2 após um backup bem-sucedido. |
| `BACKUP_DRY_RUN` | Não | Se `1`, só corre `pg_dump` e copia o `.sql` + `.meta.json` para a pasta `backend/` com sufixo `.dry-run-copy` — **sem** upload. |

**Segurança:** não coloque segredos em issues, commits ou logs. O script **não** imprime `DATABASE_URL` nem chaves B2.

---

## 4. Executar um backup manualmente

Na máquina (com `pg_dump` instalado) ou num runner com PostgreSQL client:

```bash
cd backend
export DATABASE_URL="postgresql://..."   # mesma lógica que o CRM
export STORAGE_DRIVER=b2
export B2_S3_ENDPOINT=...
export B2_KEY_ID=...
export B2_APPLICATION_KEY=...
export B2_BUCKET=...
export B2_PUBLIC_BASE_URL=...
node scripts/backupDatabaseToB2.js
```

Ou via npm:

```bash
cd backend && npm run backup:db-b2
```

Teste sem B2 (só validar dump):

```bash
cd backend
export DATABASE_URL="postgresql://..."
export BACKUP_DRY_RUN=1
node scripts/backupDatabaseToB2.js
```

---

## 5. Agendamento automático (opcional — não está no repo)

Até configurarem um job externo, o backup corre **manualmente** (secção 4): `npm run backup:db-b2` com variáveis exportadas.

### GitHub Actions (quando quiserem ativar)

- **Não** há ficheiro `.github/workflows/...` neste repositório (ver nota no início deste doc).
- No GitHub: **Actions** → **New workflow** → colar YAML (ver [anexo](#anexo-yaml-github-actions-opcional)), ou criar **Scheduled workflow** na UI com os mesmos passos.
- **Secrets:** `DATABASE_URL`, `B2_S3_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_PUBLIC_BASE_URL` (use um PAT ou deploy key com permissão **`workflow`** se adicionarem o ficheiro por Git).
- **Motivo típico para não commitar o workflow:** Personal Access Tokens sem scope `workflow` falham no `git push`.

**Porquê Actions vs Cron só no Render?**

- O serviço Web Render (Node) **não traz** `pg_dump`; instalar `postgresql-client` no build é frágil.
- Um runner Ubuntu com `apt-get install postgresql-client` é estável e não afeta o CRM em produção.

### Alternativa: **Render Cron Job**

- Cron na Render com imagem que inclua **Node + `postgresql-client`**, ou script num contentor, com as mesmas variáveis que o script de backup.

### Alternativa: **cron no servidor ou no vosso Mac**

- `crontab -e` com `cd .../backend && /usr/bin/env DATABASE_URL=... npm run backup:db-b2` (definir todas as env necessárias).

---

## 6. Retenção

- Após cada upload **bem-sucedido**, o script lista backups com o padrão `crm-backup-YYYY-MM-DD-HHMMSS.*` sob `backups/database/`, ordena do **mais recente** para o mais antigo e **apaga** conjuntos a partir do **(BACKUP_RETENTION_KEEP + 1)**-ésimo.
- Predefinição: **12** backups (~12 semanas se o cron for semanal).
- Cada «backup» = par `.sql` + `.meta.json` (apagados os dois).

---

## 7. Restaurar em emergência

### 7.1 Localizar e descarregar um backup

1. Backblaze **B2** → bucket → pasta **`backups/database/`** (ou o prefixo que definiu).
2. Escolha o par pela data no nome: `crm-backup-2026-04-22-143022.sql` (+ `.meta.json` opcional para referência).
3. Descarregue o `.sql` para o computador (UI do B2 ou CLI `b2` / AWS CLI com endpoint S3-compatible).

### 7.2 Restaurar **só a base** (PostgreSQL)

**Atenção:** isto substitui dados na base alvo. Faça pausa no tráfego ou coloque a API em manutenção se puder.

1. Garanta uma base PostgreSQL **vazia ou descartável** (ou a mesma instância se quiser substituir tudo).
2. Com `psql` ou `pg_restore` consoante o formato: aqui o ficheiro é **SQL em texto plano**:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f crm-backup-2026-04-22-143022.sql
   ```

   Se a URL apontar para a base errada, use `-h -U -d` explicitamente.

3. No **Render**, após restaurar na instância ligada ao CRM, **reinicie** o serviço Web (**Manual Deploy** → **Clear build cache & deploy** ou **Restart**) para limpar ligações antigas ao pool.

4. Valide login, listagens críticas e um fluxo (ex.: abrir uma O.S.).

### 7.3 Restaurar **só o código** (GitHub)

- O repositório GitHub é a fonte da verdade do **código**.
- No GitHub: **Commits** → escolha um commit estável → copie o SHA → no clone local:

  ```bash
  git fetch origin
  git checkout SHA_ANTIGO
  ```

- Para **voltar a branch main** com histórico limpo, use **revert** de commits problemáticos ou **reset** num branch de manutenção (evite `git push --force` em `main` partilhada sem acordo).
- **Redeploy no Render:** ligue o deploy ao branch/commit desejado (Deploy → commit específico ou merge na `main` que dispara deploy automático).

### 7.4 Restaurar **código + base**

1. Restaure a **base** para um backup compatível com a **versão do código** que vai correr (idealmente backup feito na mesma época que o commit — ver `.meta.json` → `git_commit` e `app_version`).
2. Faça **checkout** do mesmo commit (ou próximo) no Git.
3. **Deploy** no Render dessa revisão.
4. Reinicie o serviço e teste.

### 7.5 Diferença resumida

| Cenário | O que restaura | Onde |
|--------|----------------|------|
| Só código | Ficheiros TypeScript/JS, frontend, etc. | Git + deploy Render |
| Só base | Tabelas e dados CRM | `psql` + ficheiro `.sql` do B2 |
| Sistema completo | Base + código alinhados | B2 + Git no mesmo «ponto no tempo» lógico |

**Fotos/rádio no B2:** não fazem parte deste script; continuam nas chaves já existentes no bucket. Se precisar de cópia de segurança desses objetos, use políticas de **versionamento/lifecycle** no B2 ou outro job separado.

---

## 8. Referência do commit no backup

- Se o script corre dentro de um clone Git (ex.: GitHub Actions com `checkout`), o ficheiro `.meta.json` inclui **`git_commit`** (hash curto/long).
- No Render **não** há clone do repo no disco do serviço Web por defeito — aí `git_commit` pode vir vazio; use o commit do **deploy** nos logs do Render para correlacionar.

---

## 9. Falhas comuns

| Mensagem / sintoma | Causa provável |
|--------------------|----------------|
| `pg_dump não encontrado` | Instale `postgresql-client` (Ubuntu `apt`; macOS `brew install libpq`; CI: instalar no job). |
| `DATABASE_URL em falta` | Exporte a variável no shell ou nos secrets do CI. |
| `Credenciais B2 incompletas` | Preencha todas as `B2_*` como no CRM. |
| `STORAGE_DRIVER tem de ser b2` | `export STORAGE_DRIVER=b2` para upload. |
| Erro SSL ao ligar ao Postgres | Na URL use `?sslmode=require` (Render costuma exigir). |
| Dump pequeno / vazio | Credenciais erradas ou base errada — não use em produção sem validar. |

---

## 10. Ficheiros relacionados no repositório

- `backend/scripts/backupDatabaseToB2.js` — script principal.
- `backend/package.json` — script `backup:db-b2`.
- Este documento — inclui [anexo YAML](#anexo-yaml-github-actions-opcional) opcional para GitHub Actions **sem** guardar `.github/workflows/` no Git.

Nenhuma rota HTTP do CRM foi alterada para este fluxo: é **infraestrutura** isolada.

---

## Anexo: YAML GitHub Actions (opcional)

Use quando forem criar o workflow **no GitHub** (ou com commit, **só** se o token tiver permissão `workflow`). Copie e ajuste o cron e os secrets.

```yaml
name: Backup base de dados (semanal)

on:
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

concurrency:
  group: backup-database-b2
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - name: Instalar cliente PostgreSQL (pg_dump)
        run: |
          sudo apt-get update -y
          sudo apt-get install -y postgresql-client

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: npm ci (backend, sem postinstall)
        working-directory: backend
        run: npm ci --ignore-scripts

      - name: Executar backup → B2
        working-directory: backend
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          STORAGE_DRIVER: b2
          B2_S3_ENDPOINT: ${{ secrets.B2_S3_ENDPOINT }}
          B2_KEY_ID: ${{ secrets.B2_KEY_ID }}
          B2_APPLICATION_KEY: ${{ secrets.B2_APPLICATION_KEY }}
          B2_BUCKET: ${{ secrets.B2_BUCKET }}
          B2_PUBLIC_BASE_URL: ${{ secrets.B2_PUBLIC_BASE_URL }}
          NODE_ENV: production
        run: node scripts/backupDatabaseToB2.js
```
