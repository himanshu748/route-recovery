import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startRouteServer } from '../src/route/server.js';

const execute = promisify(execFile);
const serverFile = fileURLToPath(new URL('../src/route/server.js', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'route-server-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public/index.html'), '<!doctype html><title>Route fixture</title>');
  await writeFile(path.join(root, 'public/styles.css'), 'body { color: black; }');
  await writeFile(path.join(root, 'public/app.js'), 'export const fixture = true;');
  await writeFile(path.join(root, 'core.js'), 'export const core = true;');
  await writeFile(path.join(root, 'scenarios.js'), 'export const scenarios = [];');
  await writeFile(path.join(root, 'private.txt'), 'Must never be served.');
  return root;
}

function request(url, target, method = 'GET') {
  const address = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: address.hostname, port: address.port, path: target, method, headers: { Connection: 'close' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function serve(t, root) {
  const running = await startRouteServer({ port: 0, root });
  t.after(running.close);
  return running;
}

test('allowlisted GET assets return actual content and appropriate content types', async (t) => {
  const root = await fixture(t);
  const running = await serve(t, root);
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(new URL(running.url).port, '0');
  for (const [target, type, content] of [
    ['/', 'text/html', 'Route fixture'],
    ['/styles.css', 'text/css', 'color: black'],
    ['/app.js', 'text/javascript', 'fixture = true'],
    ['/core.js', 'text/javascript', 'core = true'],
    ['/scenarios.js', 'text/javascript', 'scenarios = []'],
  ]) {
    const response = await request(running.url, target);
    assert.equal(response.status, 200);
    assert.ok(response.headers['content-type'].startsWith(type));
    assert.ok(response.body.includes(content));
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['cache-control'], /no-store/);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.match(response.headers['content-security-policy'], /style-src-attr 'unsafe-inline'/);
  }
  assert.equal((await request(running.url, '/core.js?v=1')).status, 200);
});

test('HEAD matches GET metadata and returns no body including for missing files', async (t) => {
  const running = await serve(t, await fixture(t));
  const get = await request(running.url, '/');
  const head = await request(running.url, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], get.headers['content-length']);
  assert.equal(head.headers['content-type'], get.headers['content-type']);
  const missing = await request(running.url, '/missing', 'HEAD');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, '');
});

test('unknown, encoded, and traversal paths cannot access files outside the allowlist', async (t) => {
  const running = await serve(t, await fixture(t));
  for (const target of ['/private.txt', '/public/index.html', '/server.js', '/../core.js', '/%2e%2e/core.js', '/%63ore.js', '//core.js', '/core.js/extra', '/core.js%00']) {
    const response = await request(running.url, target);
    assert.equal(response.status, 404, target);
    assert.equal(response.body, 'Not found.\n');
  }
});

test('unsupported HTTP methods receive 405 with the allowed methods', async (t) => {
  const running = await serve(t, await fixture(t));
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
    const response = await request(running.url, '/', method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET, HEAD');
    assert.equal(response.body, 'Method not allowed.\n');
  }
});

test('missing and unreadable asset errors stay bounded and do not disclose filesystem paths', async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, 'core.js'));
  await rm(path.join(root, 'scenarios.js'));
  await mkdir(path.join(root, 'scenarios.js'));
  const running = await serve(t, root);
  assert.equal((await request(running.url, '/core.js')).status, 404);
  const unreadable = await request(running.url, '/scenarios.js');
  assert.equal(unreadable.status, 500);
  assert.equal(unreadable.body, 'Asset unavailable.\n');
  assert.ok(!unreadable.body.includes(root));
  assert.equal((await request(running.url, '/')).status, 200);
});

test('port and loopback host validation reject invalid values before listening', async () => {
  for (const port of [-1, 65536, 1.5, '4180', NaN, Infinity, null]) {
    await assert.rejects(startRouteServer({ port }), /port must be an integer/);
  }
  await assert.rejects(startRouteServer({ port: 0, host: '0.0.0.0' }), /must bind to 127\.0\.0\.1/);
});

test('startup errors reject cleanly and close is idempotent', async (t) => {
  const root = await fixture(t);
  const running = await serve(t, root);
  const port = Number(new URL(running.url).port);
  await assert.rejects(startRouteServer({ port, root }), { code: 'EADDRINUSE' });
  await running.close();
  await running.close();
  await assert.rejects(request(running.url, '/'), { code: 'ECONNREFUSED' });
});

test('standalone CLI rejects malformed ROUTE_PORT values', async () => {
  for (const value of ['65536', '-1', '4.5', '4e3', '', ' 4180', '04180']) {
    await assert.rejects(execute(process.execPath, [serverFile], { env: { ...process.env, ROUTE_PORT: value } }),
      (error) => error.code === 1 && /ROUTE_PORT must be an integer/.test(error.stderr));
  }
});

test('standalone CLI prints its actual ephemeral URL and exits cleanly on SIGTERM', async (t) => {
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, ROUTE_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`CLI did not print a URL: ${stderr}`)), 15000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`CLI exited before startup: ${stderr}`)); });
  });
  assert.notEqual(new URL(url).port, '0');
  assert.equal((await request(url, '/unknown')).status, 404);
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(stderr, '');
});
