import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { routes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serve(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const filePath = path.join(distDir, url);
  const safe = path.normalize(filePath).startsWith(path.normalize(distDir));
  if (!safe || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const fallback = path.join(distDir, 'index.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(fallback));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

async function main() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir}; run the build first`);
  }

  const server = createServer(serve);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const t0 = performance.now();
  await page.goto(baseUrl + '/');
  await page.waitForSelector(`text=${routes[0].marker}`, { timeout: 10000 });
  const bootMs = performance.now() - t0;

  for (const route of routes) {
    await page.goto(`${baseUrl}/#${route.path}`);
    await page.waitForSelector(`text=${route.marker}`, { timeout: 10000 });
  }

  await browser.close();
  server.close();

  console.log(`Booted ${routes.length} routes in ${bootMs.toFixed(1)} ms`);
  console.log(`METRIC boot_ms=${Math.round(bootMs)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
