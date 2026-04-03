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

app.get('/', (_req, res) => {
  res.json({
    service: 'Andy Models CRM API',
    health: '/health',
    note: 'A interface web é o frontend (Vite/React); esta URL é só a API.',
  });
});

app.use('/api', cadastrosRouter);
app.use('/', cadastrosRouter);
app.use('/api', orcamentosRouter);
app.use('/', orcamentosRouter);
app.use('/api', ordensServicoRouter);
app.use('/', ordensServicoRouter);
app.use('/api', osDocumentosRouter);
app.use('/', osDocumentosRouter);
app.use('/api', dashboardRouter);
app.use('/', dashboardRouter);
app.use('/api', extratoModeloRouter);
app.use('/', extratoModeloRouter);
app.use('/api', financeiroRouter);
app.use('/', financeiroRouter);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Erro interno no servidor.' });
});

module.exports = app;
