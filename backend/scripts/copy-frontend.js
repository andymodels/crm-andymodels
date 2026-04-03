/**
 * Copia frontend/dist -> backend/public (servido pelo Express na mesma URL da API).
 * Uso: na pasta backend, após `npm run build` no frontend — ver `npm run render-build`.
 */

const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const repoRoot = path.join(backendRoot, '..');
const dist = path.join(repoRoot, 'frontend', 'dist');
const pub = path.join(backendRoot, 'public');

const index = path.join(dist, 'index.html');
if (!fs.existsSync(index)) {
  console.warn(
    '[copy-frontend] frontend/dist não encontrado (corra npm run build no frontend). UI não será servida pela API.',
  );
  process.exit(0);
}

fs.rmSync(pub, { recursive: true, force: true });
fs.cpSync(dist, pub, { recursive: true });
console.log('[copy-frontend] OK: frontend/dist -> backend/public');
