import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

let server;
let base;

before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function shorten(body, rawBody) {
  return fetch(`${base}/api/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody ?? JSON.stringify(body),
  });
}

test('shortens a URL and the code redirects to it', async () => {
  const res = await shorten({ url: 'https://example.com/some/long/path?q=1' });
  assert.equal(res.status, 201);
  const { code, shortUrl } = await res.json();
  assert.match(code, /^[A-Za-z0-9]{6}$/);
  assert.equal(shortUrl, `${base}/${code}`);

  const redirect = await fetch(`${base}/${code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/some/long/path?q=1');
});

test('shortening the same URL twice returns the same code', async () => {
  const first = await (await shorten({ url: 'https://example.com/same' })).json();
  const secondRes = await shorten({ url: 'https://example.com/same' });
  assert.equal(secondRes.status, 200);
  assert.equal((await secondRes.json()).code, first.code);
});

for (const [name, body, raw] of [
  ['a non-http scheme', { url: 'ftp://example.com/file' }],
  ['text that is not a URL', { url: 'not a url' }],
  ['an empty URL', { url: '' }],
  ['a missing url field', {}],
  ['a body that is not JSON', undefined, 'nope'],
]) {
  test(`rejects ${name} with 400`, async () => {
    const res = await shorten(body, raw);
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error, 'string');
  });
}

test('rejects an oversized body with 413', async () => {
  const res = await shorten({ url: `https://example.com/${'a'.repeat(20_000)}` });
  assert.equal(res.status, 413);
});

test('unknown code returns 404', async () => {
  const res = await fetch(`${base}/zzzzzz`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('serves the home page', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Shorten a link/);
});
