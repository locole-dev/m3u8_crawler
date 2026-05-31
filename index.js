#!/usr/bin/env node

import { M3U8Extractor } from './src/M3U8Extractor.js';
import { resolveCrawlConfig, resolveFootballConfigs } from './src/loadServerLinkConfig.js';
import { crawlFootballSources } from './src/football/crawlSources.js';
import { buildIptvPlaylist, parseLimit } from './src/playlist.js';
import { resolveSiteProfile } from './src/sites/registry.js';
import { hcmLogPrefix } from './src/formatTime.js';
import fs from 'fs/promises';
import cron from 'node-cron';
import express from 'express';
import cors from 'cors';

async function runOnce(subCommand, targetUrl, limitArg, outputPrefix) {
  const extractor = new M3U8Extractor();
  try {
    await extractor.init();
    let playlist = '';
    let rawResults = [];

    if (subCommand === 'list') {
      if (!targetUrl) {
        printUsage();
        process.exitCode = 1;
        return;
      }
      const limit = parseLimit(limitArg, 100);
      rawResults = await extractor.extractAll(targetUrl, { limit });
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: targetUrl, resolveProfile: resolveSiteProfile });
    } else if (subCommand === 'match') {
      if (!targetUrl) {
        printUsage();
        process.exitCode = 1;
        return;
      }
      const result = await extractor.extractFromMatch(targetUrl);
      rawResults = [result];
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: targetUrl, resolveProfile: resolveSiteProfile });
    } else {
      const result = await extractor.extractFromMatch(subCommand);
      rawResults = [result];
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: subCommand, resolveProfile: resolveSiteProfile });
    }

    if (outputPrefix) {
      await fs.writeFile(`${outputPrefix}.m3u`, playlist, 'utf-8');
      await fs.writeFile(`${outputPrefix}.json`, JSON.stringify(rawResults, null, 2), 'utf-8');
    } else {
      console.log(playlist);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    throw error;
  } finally {
    await extractor.close();
  }
}

function resolveCronExpression(argvSlice) {
  return resolveCronWithRest(argvSlice).cron;
}

/** Cron từ CRON_SCHEDULE hoặc argv (compose có thể tách cron thành nhiều token). */
function resolveCronWithRest(argvSlice) {
  const fromEnv = process.env.CRON_SCHEDULE?.trim();
  if (fromEnv && cron.validate(fromEnv)) {
    return { cron: fromEnv, rest: [...argvSlice] };
  }

  const joined = argvSlice.join(' ').trim();
  if (joined && cron.validate(joined)) {
    return { cron: joined, rest: [] };
  }

  for (let n = Math.min(5, argvSlice.length); n >= 1; n -= 1) {
    const candidate = argvSlice.slice(0, n).join(' ');
    if (cron.validate(candidate)) {
      return { cron: candidate, rest: argvSlice.slice(n) };
    }
  }

  return { cron: joined || fromEnv || '', rest: [] };
}

