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

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (pool) return next();
  res.status(503).json({
    message:
      'Base de dados indisponível. Configure DATABASE_URL (variável de ambiente).',
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Rotas da API só em /api — evita conflito com express.static (SPA) no /
app.use('/api', cadastrosRouter);
app.use('/api', orcamentosRouter);
app.use('/api', ordensServicoRouter);
app.use('/api', osDocumentosRouter);
app.use('/api', dashboardRouter);
app.use('/api', extratoModeloRouter);
app.use('/api', financeiroRouter);

const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
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
  if (error.code === '23502') {
    return res.status(400).json({
      message: `Campo obrigatorio no banco: ${error.column || 'desconhecido'}.`,
    });
  }
  if (error.code === '23503') {
    return res.status(400).json({ message: 'Referencia invalida (registro ligado nao existe).' });
  }
  if (error.code === '42703') {
    return res.status(400).json({ message: 'Coluna invalida no pedido (verifique versao do sistema).' });
  }
  if (error.code && String(error.code).startsWith('23')) {
    return res.status(400).json({
      message: error.detail || error.message || 'Erro de validacao no banco de dados.',
    });
  }
  res.status(500).json({ message: 'Erro interno no servidor.' });
});

module.exports = app;
