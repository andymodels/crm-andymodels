/**
 * Render / produção: garante Chromium na cache do projeto (backend/.cache/puppeteer).
 * Se o build não tiver deixado o binário acessível (cache global vazia, variável errada no painel),
 * corre `npm run install:chrome` uma vez no arranque.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendRoot = path.join(__dirname, '..');
const cacheDir = path.join(backendRoot, '.cache', 'puppeteer');

process.env.PUPPETEER_CACHE_DIR = cacheDir;

function findChromeLinux64(cacheRoot) {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return null;
  const stack = [cacheRoot];
  let guard = 0;
  while (stack.length && guard < 8000) {
    guard += 1;
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (!ent.isDirectory()) continue;
      if (ent.name === 'chrome-linux64') {
        const bin = path.join(p, 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
      stack.push(p);
    }
  }
  return null;
}

function chromeOk() {
  const manual = findChromeLinux64(cacheDir);
  if (manual && fs.existsSync(manual)) return true;
  try {
    const puppeteer = require('puppeteer');
    const ep = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : '';
    return Boolean(ep && fs.existsSync(ep));
  } catch {
    return false;
  }
}

if (chromeOk()) {
  console.log('[ensure-puppeteer-chrome] Chromium OK.');
  process.exit(0);
}

console.warn('[ensure-puppeteer-chrome] Chromium em falta — a instalar (pode demorar na primeira vez)...');
try {
  fs.mkdirSync(cacheDir, { recursive: true });
  execSync('npm run install:chrome', {
    cwd: backendRoot,
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir },
  });
} catch (e) {
  console.error('[ensure-puppeteer-chrome] install:chrome falhou:', e.message);
  process.exit(1);
}

if (!chromeOk()) {
  console.error('[ensure-puppeteer-chrome] Chromium ainda em falta após install:chrome.');
  process.exit(1);
}

console.log('[ensure-puppeteer-chrome] Chromium instalado com sucesso.');