async function startServe(args) {
  const port = parseInt(args[1], 10) || 3000;
  const cronExp = resolveCronExpression(args.slice(2));

  if (!cronExp) {
    printUsage();
    process.exit(1);
  }

  if (!cron.validate(cronExp)) {
    console.error('Invalid cron expression:', cronExp);
    process.exit(1);
  }

  const { rest: serveRest } = resolveCronWithRest(args.slice(2));
  const cliDefaults = {
    subCommand: serveRest[0] ?? process.env.SERVE_SUBCOMMAND,
    targetUrl: serveRest[1] ?? process.env.TARGET_URL,
    limitArg: serveRest[2] ?? process.env.LIST_LIMIT,
  };

  const footballConfigs = await resolveFootballConfigs(cliDefaults);

  if (footballConfigs.length === 0) {
    console.error('Add JSON to server_link/football/ or set TARGET_URL.');
    printUsage();
    process.exit(1);
  }

  console.log(`[bong-da] ${footballConfigs.length} source(s):`);
  for (const cfg of footballConfigs) {
    console.log(`  - ${cfg.configPath}: ${cfg.subCommand} ${cfg.targetUrl}`);
  }

  const app = express();
  app.use(cors());
  let jobRunning = false;

  app.get('/health', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/playlist.m3u', async (req, res) => {
    try {
      const content = await buildMergedPlaylistM3U();
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).type('text/plain').send('#EXTM3U\n# Error');
    }
  });

  app.get('/api/playlist', async (req, res) => {
    try {
      const content = await buildMergedPlaylistM3U();
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).type('text/plain').send('#EXTM3U\n');
    }
  });

  app.get('/api/playlist.json', async (req, res) => {
    try {
      const content = await fs.readFile('playlist.json', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(content);
    } catch {
      res.status(404).json({ error: 'No data yet. Wait for first crawl.' });
    }
  });

  const host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`[bong-da] http://${host}:${port}`);
    console.log(`  - /playlist.m3u`);
    console.log(`  - /api/playlist`);
    console.log(`  - /api/playlist.json`);
    console.log(`  - Phim: node film-index.js serve → port ${process.env.FILM_PORT || 3001} (/film.m3u, /api/playlist)`);
  });

  console.log(`[bong-da] cron: "${cronExp}"`);
  cron.schedule(cronExp, async () => {
    if (jobRunning) {
      console.warn(`${hcmLogPrefix()} [bong-da] skip: job still running`);
      return;
    }
    jobRunning = true;
    try {
      await crawlFootballSources('Scheduled');
    } finally {
      jobRunning = false;
    }
  });

  jobRunning = true;
  crawlFootballSources('Initial')
    .catch(() => console.error(`${hcmLogPrefix()} [bong-da] initial crawl failed`))
    .finally(() => {
      jobRunning = false;
    });
}

async function startCronOnly(args) {
  const { cron: cronExp, rest } = resolveCronWithRest(args.slice(1));
  const cliDefaults = {
    subCommand: rest[0] ?? process.env.SERVE_SUBCOMMAND,
    targetUrl: rest[1] ?? process.env.TARGET_URL,
    limitArg: rest[2] ?? process.env.LIST_LIMIT,
  };

  if (!cronExp || !cron.validate(cronExp)) {
    printUsage();
    process.exit(1);
  }

  cron.schedule(cronExp, async () => {
    const cfg = await resolveCrawlConfig(cliDefaults);
    if (!cfg) return;
    await runOnce(cfg.subCommand, cfg.targetUrl, cfg.limitArg, 'playlist');
  });
}

async function main() {
  const args = process.argv.slice(2);
  const commandOrUrl = args[0];

  console.log(
    `[bong-da] process start pid=${process.pid} headless=${process.env.HEADLESS ?? 'default'}`,
  );

  if (!commandOrUrl) {
    printUsage();
    process.exit(1);
  }

  if (commandOrUrl === 'serve') {
    await startServe(args);
    return;
  }

  if (commandOrUrl === 'cron') {
    await startCronOnly(args);
    return;
  }

  await runOnce(commandOrUrl, args[1], args[2]).catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function buildMergedPlaylistM3U() {
  let content = '#EXTM3U\n';
  try {
    const vietanh = await fs.readFile('vietanh.m3u', 'utf-8');
    content += vietanh.replace(/#EXTM3U/i, '').trim() + '\n';
  } catch {}

  try {
    const playlist = await fs.readFile('playlist.m3u', 'utf-8');
    content += playlist.replace(/#EXTM3U/i, '').trim() + '\n';
  } catch {}

  return content;
}

function printUsage() {
  console.error('Bóng đá (tách khỏi phim):');
  console.error('  node index.js serve <port> ["<cron>"]  # hoặc CRON_SCHEDULE env');
  console.error('  node index.js list|match <url> [limit]');
  console.error('  Config: server_link/football/*.json');
  console.error('  Phim:   node film-index.js serve | crawl | match <url>');
}
