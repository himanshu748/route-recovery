import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROUTE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const ASSETS = new Map([
  ['/', { file: 'public/index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { file: 'public/styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { file: 'public/app.js', type: 'text/javascript; charset=utf-8' }],
  ['/recovery.js', { file: 'public/recovery.js', type: 'text/javascript; charset=utf-8' }],
  ['/fonts.css', { file: '../desk/public/fonts.css', type: 'text/css; charset=utf-8' }],
  ['/motion.js', { file: '../desk/public/motion.js', type: 'text/javascript; charset=utf-8' }],
  ['/fonts/manrope.woff2', { file: '../desk/public/fonts/manrope.woff2', type: 'font/woff2' }],
  ['/core.js', { file: 'core.js', type: 'text/javascript; charset=utf-8' }],
  ['/scenarios.js', { file: 'scenarios.js', type: 'text/javascript; charset=utf-8' }],
]);

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function send(response, method, status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  });
  response.end(method === 'HEAD' ? undefined : body);
}

/** Serve only the named demo assets. root is injectable for isolated tests. */
export async function startRouteServer({ port = 4180, host = '127.0.0.1', root = ROUTE_ROOT } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Route port must be an integer from 0 through 65535.');
  if (host !== '127.0.0.1') throw new Error('Route server must bind to 127.0.0.1.');
  if (typeof root !== 'string' || !root) throw new Error('Route asset root must be a nonempty directory path.');
  const assetRoot = path.resolve(root);
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') {
      send(response, method, 405, 'Method not allowed.\n', undefined, { Allow: 'GET, HEAD' });
      return;
    }
    // Match the raw path rather than decode or normalize user-supplied paths.
    // Query strings are harmless cache/version parameters on an allowed asset.
    const requestPath = (request.url ?? '').split('?', 1)[0];
    const asset = ASSETS.get(requestPath);
    if (!asset) {
      send(response, method, 404, 'Not found.\n');
      return;
    }
    try {
      const content = await readFile(path.join(assetRoot, asset.file));
      send(response, method, 200, content, asset.type);
    } catch (error) {
      const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
      send(response, method, missing ? 404 : 500, missing ? 'Not found.\n' : 'Asset unavailable.\n');
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const address = server.address();
  let closePromise;
  const close = () => {
    closePromise ??= new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
    });
    return closePromise;
  };
  return { server, url: `http://${host}:${address.port}`, close };
}

function configuredPort(value) {
  if (value === undefined) return 4180;
  if (!/^(?:0|[1-9]\d{0,4})$/.test(value) || Number(value) > 65535) {
    throw new Error('ROUTE_PORT must be an integer from 0 through 65535.');
  }
  return Number(value);
}

const isStandalone = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isStandalone) {
  try {
    const running = await startRouteServer({ port: configuredPort(process.env.ROUTE_PORT) });
    process.stdout.write(`Route Recovery is available at ${running.url}\n`);
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => running.server.closeAllConnections(), 5000);
      deadline.unref();
      running.close().then(() => clearTimeout(deadline), (error) => {
        clearTimeout(deadline);
        process.stderr.write(`Route Recovery shutdown failed: ${error.message}\n`);
        process.exitCode = 1;
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    process.stderr.write(`Route Recovery could not start: ${error.message}\n`);
    process.exitCode = 1;
  }
}
