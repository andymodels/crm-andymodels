/**
 * No Render, após `npm install` no backend, gera frontend/dist e copia para backend/public.
 * - RENDER=true: ambiente Web Service Render (runtime e, em geral, build).
 * - CI=true: o Render define durante o build; cobre o caso de RENDER não estar definido no painel.
 * Local: não corre (evita compilar o front a cada npm install).
 */

const { execSync } = require('child_process');
const path = require('path');

const isRenderLike =
  process.env.RENDER === 'true' || process.env.CI === 'true';

if (!isRenderLike) {
  process.exit(0);
}

const backendRoot = path.join(__dirname, '..');
const frontendPkg = path.join(backendRoot, '..', 'frontend', 'package.json');
const fs = require('fs');
if (!fs.existsSync(frontendPkg)) {
  console.warn('[postinstall-build-web] frontend/ não encontrado — ignorado.');
  process.exit(0);
}

console.log('[postinstall-build-web] Render: a compilar React e copiar para public/...');
try {
  execSync(
    'node scripts/clean-web-artifacts.js && npm install --prefix ../frontend && npm run build --prefix ../frontend && node scripts/copy-frontend.js',
    { cwd: backendRoot, stdio: 'inherit', env: { ...process.env } },
  );
} catch (e) {
  console.error('[postinstall-build-web] Falhou:', e.message);
  process.exit(1);
}
