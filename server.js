import { createServer as createHttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { createLinks } from './src/links.js';

const MAX_BODY_BYTES = 10 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// Fixed allowlist: only these files are ever served, loaded once at startup.
function loadAsset(file, contentType) {
  return { body: readFileSync(new URL(`./public/${file}`, import.meta.url)), contentType };
}
const ASSETS = {
  '/': loadAsset('index.html', 'text/html; charset=utf-8'),
  '/style.css': loadAsset('style.css', 'text/css; charset=utf-8'),
  '/app.js': loadAsset('app.js', 'text/javascript; charset=utf-8'),
};
const NOT_FOUND_PAGE = loadAsset('404.html', 'text/html; charset=utf-8');

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendAsset(res, status, asset, method) {
  send(res, status, { 'Content-Type': asset.contentType }, method === 'HEAD' ? undefined : asset.body);
}

// Resolves to { json }, { tooLarge: true } or { invalid: true }.
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      req.resume();
      return resolve({ tooLarge: true });
    }
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ tooLarge: true });
      try {
        resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ invalid: true });
      }
    });
    req.on('error', reject);
  });
}

// Creates the server without listening, so tests can listen on port 0.
export function createServer({ dbPath, baseUrl, generateCode }) {
  const db = openDb(dbPath);
  const links = createLinks(db, { generateCode });
  const configuredHost = baseUrl ? new URL(baseUrl).host : undefined;

  async function handleShorten(req, res, ownHosts) {
    const body = await readJson(req);
    if (body.tooLarge) {
      res.setHeader('Connection', 'close');
      return sendError(res, 413, 'That request is too large. Use a shorter URL.');
    }
    if (body.invalid) return sendError(res, 400, 'Send a JSON body like {"url": "https://..."}.');

    const result = links.shorten(body.json?.url, ownHosts);
    if (result.error) return sendError(res, 400, result.error);

    const base = baseUrl ?? `http://${ownHosts[0]}`;
    sendJson(res, 200, { code: result.code, shortUrl: `${base.replace(/\/$/, '')}/${result.code}` });
  }

  const server = createHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://placeholder');
    const ownHosts = [req.headers.host ?? 'localhost', configuredHost].filter(Boolean);
    try {
      if (pathname === '/shorten') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return sendError(res, 405, 'Use POST to shorten a URL.');
        }
        return await handleShorten(req, res, ownHosts);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return sendError(res, 405, 'Method not allowed.');
      }

      const asset = Object.hasOwn(ASSETS, pathname) ? ASSETS[pathname] : undefined;
      if (asset) return sendAsset(res, 200, asset, req.method);

      const target = links.resolve(pathname.slice(1));
      if (target) return send(res, 302, { Location: target });
      return sendAsset(res, 404, NOT_FOUND_PAGE, req.method);
    } catch (err) {
      console.error(`unhandled error: ${req.method} ${pathname}`, err);
      if (res.headersSent) return res.end();
      sendError(res, 500, 'Something went wrong. Please try again.');
    }
  });

  server.on('close', () => db.close());
  return server;
}
