/**
 * No Render, após `npm install` no backend, gera frontend/dist e copia para backend/public.
 * Variável RENDER=true no ambiente do Render (não corre em npm install local).
 */

const { execSync } = require('child_process');
const path = require('path');

if (process.env.RENDER !== 'true') {
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
    'npm install --prefix ../frontend && npm run build --prefix ../frontend && node scripts/copy-frontend.js',
    { cwd: backendRoot, stdio: 'inherit', env: { ...process.env } },
  );
} catch (e) {
  console.error('[postinstall-build-web] Falhou:', e.message);
  process.exit(1);
}
