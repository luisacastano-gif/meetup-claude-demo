import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_PATTERN = /^[A-Za-z0-9]{6}$/;
const MAX_URL_LENGTH = 2048;
const MAX_BODY_BYTES = 10 * 1024;
const MAX_CODE_ATTEMPTS = 5;

// Static files are served from this fixed list only; paths are never built from user input.
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'Please enter a URL.');
  }
  const input = value.trim();
  if (input.length > MAX_URL_LENGTH) {
    throw new HttpError(400, `That URL is too long (maximum ${MAX_URL_LENGTH} characters).`);
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new HttpError(400, 'That doesn’t look like a valid URL. Include https:// at the start.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Only http:// and https:// URLs can be shortened.');
  }
  return parsed.href;
}

// Reads with events instead of `for await`: bailing out of an async iterator destroys the
// socket, and we want to drain the oversized body so the client still receives the 413.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Request is too large.'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON like {"url": "https://example.com"}.'));
      }
    });
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNotFoundPage(res) {
  const page = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Not found</title><link rel="stylesheet" href="/style.css">'
    + '<main class="card"><h1>Link not found</h1><p>This short link doesn’t exist.</p><p><a href="/">Create a new one</a></p></main>';
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

export function createApp({ dbPath = join(ROOT, 'data', 'links.db') } = {}) {
  const db = openDatabase(dbPath);
  const findByCode = db.prepare('SELECT url FROM links WHERE code = ?');
  const findByUrl = db.prepare('SELECT code FROM links WHERE url = ?');
  const insert = db.prepare('INSERT INTO links (code, url, created_at) VALUES (?, ?, ?)');

  const staticCache = new Map();
  function readStatic(name) {
    if (!staticCache.has(name)) staticCache.set(name, readFileSync(join(ROOT, 'public', name)));
    return staticCache.get(name);
  }

  function shortenUrl(url) {
    const existing = findByUrl.get(url);
    if (existing) return { code: existing.code, created: false };
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode();
      if (findByCode.get(code)) continue;
      insert.run(code, url, new Date().toISOString());
      return { code, created: true };
    }
    throw new Error('Could not generate a unique code');
  }

  async function handleCreate(req, res) {
    const body = await readJsonBody(req);
    const url = validateUrl(body?.url);
    const { code, created } = shortenUrl(url);
    const shortUrl = `http://${req.headers.host}/${code}`;
    sendJson(res, created ? 201 : 200, { code, shortUrl });
  }

  async function route(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && pathname === '/api/links') {
      return handleCreate(req, res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = STATIC_FILES[pathname];
      if (asset) {
        res.writeHead(200, { 'Content-Type': asset.type });
        return res.end(readStatic(asset.file));
      }
      const code = pathname.slice(1);
      if (CODE_PATTERN.test(code)) {
        const row = findByCode.get(code);
        if (row) {
          res.writeHead(302, { Location: row.url });
          return res.end();
        }
      }
      return sendNotFoundPage(res);
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  const server = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message });
      }
      console.error(`Unexpected error handling ${req.method} ${req.url}:`, err);
      sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`URL shortener running at http://localhost:${port}`);
  });
}
