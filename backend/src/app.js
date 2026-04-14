const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { pool } = require('./config/db');
const cadastrosRouter = require('./routes/cadastros');
const orcamentosRouter = require('./routes/orcamentos');
const ordensServicoRouter = require('./routes/ordens_servico');
const osDocumentosRouter = require('./routes/os_documentos');
const dashboardRouter = require('./routes/dashboard');
const extratoModeloRouter = require('./routes/extrato_modelo');
const financeiroRouter = require('./routes/financeiro');
const publicCadastroModeloRouter = require('./routes/publicCadastroModelo');
const publicCadastroClienteRouter = require('./routes/publicCadastroCliente');
const cadastroLinksRouter = require('./routes/cadastroLinks');
const authRouter = require('./routes/auth');
const { requireAdminAuth } = require('./middleware/requireAdminAuth');
const modeloPortalRouter = require('./routes/modeloPortal');
const publicContratoAssinaturaRouter = require('./routes/publicContratoAssinatura');
const publicAgendaPresencaRouter = require('./routes/publicAgendaPresenca');
const agendaRouter = require('./routes/agenda');
const websiteModelsRouter = require('./routes/websiteModels');
const websiteInstagramRouter = require('./routes/websiteInstagram');
const publicRadioRouter = require('./routes/publicRadio');
const radioRouter = require('./routes/radio');
const publicApplicationsRouter = require('./routes/publicApplications');
const { UPLOAD_ROOT } = require('./services/storage');

const app = express();

/** Render / proxies: necessário para req.path e redirects corretos com HTTPS. */
app.set('trust proxy', 1);

/**
 * /crm -> CRM público (mesmo stack). Destino: PUBLIC_APP_URL (ex.: https://crm-andymodels.onrender.com).
 */
const crmPublicBase = String(process.env.PUBLIC_APP_URL || 'https://crm-andymodels.onrender.com').replace(
  /\/$/,
  '',
);

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const pathname = req.path || '/';
  if (!pathname.startsWith('/crm')) return next();
  const after = pathname.replace(/^\/crm\/?/, '').replace(/^\//, '') || '';
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = after ? `${crmPublicBase}/${after}${q}` : `${crmPublicBase}${q}`;
  return res.redirect(302, target);
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '300mb' }));
app.use(express.urlencoded({ limit: '300mb', extended: true }));
/** Ficheiros gravados em uploads/ (driver local); mantido em paralelo a storage externa (B2). */
try {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
} catch (_e) {
  /* ignorar; saveFile também cria subpastas */
}
app.use('/uploads', express.static(UPLOAD_ROOT));

if (String(process.env.DEBUG_CRM_ROUTES || '').trim() === '1') {
  app.use((req, res, next) => {
    if (String(req.path || '').startsWith('/api')) {
      console.log('ROTA RECEBIDA:', req.method, req.originalUrl || req.url);
    }
    next();
  });
}

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  // Identidade da API sem DB (útil para ver se a porta 3001 é mesmo este projeto)
  if (req.method === 'GET' && req.path === '/api') return next();
  if (pool) return next();
  res.status(503).json({
    message:
      'Base de dados indisponível. Configure DATABASE_URL (variável de ambiente).',
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'ok', service: 'andy-models-crm' });
});

/** Confirma que este processo é o CRM (outro Express na mesma porta devolve 404 em POST /api/...). */
app.get('/api', (_req, res) => {
  res.json({ ok: true, service: 'andy-models-crm' });
});

// Rotas públicas
app.use('/api', publicCadastroModeloRouter);
app.use('/api', publicCadastroClienteRouter);
app.use('/api', authRouter);
app.use('/api', modeloPortalRouter);
app.use('/api', publicContratoAssinaturaRouter);
app.use('/api', publicAgendaPresencaRouter);
app.use('/api', publicApplicationsRouter);
app.use('/api', publicRadioRouter);

// Restante da API exige sessão admin
app.use('/api', requireAdminAuth);
app.use('/api', cadastrosRouter);
app.use('/api', orcamentosRouter);
app.use('/api', ordensServicoRouter);
app.use('/api', osDocumentosRouter);
app.use('/api', dashboardRouter);
app.use('/api', extratoModeloRouter);
app.use('/api', financeiroRouter);
app.use('/api', cadastroLinksRouter);
app.use('/api', agendaRouter);
app.use('/api', websiteModelsRouter);
app.use('/api', websiteInstagramRouter);
app.use('/api', radioRouter);

/** Pedidos /api sem rota: JSON (evita 404 em HTML e confunde o frontend). */
app.use('/api', (req, res) => {
  res.status(404).json({
    message: `Rota nao encontrada no CRM: ${req.method} ${req.originalUrl || req.url}`,
  });
});

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => (err ? next(err) : undefined));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      service: 'Andy Models CRM API',
      health: '/health',
      dev: {
        recomendado:
          'Dois terminais: (1) cd backend && npm run dev  (2) cd frontend && npm run dev — abra http://localhost:5173 (VITE_API_URL=http://localhost:3001 no frontend/.env).',
        umaPortaSo:
          'Na pasta backend: npm run build (compila o React e gera backend/public). Depois atualize esta página.',
      },
    });
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Arquivo muito grande. Reduza a foto de perfil e tente novamente.',
    });
  }
  if (error.code === '23502') {
    return res.status(400).json({
      message: `Campo obrigatorio no banco: ${error.column || 'desconhecido'}.`,
    });
  }
  if (error.code === '23503') {
    const d = String(error.detail || error.message || '');
    const bloqueioPorLigacao =
      d.includes('still referenced') || d.includes('update or delete on table');
    return res.status(bloqueioPorLigacao ? 409 : 400).json({
      message: bloqueioPorLigacao
        ? 'Nao e possivel excluir ou alterar: ainda existem registros ligados (orcamentos, ordens de servico, etc.). Ajuste ou apague esses dados primeiro.'
        : 'Referencia invalida: registro ligado inexistente ou nao permitido.',
    });
  }
  if (error.code === '42703') {
    return res.status(400).json({ message: 'Coluna invalida no pedido (verifique versao do sistema).' });
  }
  if (error.code && String(error.code).startsWith('23')) {
    return res.status(400).json({
      message: error.detail || error.message || 'Erro de validacao no banco de dados.',
    });
  }
  /** Erros PostgreSQL (ex.: 22P02, 42P01, 42703) — antes caíam no 500 genérico e impossibilitavam diagnóstico. */
  if (error.code && /^[0-9]{2}[0-9A-Z]{3}$/.test(String(error.code))) {
    return res.status(400).json({
      message: String(error.detail || error.message || 'Erro na base de dados.'),
      codigo_bd: error.code,
    });
  }
  const mostrarDetalhe =
    process.env.NODE_ENV !== 'production' || String(process.env.RENDER || '').toLowerCase() === 'true';
  res.status(500).json({
    message: 'Erro interno no servidor.',
    ...(mostrarDetalhe && error?.message
      ? { detalhe_tecnico: String(error.message).slice(0, 800) }
      : {}),
  });
});

module.exports = app;
