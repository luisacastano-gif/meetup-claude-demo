import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

// Codes are handed out from this queue first, so tests can force collisions.
const forcedCodes = [];
let tempDir, server, base;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'shortener-'));
  server = createServer({
    dbPath: join(tempDir, 'links.db'),
    generateCode: () => forcedCodes.shift() ?? Math.random().toString(36).slice(2, 9).padEnd(7, '0'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
});

const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/shorten`, { method: 'POST', headers, body });

const shorten = (url) => post(JSON.stringify({ url }));

test('shortens a URL and redirects to the original', async () => {
  const res = await shorten('https://example.com/some/long/path?q=1');
  assert.equal(res.status, 200);
  const { code, shortUrl } = await res.json();
  assert.equal(shortUrl, `${base}/${code}`);

  const redirect = await fetch(shortUrl, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/some/long/path?q=1');
});

test('uses a 7-character alphanumeric code from the real generator', async () => {
  // Fresh server using the default generator.
  const dir = mkdtempSync(join(tmpdir(), 'shortener-'));
  const real = createServer({ dbPath: join(dir, 'links.db') });
  await new Promise((resolve) => real.listen(0, resolve));
  try {
    const res = await fetch(`http://localhost:${real.address().port}/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/real' }),
    });
    assert.match((await res.json()).code, /^[0-9A-Za-z]{7}$/);
  } finally {
    await new Promise((resolve) => real.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the same code when the same URL is shortened twice', async () => {
  const a = await (await shorten('https://example.com/dup')).json();
  const b = await (await shorten('https://example.com/dup')).json();
  assert.equal(a.code, b.code);
});

test('retries with a new code when the generated code is already taken', async () => {
  forcedCodes.push('Taken01');
  const first = await (await shorten('https://example.com/first')).json();
  assert.equal(first.code, 'Taken01');

  forcedCodes.push('Taken01', 'Free002');
  const second = await (await shorten('https://example.com/second')).json();
  assert.equal(second.code, 'Free002');

  const redirect = await fetch(`${base}/Taken01`, { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), 'https://example.com/first');
});

test('rejects invalid input with a 400 and an actionable message', async () => {
  const bad = ['', '   ', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com', 42, null];
  for (const url of bad) {
    const res = await shorten(url);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(url)}`);
    assert.ok((await res.json()).error);
  }
});

test('rejects URLs longer than 2048 characters', async () => {
  const res = await shorten(`https://example.com/${'a'.repeat(2048)}`);
  assert.equal(res.status, 400);
});

test('rejects links that point back to the shortener', async () => {
  const res = await shorten(`${base}/abc1234`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /already points to this shortener/);
});

test('rejects malformed JSON with a 400', async () => {
  const res = await post('{nope');
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('answers 413 when the body is too large, without dropping the connection', async () => {
  const res = await post(JSON.stringify({ url: `https://example.com/${'a'.repeat(50_000)}` }));
  assert.equal(res.status, 413);
  assert.ok((await res.json()).error);
});

test('rejects non-POST requests to /shorten with 405', async () => {
  const res = await fetch(`${base}/shorten`);
  assert.equal(res.status, 405);
});

test('unknown and malformed codes return the 404 page', async () => {
  for (const path of ['/Nope123', '/x', '/..%2Fserver.js', '/public/index.html']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
    assert.match(await res.text(), /Link not found/);
  }
});

test('serves only the allowlisted static files', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), new RegExp(type));
  }
  for (const path of ['/server.js', '/db.js', '/package.json', '/404.html']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
});

test('sends security headers on every kind of response', async () => {
  await shorten('https://example.com/headers');
  const responses = [
    await fetch(`${base}/`),
    await fetch(`${base}/Nope123`),
    await fetch(`${base}/shorten`),
    await post('{nope'),
    await fetch(`${base}/Taken01`, { redirect: 'manual' }),
  ];
  for (const res of responses) {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
});

test('the page uses no inline scripts or styles (required by the CSP)', async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(html, /<style|style=/);
});
