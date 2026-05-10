#!/usr/bin/env node

import { M3U8Extractor } from './src/M3U8Extractor.js';
import { resolveCrawlConfig, resolveAllCrawlConfigs } from './src/loadServerLinkConfig.js';
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

async function startServe(args) {
  const port = parseInt(args[1], 10) || 3000;
  const cronExp = args[2];
  const subCommand = args[3];
  const targetUrl = args[4];
  const limitArg = args[5];

  if (!cronExp) {
    printUsage();
    process.exit(1);
  }

  if (!cron.validate(cronExp)) {
    console.error('Invalid cron expression:', cronExp);
    process.exit(1);
  }

  const cliDefaults = {
    subCommand: subCommand ?? process.env.SERVE_SUBCOMMAND,
    targetUrl: targetUrl ?? process.env.TARGET_URL,
    limitArg: limitArg ?? process.env.LIST_LIMIT,
  };

  const allConfigs = await resolveAllCrawlConfigs(cliDefaults);
  if (allConfigs.length === 0) {
    console.error(
      'Missing target URL: add JSON files to server_link/ with "targetUrl", or set TARGET_URL / pass URL on CLI.',
    );
    printUsage();
    process.exit(1);
  }

  console.log(`[server_link] Found ${allConfigs.length} crawl source(s):`);
  for (const cfg of allConfigs) {
    const extra =
      [cfg.itemSelector ? `item=${cfg.itemSelector}` : null, cfg.serverTabsSelector ? `tabs=${cfg.serverTabsSelector}` : null]
        .filter(Boolean)
        .join(' ');
    console.log(
      `  - ${cfg.configPath}: ${cfg.subCommand} ${cfg.targetUrl} (limit: ${cfg.limitArg || 'default'})${extra ? ` [${extra}]` : ''}`,
    );
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
    } catch (err) {
      res.status(404).type('text/plain').send('#EXTM3U\n# Error');
    }
  });

  // Same body as /playlist.m3u (plain M3U text), like raw GitHub .m3u — not JSON
  app.get('/api/playlist', async (req, res) => {
    try {
      const content = await buildMergedPlaylistM3U();
      // Same as /playlist.m3u — some IPTV clients only treat audio/x-mpegurl as a playlist
      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.send(content);
    } catch (err) {
      res.status(404).type('text/plain').send('#EXTM3U\n');
    }
  });

  app.get('/api/playlist.json', async (req, res) => {
    try {
      const content = await fs.readFile('playlist.json', 'utf-8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.send(content);
    } catch (err) {
      res.status(404).json({ error: 'No data generated yet. Please wait for the first crawl run.' });
    }
  });

  const host = process.env.HOST ?? '0.0.0.0';
  app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
    console.log(`- M3U Playlist: http://${host}:${port}/playlist.m3u`);
    console.log(`- M3U (API):    http://${host}:${port}/api/playlist`);
    console.log(`- JSON (raw):   http://${host}:${port}/api/playlist.json`);
    console.log(`- Health:       http://${host}:${port}/health`);
  });

  async function runAllSources(label) {
    const configs = await resolveAllCrawlConfigs(cliDefaults);
    if (configs.length === 0) {
      console.error(`[${new Date().toISOString()}] ${label}: no crawl configs found.`);
      return;
    }

    const extractor = new M3U8Extractor();
    await extractor.init();

    let allResults = [];
    let allPlaylistLines = [];

    try {
      for (const cfg of configs) {
        const ts = new Date().toISOString();
        console.log(`[${ts}] ${label}: crawling ${cfg.targetUrl} (${cfg.configPath})...`);
        try {
          const limit = parseLimit(cfg.limitArg, 100);
          const results = await extractor.extractAll(cfg.targetUrl, {
            limit,
            itemSelector: cfg.itemSelector,
            serverTabsSelector: cfg.serverTabsSelector,
          });
          const playlist = buildIptvPlaylist(results, { sourceUrl: cfg.targetUrl, groupName: cfg.groupName });

          allResults.push(...results);
          // Strip #EXTM3U header from individual playlists before merging
          const stripped = playlist.replace(/^#EXTM3U\s*/i, '').trim();
          if (stripped) allPlaylistLines.push(stripped);

          console.log(`[${new Date().toISOString()}] ${label}: got ${results.length} matches from ${cfg.targetUrl}`);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] ${label}: failed for ${cfg.targetUrl}: ${err.message}`);
        }
      }
    } finally {
      await extractor.close();
    }

    // Write merged results
    const mergedPlaylist = '#EXTM3U\n' + allPlaylistLines.join('\n');
    await fs.writeFile('playlist.m3u', mergedPlaylist, 'utf-8');
    await fs.writeFile('playlist.json', JSON.stringify(allResults, null, 2), 'utf-8');
    console.log(`[${new Date().toISOString()}] ${label}: saved ${allResults.length} total matches to playlist.m3u / playlist.json`);
  }

  console.log(`Starting background cron job with schedule: "${cronExp}"`);
  cron.schedule(cronExp, async () => {
    if (jobRunning) {
      console.warn(`[${new Date().toISOString()}] Skipping cron tick: previous job still running.`);
      return;
    }
    jobRunning = true;
    console.log(`[${new Date().toISOString()}] Running scheduled job...`);
    try {
      await runAllSources('Scheduled job');
      console.log(`[${new Date().toISOString()}] Job finished successfully.`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Scheduled job failed.`);
    } finally {
      jobRunning = false;
    }
  });

  console.log(`[${new Date().toISOString()}] Running initial crawl on startup...`);
  jobRunning = true;
  runAllSources('Initial crawl')
    .then(() => console.log(`[${new Date().toISOString()}] Initial crawl finished successfully.`))
    .catch(() => console.error(`[${new Date().toISOString()}] Initial crawl failed.`))
    .finally(() => {
      jobRunning = false;
    });
}

