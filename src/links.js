import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 7;
const CODE_PATTERN = /^[0-9A-Za-z]{7}$/;
const MAX_URL_LENGTH = 2048;
const MAX_INSERT_ATTEMPTS = 10;

export function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function createLinks(db, { generateCode = randomCode } = {}) {
  // ownHosts: hosts (host:port) the shortener is served from, to refuse links to itself.
  function validate(input, ownHosts) {
    if (typeof input !== 'string' || input.trim() === '') {
      return { error: 'Please enter a URL.' };
    }
    const trimmed = input.trim();
    if (trimmed.length > MAX_URL_LENGTH) {
      return { error: `That URL is too long (max ${MAX_URL_LENGTH} characters).` };
    }
    if (!URL.canParse(trimmed)) {
      return { error: 'That does not look like a valid URL. Include http:// or https://.' };
    }
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: 'Only http and https URLs can be shortened.' };
    }
    if (ownHosts.includes(url.host)) {
      return { error: 'That link already points to this shortener.' };
    }
    return { url: url.href };
  }

  function shorten(input, ownHosts) {
    const checked = validate(input, ownHosts);
    if (checked.error) return { error: checked.error };

    const existing = db.findByUrl(checked.url);
    if (existing) return { code: existing.code };

    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
      const code = generateCode();
      if (db.insert(code, checked.url)) return { code };
      // Insert was ignored: either the code is taken, or the same URL was just added.
      const raced = db.findByUrl(checked.url);
      if (raced) return { code: raced.code };
    }
    throw new Error(`could not find a free code after ${MAX_INSERT_ATTEMPTS} attempts`);
  }

  function resolve(code) {
    if (!CODE_PATTERN.test(code)) return undefined;
    return db.findByCode(code)?.url;
  }

  return { shorten, resolve };
}
