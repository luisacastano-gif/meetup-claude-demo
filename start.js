import { createServer } from './server.js';

// The only place that reads process.env.
const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_FILE ?? 'data/links.db';
const baseUrl = process.env.BASE_URL;

createServer({ dbPath, baseUrl }).listen(port, () => {
  console.log(`URL shortener running at http://localhost:${port}`);
});