async function startCronOnly(args) {
  const cronExp = args[1];
  const subCommand = args[2];
  const targetUrl = args[3];
  const limitArg = args[4];

  if (!cronExp) {
    printUsage();
    process.exit(1);
  }

  if (!cron.validate(cronExp)) {
    console.error('Invalid cron expression:', cronExp);
    process.exit(1);
  }

  const cliDefaults = {
    subCommand: subCommand ?? process.env.SERVE_SUBCOMMAND,
    targetUrl: targetUrl ?? process.env.TARGET_URL,
    limitArg: limitArg ?? process.env.LIST_LIMIT,
  };

  const firstConfig = await resolveCrawlConfig(cliDefaults);
  if (!firstConfig) {
    console.error(
      'Missing target URL: add server_link/khandai.json with "targetUrl", or set TARGET_URL / pass URL on CLI.',
    );
    printUsage();
    process.exit(1);
  }

  console.log(`Starting cron job with schedule: "${cronExp}"`);
  console.log(
    `[server_link] First resolve: ${firstConfig.subCommand} ${firstConfig.targetUrl} (${firstConfig.configPath})`,
  );

  cron.schedule(cronExp, async () => {
    console.log(`[${new Date().toISOString()}] Running scheduled job...`);
    try {
      const cfg = await resolveCrawlConfig(cliDefaults);
      if (!cfg) {
        console.error(`[${new Date().toISOString()}] No crawl config. Skipping.`);
        return;
      }
      await runOnce(cfg.subCommand, cfg.targetUrl, cfg.limitArg, 'playlist');
      console.log(`[${new Date().toISOString()}] Job finished successfully. Saved to playlist.m3u and playlist.json`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Scheduled job failed.`);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const commandOrUrl = args[0];

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

  const targetUrl = args[1];
  const limitArg = args[2];
  await runOnce(commandOrUrl, targetUrl, limitArg).catch(() => {});
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
  } catch (err) {}

  try {
    const playlist = await fs.readFile('playlist.m3u', 'utf-8');
    content += playlist.replace(/#EXTM3U/i, '').trim() + '\n';
  } catch (err) {}

  return content;
}

function buildIptvPlaylist(results, { sourceUrl, groupName } = {}) {
  const lines = ['#EXTM3U'];
  let channelCount = 0;

  for (const result of results) {
    const streams = result?.streams ?? [];
    const rawTitle = result?.title || result?.matchUrl || 'Unknown match';
    const baseTitle = sanitizeForExtInf(cleanMatchTitle(rawTitle));

    for (const [index, stream] of streams.entries()) {
      const headers = pickPlaybackHeaders(stream.headers);
      const serverLabel = sanitizeForExtInf(stream.server || `server-${index + 1}`);
      const channelName = `${baseTitle} | ${serverLabel}`;
      const groupTitle = groupName ? sanitizeForQuotedAttr(groupName) : sanitizeForQuotedAttr(domainGroupName(stream.pageUrl || sourceUrl));
      const displayTitle = sanitizeForExtInf(channelName);

      lines.push(`#EXTINF:-1 tvg-name="${displayTitle}" group-title="${groupTitle}",${displayTitle}`);

      if (headers.Referer) {
        lines.push(`#EXTVLCOPT:http-referrer=${headers.Referer}`);
      }

      if (headers['User-Agent']) {
        lines.push(`#EXTVLCOPT:http-user-agent=${headers['User-Agent']}`);
      }

      // Build KODIPROP stream_headers for Kodi/TiviMate (ensures headers on sub-requests)
      const kodiParts = [];
      if (headers.Origin) {
        kodiParts.push(`Origin=${encodeURIComponent(headers.Origin)}`);
      }
      if (headers.Referer) {
        kodiParts.push(`Referer=${encodeURIComponent(headers.Referer)}`);
      }
      if (headers['User-Agent']) {
        kodiParts.push(`User-Agent=${encodeURIComponent(headers['User-Agent'])}`);
      }
      if (kodiParts.length > 0) {
        lines.push(`#KODIPROP:inputstream.adaptive.stream_headers=${kodiParts.join('&')}`);
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

  // Auto-derive Origin from Referer if missing (many CDNs require it)
  if (!normalized.Origin && normalized.Referer) {
    try {
      normalized.Origin = new URL(normalized.Referer).origin;
    } catch {}
  }

  return normalized;
}

function domainGroupName(url) {
  if (!url) {
    return 'M3U8 Scraper';
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const name = hostname.substring(0, hostname.lastIndexOf('.')) || hostname;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'M3U8 Scraper';
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
  console.error('  node index.js cron "<cronExpression>" [list|match] [targetUrl] [limit]');
  console.error('  node index.js serve <port> "<cronExpression>" [list|match] [targetUrl] [limit]');
  console.error('');
  console.error('  When serve/cron: crawl target is read from server_link/khandai.json on every run');
  console.error('  Use SERVER_LINK_DIR to point at config folder. CLI / TARGET_URL env are fallbacks if no JSON.');
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

function cleanMatchTitle(title) {
  let cleaned = String(title || '');
  const noise = [
    /(?:^|\s)(?:Trực tiếp|Truc tiep|Xem trực tiếp|Xem truc tiep)(?:\s|$)/ig,
    /(?:^|\s)(?:Live|Trực tuyến|Xem ngay)(?:\s|$)/ig,
    /(?:^|\s)(?:Chất lượng cao|Full HD|HD|4K)(?:\s|$)/ig,
    /(?:^|\s)(?:Bình luận tiếng Việt|BLV tiếng Việt|Tiếng Việt)(?:\s|$)/ig,
    /\s+Xem$/i,
    /^Xem\s+/i,
  ];

  for (const regex of noise) {
    cleaned = cleaned.replace(regex, ' ');
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

function sanitizeForQuotedAttr(value) {
  return String(value)
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('"', "'")
    .trim();
}
