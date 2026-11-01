import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function get(port, url) {
  return new Promise((resolve, reject) => {
    // send the raw path so traversal and escape sequences reach the server unnormalized
    const req = http.request({ host: '127.0.0.1', port, path: url, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('dev server rejects hostile paths without crashing', async () => {
  const port = 9100 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await get(port, '/%00'), 400);
    assert.equal(await get(port, '/src/%00main.js'), 400);
    assert.equal(await get(port, '/%ZZ'), 400);
    assert.equal(await get(port, `/../${path.basename(root)}-x/secret.txt`), 403);
    assert.equal(await get(port, '/../../etc/passwd'), 403);
    assert.equal(await get(port, '/missing.js'), 404);
    // still alive and serving after the bad requests
    assert.equal(await get(port, '/'), 200);
    assert.equal(await get(port, '/src/main.js'), 200);
    assert.equal(server.exitCode, null);
  } finally {
    server.kill();
  }
});
