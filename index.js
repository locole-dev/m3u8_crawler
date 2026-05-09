#!/usr/bin/env node

import { M3U8Extractor } from './src/M3U8Extractor.js';
import fs from 'fs/promises';
import cron from 'node-cron';
import express from 'express';
import cors from 'cors';

const args = process.argv.slice(2);
const commandOrUrl = args[0];

if (!commandOrUrl) {
  printUsage();
  process.exit(1);
}

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
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: targetUrl });
    } else if (subCommand === 'match') {
      if (!targetUrl) {
        printUsage();
        process.exitCode = 1;
        return;
      }
      const result = await extractor.extractFromMatch(targetUrl);
      rawResults = [result];
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: targetUrl });
    } else {
      const result = await extractor.extractFromMatch(subCommand);
      rawResults = [result];
      playlist = buildIptvPlaylist(rawResults, { sourceUrl: subCommand });
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

if (commandOrUrl === 'serve') {
  const port = parseInt(args[1], 10) || 3000;
  const cronExp = args[2];
  const subCommand = args[3];
  const targetUrl = args[4];
  const limitArg = args[5];

  if (!cronExp || !subCommand || !targetUrl) {
    printUsage();
    process.exit(1);
  }

  if (!cron.validate(cronExp)) {
    console.error('Invalid cron expression:', cronExp);
    process.exit(1);
  }

  const app = express();
  app.use(cors());

  let jobRunning = false;

  app.get('/health', (req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/playlist.m3u', async (req, res) => {
    try {
      let content = '#EXTM3U\n';
      try {
        const vietanh = await fs.readFile('vietanh.m3u', 'utf-8');
        content += vietanh.replace(/#EXTM3U/i, '').trim() + '\n';
      } catch (err) {}
      
      try {
        const playlist = await fs.readFile('playlist.m3u', 'utf-8');
        content += playlist.replace(/#EXTM3U/i, '').trim() + '\n';
      } catch (err) {}
      
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch (err) {
      res.status(404).send('#EXTM3U\n# Error');
    }
  });

  app.get('/api/playlist', async (req, res) => {
    try {
      const content = await fs.readFile('playlist.json', 'utf-8');
      res.setHeader('Content-Type', 'application/json');
      res.send(content);
    } catch (err) {
      res.status(404).json({ error: 'No data generated yet. Please wait for the first cron job run.' });
    }
  });

  const host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
    console.log(`- M3U Playlist: http://${host}:${port}/playlist.m3u`);
    console.log(`- JSON API:     http://${host}:${port}/api/playlist`);
    console.log(`- Health:       http://${host}:${port}/health`);
  });

  console.log(`Starting background cron job with schedule: "${cronExp}"`);
  cron.schedule(cronExp, async () => {
    if (jobRunning) {
      console.warn(`[${new Date().toISOString()}] Skipping cron tick: previous job still running.`);
      return;
    }
    jobRunning = true;
    console.log(`[${new Date().toISOString()}] Running scheduled job...`);
    try {
      await runOnce(subCommand, targetUrl, limitArg, 'playlist');
      console.log(`[${new Date().toISOString()}] Job finished successfully. Saved to playlist.m3u and playlist.json`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Scheduled job failed.`);
    } finally {
      jobRunning = false;
    }
  });

  console.log(`[${new Date().toISOString()}] Running initial crawl on startup...`);
  jobRunning = true;
  runOnce(subCommand, targetUrl, limitArg, 'playlist')
    .then(() => console.log(`[${new Date().toISOString()}] Initial crawl finished successfully.`))
    .catch(() => console.error(`[${new Date().toISOString()}] Initial crawl failed.`))
    .finally(() => {
      jobRunning = false;
    });

} else if (commandOrUrl === 'cron') {
  const cronExp = args[1];
  const subCommand = args[2];
  const targetUrl = args[3];
  const limitArg = args[4];

  if (!cronExp || !subCommand || !targetUrl) {
    printUsage();
    process.exit(1);
  }

  if (!cron.validate(cronExp)) {
    console.error('Invalid cron expression:', cronExp);
    process.exit(1);
  }

  console.log(`Starting cron job with schedule: "${cronExp}"`);
  console.log(`Command: ${subCommand} ${targetUrl} ${limitArg || ''}`);

  cron.schedule(cronExp, async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled job...`);
    try {
      await runOnce(subCommand, targetUrl, limitArg, 'playlist');
      console.log(`[${new Date().toISOString()}] Job finished successfully. Saved to playlist.m3u and playlist.json`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Scheduled job failed.`);
    }
  });
} else {
  const targetUrl = args[1];
  const limitArg = args[2];
  runOnce(commandOrUrl, targetUrl, limitArg).catch(() => {});
}

function buildIptvPlaylist(results, { sourceUrl } = {}) {
  const lines = ['#EXTM3U'];
  let channelCount = 0;

  for (const result of results) {
    const streams = result?.streams ?? [];
    const baseTitle = sanitizeForExtInf(result?.title || result?.matchUrl || 'Unknown match');

    for (const [index, stream] of streams.entries()) {
      const headers = pickPlaybackHeaders(stream.headers);
      const serverLabel = sanitizeForExtInf(stream.server || `server-${index + 1}`);
      const channelName = `${baseTitle} | ${serverLabel}`;
      const groupTitle = sanitizeForQuotedAttr(domainGroupName(stream.pageUrl || sourceUrl));
      const displayTitle = sanitizeForExtInf(channelName);

      // Align with common public IPTV M3U (e.g. bongda.m3u): group-title + title after comma,
      // EXTVLCOPT user-agent then referrer only — no #KODIPROP / tvg-name (many IPTV apps reject those).
      lines.push(`#EXTINF:-1 group-title="${groupTitle}",${displayTitle}`);

      if (headers['User-Agent']) {
        lines.push(`#EXTVLCOPT:http-user-agent=${headers['User-Agent']}`);
      }

      if (headers.Referer) {
        lines.push(`#EXTVLCOPT:http-referrer=${headers.Referer}`);
      }

      lines.push(stream.url);
      channelCount += 1;
    }
  }

  if (channelCount === 0) {
    return '#EXTM3U\n';
  }

  return lines.join('\n');
}

function pickPlaybackHeaders(headers) {
  const wanted = ['referer', 'origin', 'user-agent', 'cookie'];
  const normalized = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (wanted.includes(name.toLowerCase()) && value) {
      normalized[toHeaderCase(name)] = value;
    }
  }

  return normalized;
}

function domainGroupName(url) {
  if (!url) {
    return 'm3u8-scraper';
  }

  try {
    return new URL(url).hostname;
  } catch {
    return 'm3u8-scraper';
  }
}

function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node index.js list <listingUrl> [limit]');
  console.error('  node index.js match <matchUrl>');
  console.error('  node index.js <matchUrl>');
  console.error('  node index.js cron "<cronExpression>" list <listingUrl> [limit]');
  console.error('  node index.js cron "<cronExpression>" match <matchUrl>');
  console.error('  node index.js serve <port> "<cronExpression>" list <listingUrl> [limit]');
  console.error('  node index.js serve <port> "<cronExpression>" match <matchUrl>');
}

function toHeaderCase(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');
}

function sanitizeForExtInf(value) {
  return String(value)
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('"', "'")
    .replaceAll(',', ' -')
    .trim();
}

function sanitizeForQuotedAttr(value) {
  return String(value)
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('"', "'")
    .trim();
}
