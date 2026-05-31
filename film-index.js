#!/usr/bin/env node

import fs from 'fs/promises';
import express from 'express';
import cors from 'cors';
import { FilmExtractor } from './src/film/FilmExtractor.js';
import { crawlFilmSourcesOnce, crawlOneFilmSource } from './src/film/crawlSources.js';
import { buildFilmCatalogPlaylist } from './src/film/playlist.js';
import { resolveFilmConfigs } from './src/loadServerLinkConfig.js';
import { episodeNumberFromLabel } from './src/film/audioTrack.js';
import { hcmLogPrefix } from './src/formatTime.js';
import { logFilmServeEndpoints, registerFilmServeRoutes } from './src/film/serve.js';

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
      const epCount = new Set(
        (result?.streams ?? [])
          .map((s) => episodeNumberFromLabel(s.server))
          .filter((n) => n !== null),
      ).size;
      console.log(`[phim] xong: ${epCount} tập`);
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

  registerFilmServeRoutes(app);

  const host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    logFilmServeEndpoints(host, port);
  });

  if (process.env.FILM_SKIP_STARTUP_CRAWL !== 'true') {
    crawlRunning = true;
    crawlFilmSourcesOnce('Startup')
      .then((r) => {
        if (r.skipped) return;
        console.log(`${hcmLogPrefix()} [phim] Startup crawl xong.`);
      })
      .catch(() => console.error(`${hcmLogPrefix()} [phim] Startup crawl failed.`))
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
    await crawlFilmSourcesOnce(force ? 'Manual (force)' : 'Manual', { force });
    return;
  }

  if (cmd === 'crawl-one') {
    const specifier = args[1];
    if (!specifier) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    await crawlOneFilmSource(specifier, 'Manual (one)');
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
  console.error('  node film-index.js crawl-one <slug|json-path|url>');
  console.error('  node film-index.js match <url>');
  console.error('');
  console.error('  Config: server_link/phim/*.json — thêm "filmTitle" cho tên nhóm');
  console.error('  Env: FILM_SKIP_STARTUP_CRAWL=true để tắt auto crawl');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
