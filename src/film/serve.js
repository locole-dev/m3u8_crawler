import fs from 'fs/promises';

import { FILM_JSON_PATH, FILM_M3U_PATH } from './paths.js';

const M3U_CONTENT_TYPE = 'audio/x-mpegurl; charset=utf-8';

export function registerFilmServeRoutes(app) {
  app.get('/health', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/film.m3u', async (req, res) => {
    await sendFilmM3u(res);
  });

  app.get('/api/playlist', async (req, res) => {
    await sendFilmM3u(res);
  });

  app.get('/api/playlist.json', async (req, res) => {
    try {
      const content = await fs.readFile(FILM_JSON_PATH, 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).json({ error: 'No data yet. Wait for first crawl.' });
    }
  });
}

async function sendFilmM3u(res) {
  try {
    const content = await fs.readFile(FILM_M3U_PATH, 'utf-8');
    res.setHeader('Content-Type', M3U_CONTENT_TYPE);
    res.send(content);
  } catch {
    res.status(404).type('text/plain').send('#EXTM3U\n# No data yet. Wait for first crawl.');
  }
}

export function logFilmServeEndpoints(host, port) {
  console.log(`[phim] http://${host}:${port}`);
  console.log(`  - /film.m3u`);
  console.log(`  - /api/playlist`);
  console.log(`  - /api/playlist.json`);
  console.log(`  - Crawl: 1 lần khi startup (không cron)`);
}
