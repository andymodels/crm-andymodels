/**
 * Remove `frontend/dist` e `backend/public` antes de compilar o CRM.
 * Evita que um deploy copie uma pasta `public/` antiga ou um `dist` parcial e continue
 * a servir JavaScript desatualizado (ex.: mensagens de erro já removidas do código-fonte).
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const repoRoot = path.join(backendRoot, '..');

function rmDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignorar */
  }
}

rmDir(path.join(repoRoot, 'frontend', 'dist'));
rmDir(path.join(backendRoot, 'public'));
console.log('[clean-web-artifacts] frontend/dist e backend/public limpos (se existiam).');
