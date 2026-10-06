import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp, setupSchema } from './src/index.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = process.env.DB_PATH || ':memory:';

const db = new DatabaseSync(DB_PATH);
setupSchema(db);

const handle = createApp(db);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    const parsedBody = body ? JSON.parse(body) : {};
    const request = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: parsedBody,
    };
    const response = handle(request);
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.payload));
  });
});

server.listen(PORT, () => {
  console.log(`slow-api listening on http://localhost:${PORT}`);
});
