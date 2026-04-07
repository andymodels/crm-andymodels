const puppeteer = require('puppeteer');
const path = require('path');

function ensurePuppeteerCacheDir() {
  if (process.env.PUPPETEER_CACHE_DIR && String(process.env.PUPPETEER_CACHE_DIR).trim() !== '') return;
  // Fallback local (gravável no Render e em dev), evita depender de /opt/render/.cache
  process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', '.cache', 'puppeteer');
}

async function renderContratoPdfBuffer(html) {
  let browser = null;
  try {
    ensurePuppeteerCacheDir();
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH || (typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : undefined);
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
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
