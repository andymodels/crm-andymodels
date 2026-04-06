/**
 * Copiar para o servidor Express do site andymodels.com e registar ANTES de outras rotas
 * que possam capturar /crm (ou depois do static, conforme a ordem que precisares).
 *
 * Redirect 302: andymodels.com/crm -> https://crm-andymodels.onrender.com
 */

const CRM_ORIGIN = 'https://crm-andymodels.onrender.com';

/**
 * @param {import('express').Express} app
 */
function registerCrmRedirect(app) {
  app.get(/^\/crm(\/.*)?$/, (req, res) => {
    const pathname = req.path || '/';
    const after = pathname.replace(/^\/crm\/?/, '').replace(/^\//, '') || '';
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = after ? `${CRM_ORIGIN}/${after}${q}` : `${CRM_ORIGIN}${q}`;
    res.redirect(302, target);
  });
}

module.exports = { registerCrmRedirect, CRM_ORIGIN };
