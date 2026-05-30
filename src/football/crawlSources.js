import fs from 'fs/promises';
import { M3U8Extractor } from '../M3U8Extractor.js';
import { resolveFootballConfigs } from '../loadServerLinkConfig.js';
import { buildIptvPlaylist, parseLimit } from '../playlist.js';
import { resolveSiteProfile } from '../sites/registry.js';
import { hcmLogPrefix } from '../formatTime.js';

export async function crawlFootballSources(label, cliDefaults = {}, options = {}) {
  const configs = await resolveFootballConfigs(cliDefaults);
  if (configs.length === 0) {
    console.error(`${hcmLogPrefix()} [bong-da] ${label}: no configs in server_link/football/.`);
    return { results: [], playlist: '#EXTM3U\n' };
  }

  const envCap = process.env.FOOTBALL_CRAWL_LIMIT
    ? parseLimit(process.env.FOOTBALL_CRAWL_LIMIT, 100)
    : undefined;
  const capPerSite = options.limitPerSite ?? envCap;

  const extractor = new M3U8Extractor();
  await extractor.init();

  let allResults = [];
  let allPlaylistLines = [];

  try {
    for (const cfg of configs) {
      console.log(`${hcmLogPrefix()} [bong-da] ${label}: ${cfg.targetUrl} (${cfg.configPath})`);
      try {
        const limit = capPerSite
          ? Math.min(parseLimit(cfg.limitArg, 100), capPerSite)
          : parseLimit(cfg.limitArg, 100);
        const results = await extractor.extractAll(cfg.targetUrl, {
          limit,
          itemSelector: cfg.itemSelector,
          serverTabsSelector: cfg.serverTabsSelector,
        });
        const playlist = buildIptvPlaylist(results, {
          sourceUrl: cfg.targetUrl,
          groupName: cfg.groupName,
          resolveProfile: resolveSiteProfile,
        });

        allResults.push(...results);
        const stripped = playlist.replace(/^#EXTM3U\s*/i, '').trim();
        if (stripped) allPlaylistLines.push(stripped);

        console.log(`${hcmLogPrefix()} [bong-da] ${label}: ${results.length} match(es) from ${cfg.targetUrl}`);
      } catch (err) {
        console.error(`${hcmLogPrefix()} [bong-da] ${label}: failed ${cfg.targetUrl}: ${err.message}`);
      }
    }
  } finally {
    await extractor.close();
  }

  const mergedPlaylist = '#EXTM3U\n' + allPlaylistLines.join('\n');
  await fs.writeFile('playlist.m3u', mergedPlaylist, 'utf-8');
  await fs.writeFile('playlist.json', JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`${hcmLogPrefix()} [bong-da] ${label}: saved ${allResults.length} match(es) → playlist.m3u / playlist.json`);

  return { results: allResults, playlist: mergedPlaylist };
}
