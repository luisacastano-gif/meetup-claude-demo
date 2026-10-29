import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const selectByCode = db.prepare('SELECT code, url FROM links WHERE code = ?');
  const selectByUrl = db.prepare('SELECT code, url FROM links WHERE url = ?');
  // OR IGNORE: a duplicate code or url is a normal outcome, reported as `false`.
  const insertLink = db.prepare('INSERT OR IGNORE INTO links (code, url) VALUES (?, ?)');

  return {
    findByCode: (code) => selectByCode.get(code),
    findByUrl: (url) => selectByUrl.get(url),
    insert: (code, url) => insertLink.run(code, url).changes === 1,
    close: () => db.close(),
  };
}
