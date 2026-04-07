const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function ensurePuppeteerCacheDir() {
  const current = String(process.env.PUPPETEER_CACHE_DIR || '').trim();
  if (!current) {
    // Fallback local (gravável no Render e em dev), evita depender de /opt/render/.cache
    process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', '.cache', 'puppeteer');
  }
  try {
    fs.mkdirSync(process.env.PUPPETEER_CACHE_DIR, { recursive: true });
  } catch {
    // ignora falha de mkdir; o launch vai reportar erro claro se necessário
  }
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

  const fromPuppeteer = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : '';
  if (fromPuppeteer && fileExists(fromPuppeteer)) return fromPuppeteer;

  // Sem caminho válido: deixa o Puppeteer decidir automaticamente.
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
