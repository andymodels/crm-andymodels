Redirect: andymodels.com/crm -> https://crm-andymodels.onrender.com

Este CRM corre noutro dominio (Render). O site principal (andymodels.com) deve aplicar
o redirect no SEU hosting.

Express (Node): ver express-inline-snippet.js ou importar registerCrmRedirect de express-crm-redirect.js
Outros: ver vercel.json, netlify.toml, nginx, htaccess, cloudflare.txt

302 = temporario | 301 = permanente (melhor para SEO se o endereco for definitivo)
