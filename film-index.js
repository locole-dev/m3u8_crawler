#!/usr/bin/env node

import fs from 'fs/promises';
import express from 'express';
import cors from 'cors';
import { FilmExtractor } from './src/film/FilmExtractor.js';
import { crawlFilmSources, crawlFilmSourcesOnce } from './src/film/crawlSources.js';
import { buildFilmCatalogPlaylist } from './src/film/playlist.js';
import { resolveFilmConfigs } from './src/loadServerLinkConfig.js';

async function runOnce(subCommand, targetUrl, outputPrefix) {
  const configs = await resolveFilmConfigs();
  const cfg = configs.find((c) => c.targetUrl === targetUrl) ?? configs[0] ?? { targetUrl, filmTitle: undefined };

  const extractor = new FilmExtractor({
    timeout: Number.parseInt(process.env.FILM_TIMEOUT_MS, 10) || 120000,
    collectMs: Number.parseInt(process.env.FILM_COLLECT_MS, 10) || 1500,
  });

  try {
    await extractor.init();
    console.log(`[phim] crawl: ${targetUrl}`);
    let result;
    if (subCommand === 'match' && targetUrl) {
      result = await extractor.extractFromMatch(targetUrl);
      console.log(`[phim] xong: ${result?.streams?.length ?? 0} tập`);
    } else if (targetUrl) {
      const list = await extractor.extractAll(targetUrl, { limit: 100 });
      const playlist = buildFilmCatalogPlaylist(list.map((r) => ({ result: r, cfg })));
      if (outputPrefix) {
        await fs.writeFile(`${outputPrefix}.m3u`, playlist, 'utf-8');
        await fs.writeFile(`${outputPrefix}.json`, JSON.stringify(list, null, 2), 'utf-8');
      } else {
        console.log(playlist);
      }
      return;
    } else {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const playlist = buildFilmCatalogPlaylist([{ result, cfg }]);
    if (outputPrefix) {
      await fs.writeFile(`${outputPrefix}.m3u`, playlist, 'utf-8');
      await fs.writeFile(`${outputPrefix}.json`, JSON.stringify([result], null, 2), 'utf-8');
    } else {
      console.log(playlist);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await extractor.close();
  }
}

async function startServe(args) {
  const port = parseInt(args[1], 10) || parseInt(process.env.FILM_PORT, 10) || 3001;

  const filmConfigs = await resolveFilmConfigs();
  console.log(`[phim] ${filmConfigs.length} source(s) in server_link/phim/`);
  for (const cfg of filmConfigs) {
    console.log(`  - ${cfg.filmTitle || cfg.targetUrl}: ${cfg.targetUrl}`);
  }

  const app = express();
  app.use(cors());
  let crawlRunning = false;

  app.get('/health', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/film.m3u', async (req, res) => {
    try {
      const content = await fs.readFile('film.m3u', 'utf-8');
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).type('text/plain').send('#EXTM3U\n# No film data yet');
    }
  });

  app.get('/api/film/playlist', async (req, res) => {
    try {
      const content = await fs.readFile('film.m3u', 'utf-8');
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).type('text/plain').send('#EXTM3U\n');
    }
  });

  app.get('/api/film/playlist.json', async (req, res) => {
    try {
      const content = await fs.readFile('film.json', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).json({ error: 'No film data yet.' });
    }
  });

  const host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`[phim] http://${host}:${port}`);
    console.log(`  - /film.m3u`);
    console.log(`  - /api/film/playlist`);
    console.log(`  - Crawl: 1 lần khi startup (không cron)`);
  });

  if (process.env.FILM_SKIP_STARTUP_CRAWL !== 'true') {
    crawlRunning = true;
    crawlFilmSourcesOnce('Startup')
      .then((r) => {
        if (r.skipped) return;
        console.log(`[${new Date().toISOString()}] [phim] Startup crawl xong.`);
      })
      .catch(() => console.error(`[${new Date().toISOString()}] [phim] Startup crawl failed.`))
      .finally(() => {
        crawlRunning = false;
      });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const force = args.includes('--force');

  console.log(
    `[phim] process start pid=${process.pid} headless=${process.env.FILM_HEADLESS ?? process.env.HEADLESS ?? 'default'}`,
  );

  if (!cmd) {
    printUsage();
    process.exit(1);
  }

  if (cmd === 'serve') {
    await startServe(args.filter((a) => a !== '--force'));
    return;
  }

  if (cmd === 'crawl') {
    await crawlFilmSources(force ? 'Manual (force)' : 'Manual');
    await fs.writeFile('film.crawl.lock', `${new Date().toISOString()}\n`, 'utf-8');
    return;
  }

  if (cmd === 'match') {
    const url = args[1];
    const out = args[2];
    await runOnce('match', url, out);
    return;
  }

  if (cmd === 'list') {
    await runOnce('list', args[1], args[2]);
    return;
  }

  await runOnce('match', cmd, args[1]);
}

function printUsage() {
  console.error('Film crawler:');
  console.error('  node film-index.js serve [port]     # crawl 1 lần lúc startup');
  console.error('  node film-index.js crawl [--force]  # crawl lại (force bỏ lock)');
  console.error('  node film-index.js match <url>');
  console.error('');
  console.error('  Config: server_link/phim/*.json — thêm "filmTitle" cho tên nhóm');
  console.error('  Env: FILM_SKIP_STARTUP_CRAWL=true để tắt auto crawl');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
