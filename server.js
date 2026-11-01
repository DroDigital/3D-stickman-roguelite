// Zero-dependency static dev server: `node server.js [port]`
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  // null bytes make fs APIs throw synchronously, which would take the whole server down
  if (url.includes('\0')) {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
  // require a path-separator boundary so sibling directories sharing the root's name prefix are refused
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`Abyssal Stride running at http://localhost:${port}`));
