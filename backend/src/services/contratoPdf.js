const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/** Cache sempre dentro do backend (mesmo path no build e no runtime da Render com rootDir: backend). */
function projectPuppeteerCacheDir() {
  return path.join(__dirname, '..', '..', '.cache', 'puppeteer');
}

/**
 * O default da Render (`/opt/render/.cache/puppeteer`) costuma estar vazio no runtime ou não bater com o build.
 * Forçamos o diretório do projeto para coincidir com `npm run install:chrome` no deploy.
 */
function ensurePuppeteerCacheDir() {
  const local = projectPuppeteerCacheDir();
  const envDir = String(process.env.PUPPETEER_CACHE_DIR || '').trim();
  const isBadGlobalRenderCache =
    envDir === '/opt/render/.cache/puppeteer' || envDir.startsWith('/opt/render/.cache/puppeteer/');
  const onRender = String(process.env.RENDER || '').toLowerCase() === 'true';
  if (onRender || isBadGlobalRenderCache || !envDir) {
    process.env.PUPPETEER_CACHE_DIR = local;
  }
  try {
    fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR, { recursive: true });
  } catch {
    // ignora
  }
}

/** Procura chrome-linux64/chrome (ou similar) baixado pelo Puppeteer. */
function findChromeUnderCache(cacheRoot) {
  if (!cacheRoot || !fs.existsSync(cacheRoot)) return null;
  const stack = [cacheRoot];
  let guard = 0;
  while (stack.length && guard < 5000) {
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
      if (ent.isDirectory()) {
        if (ent.name === 'chrome-linux64') {
          const bin = path.join(p, 'chrome');
          if (fs.existsSync(bin)) return bin;
        }
        if (ent.name.startsWith('chrome-mac')) {
          const macBin = path.join(
            p,
            'Google Chrome for Testing.app',
            'Contents',
            'MacOS',
            'Google Chrome for Testing',
          );
          if (fs.existsSync(macBin)) return macBin;
        }
        stack.push(p);
      }
    }
  }
  return null;
}

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveExecutablePath() {
  const fromEnv = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
  if (fromEnv && fileExists(fromEnv)) return fromEnv;

  ensurePuppeteerCacheDir();

  const fromPuppeteer = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : '';
  if (fromPuppeteer && fileExists(fromPuppeteer)) return fromPuppeteer;

  const underProject = findChromeUnderCache(projectPuppeteerCacheDir());
  if (underProject && fileExists(underProject)) return underProject;

  return undefined;
}

async function renderContratoPdfBuffer(html) {
  let browser = null;
  try {
    ensurePuppeteerCacheDir();
    const executablePath = resolveExecutablePath();
    browser = await puppeteer.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--single-process',
      ],
    });
    const page = await browser.newPage();
    await page.setContent(String(html || ''), { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '25mm',
        left: '20mm',
      },
    });
  } catch (e) {
    const err = new Error(
      `Falha ao gerar PDF do contrato (Chromium/Puppeteer): ${e?.message || 'erro desconhecido'}.`,
    );
    err.code = 'PDF_GENERATION_FAILED';
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  renderContratoPdfBuffer,
};
