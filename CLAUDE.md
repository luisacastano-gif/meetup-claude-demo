## Branches
- `master` is production. It only receives merges from `develop`.
- `develop` is the integration branch. Every pull request targets `develop`.
- Work happens in `feature/<short-name>` or `fix/<short-name>` branches created from `develop`.
- Never commit directly to `master` or `develop`.

## Stack
- Node.js 22.13 or newer, using only built-in modules (`node:http`, `node:sqlite`, `node:crypto`, `node:test`).
- No runtime npm dependencies. Adding one requires a written justification in the pull request.
- ES modules only (`import`/`export`, `"type": "module"`). No CommonJS.

## Architecture
The code is split into layers. Each layer may only depend on the layers below it.

| Layer | Location | Responsibility |
|---|---|---|
| HTTP | `server.js` | Routing, reading requests, writing responses, status codes, headers |
| Domain | `src/links.js` | URL validation and normalization, code generation, business rules |
| Storage | `db.js` | SQLite access through prepared statements |
| UI | `public/` | Static page, styles, and browser script |

- The HTTP layer must not contain SQL or business rules. The domain layer must not know about `req`/`res`.
- The storage layer exposes small functions (`findByCode`, `findByUrl`, `insert`) and never leaks the database object.
- Pass configuration in as parameters (for example `createServer({ dbPath, baseUrl })`). Read `process.env` in one place only, at startup.
- The server must be creatable without listening on a port, so tests can start it on port 0.

## Security
- Accept only `http:` and `https:` URLs, at most 2048 characters. Reject links that point back to the shortener.
- Limit request bodies, and when the limit is exceeded, still answer with 413 (do not drop the connection).
- Serve static files only from a fixed allowlist. Never build file paths from user input.
- Escape any user input that is rendered as HTML.
- Send `X-Content-Type-Options: nosniff` and a Content Security Policy on every response. Do not use inline scripts or styles.
- Never commit secrets, `.env` files, or database files (`data/` is git-ignored).

## Errors and logging
- Never leave an empty `catch`. Either handle the error with a clear response or let it propagate.
- Client errors return 4xx with a JSON body `{ "error": "<message the user can act on>" }`.
- Unexpected errors are logged with context (route, code, operation) and return a generic 500. Never send stack traces to the client.

## Tests
- Every change to logic comes with `node:test` tests in `test/`. Run them with `npm test`.
- Test behavior through HTTP against a temporary database, not internal functions.
- Cover the error paths: invalid input, oversized bodies, unknown codes, and conflicts.
- All tests must pass before a pull request is opened.

## Code style
- Small functions with one responsibility. Prefer clear names over comments.
- Comments explain *why*, not *what*.
- Constants (limits, lengths, alphabets) live at the top of the file in `UPPER_SNAKE_CASE`.
- Each pull request has one purpose and a description with what changed and how to test it.
