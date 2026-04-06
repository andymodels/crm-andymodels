// Colar no ficheiro principal do Express do andymodels.com (ajustar ordem dos middlewares).

const CRM = 'https://crm-andymodels.onrender.com';

app.get(/^\/crm(\/.*)?$/, (req, res) => {
  const pathname = req.path || '/';
  const after = pathname.replace(/^\/crm\/?/, '').replace(/^\//, '') || '';
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = after ? `${CRM}/${after}${q}` : `${CRM}${q}`;
  res.redirect(302, target);
});
