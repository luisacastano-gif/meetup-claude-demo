# URL shortener

A tiny URL shortener. Paste a long URL on the home page, get a short link back, and visiting the short link redirects to the original. No accounts; links are stored in a local SQLite file (`data/links.db`).

Requires Node.js 22.13 or newer. There are no dependencies to install.

```
npm start        # http://localhost:3000 (set PORT to change it)
npm test
```
