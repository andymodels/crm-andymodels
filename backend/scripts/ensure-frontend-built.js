/**
 * Fallback para Render: se a fase de Build não tiver gerado backend/public/,
 * corre `npm run build` antes do servidor. Quando public/index.html já existe
 * (build normal no deploy), sai logo sem custo.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendRoot = path.join(__dirname, '..');
const indexHtml = path.join(backendRoot, 'public', 'index.html');

if (fs.existsSync(indexHtml)) {
  console.log('[ensure-frontend-built] public/index.html OK — build em deploy assumido.');
  process.exit(0);
}

console.warn(
  '[ensure-frontend-built] public/index.html em falta — a executar npm run build (fallback).',
);
console.warn(
  '[ensure-frontend-built] No Render, confirme também o separador Build do deploy (npm install && npm run build).',
);

try {
  execSync('npm run build', { cwd: backendRoot, stdio: 'inherit', env: process.env });
} catch (e) {
  console.error('[ensure-frontend-built] npm run build falhou:', e.message);
  process.exit(1);
}

if (!fs.existsSync(indexHtml)) {
  console.error('[ensure-frontend-built] Ainda sem public/index.html após npm run build.');
  process.exit(1);
}

console.log('[ensure-frontend-built] Frontend gerado em backend/public/.');
