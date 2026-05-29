import fs from 'fs/promises';
import path from 'path';
import { FilmExtractor } from './FilmExtractor.js';
import { resolveFilmConfigs } from '../loadServerLinkConfig.js';
import { buildFilmCatalogPlaylist } from './playlist.js';
import { parseLimit } from '../playlist.js';

const CRAWL_LOCK = 'film.crawl.lock';
const CRAWL_GAP_MS = Number.parseInt(process.env.FILM_CRAWL_GAP_MS, 10) || 1500;

export async function crawlFilmSources(label, cliDefaults = {}) {
  const configs = await resolveFilmConfigs(cliDefaults);
  if (configs.length === 0) {
    console.log(`[${new Date().toISOString()}] [phim] ${label}: no configs in server_link/phim/.`);
    return { results: [], playlist: '#EXTM3U\n' };
  }

  const filmEntries = [];
  const allResults = [];
  const extractor = new FilmExtractor({
    timeout: Number.parseInt(process.env.FILM_TIMEOUT_MS, 10) || 120000,
    collectMs: Number.parseInt(process.env.FILM_COLLECT_MS, 10) || 1500,
  });

  const releaseRejectionGuard = attachBrowserClosedRejectionGuard();

  try {
    await extractor.init();

    for (const [index, cfg] of configs.entries()) {
      if (index > 0) {
        await sleep(CRAWL_GAP_MS);
      }
      await crawlOneConfig(extractor, cfg, label, filmEntries, allResults);
    }
  } finally {
    releaseRejectionGuard();
    await extractor.close();
  }

  const mergedPlaylist = buildFilmCatalogPlaylist(filmEntries);
  await fs.writeFile('film.m3u', mergedPlaylist, 'utf-8');
  await fs.writeFile('film.json', JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(
    `[${new Date().toISOString()}] [phim] ${label}: ${filmEntries.length} phim → film.m3u / film.json`,
  );

  return { results: allResults, playlist: mergedPlaylist, filmEntries };
}

async function crawlOneConfig(extractor, cfg, label, filmEntries, allResults, { retry = false } = {}) {
  const ts = new Date().toISOString();
  const tag = retry ? ' (retry)' : '';
  console.log(`[${ts}] [phim] ${label}${tag}: ${cfg.subCommand} ${cfg.targetUrl} (${cfg.configPath})`);

  try {
    await ensureFilmBrowser(extractor);

    if (cfg.subCommand === 'match') {
      const result = await extractor.extractFromMatch(cfg.targetUrl, {
        serverTabsSelector: cfg.serverTabsSelector,
      });
      filmEntries.push({ result, cfg });
      allResults.push(result);
      console.log(
        `[${new Date().toISOString()}] [phim] ${label}: 1 phim, ${result.streams?.length ?? 0} tập`,
      );
    } else {
      const limit = parseLimit(cfg.limitArg, 100);
      const list = await extractor.extractAll(cfg.targetUrl, {
        limit,
        itemSelector: cfg.itemSelector,
        serverTabsSelector: cfg.serverTabsSelector,
      });
      for (const item of list) {
        filmEntries.push({ result: item, cfg });
        allResults.push(item);
      }
      console.log(
        `[${new Date().toISOString()}] [phim] ${label}: ${list.length} phim, ${countStreams(list)} stream(s)`,
      );
    }
    return true;
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] [phim] ${label}: failed ${cfg.targetUrl}: ${err.message}`,
    );
    if (!retry && isBrowserClosedError(err)) {
      await restartFilmBrowser(extractor).catch(() => {});
      return crawlOneConfig(extractor, cfg, label, filmEntries, allResults, { retry: true });
    }
    return false;
  }
}

async function ensureFilmBrowser(extractor) {
  if (isBrowserConnected(extractor)) {
    return;
  }
  await restartFilmBrowser(extractor);
}

async function restartFilmBrowser(extractor) {
  await extractor.close();
  await sleep(500);
  await extractor.init();
}

function isBrowserConnected(extractor) {
  return Boolean(extractor.browser?.isConnected?.());
}

function isBrowserClosedError(err) {
  const msg = String(err?.message ?? err ?? '');
  return (
    /Target page, context or browser has been closed/i.test(msg) ||
    /browser has been closed/i.test(msg) ||
    /cdpSession\.send/i.test(msg) ||
    /Target closed/i.test(msg)
  );
}

/** Tránh crash process khi stealth/CDP reject sau khi đóng tab. */
function attachBrowserClosedRejectionGuard() {
  const handler = (reason) => {
    if (!isBrowserClosedError(reason)) {
      return;
    }
    console.warn(
      `[phim] CDP/browser closed (ignored): ${reason?.message ?? reason}`,
    );
  };
  process.on('unhandledRejection', handler);
  return () => process.off('unhandledRejection', handler);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Crawl đúng 1 lần (lock file); `force` bỏ qua lock (CLI crawl). */
export async function crawlFilmSourcesOnce(label, { force = false } = {}) {
  if (!force) {
    try {
      await fs.access(CRAWL_LOCK);
      console.log(`[phim] Đã crawl rồi (${CRAWL_LOCK}). Bỏ qua. Dùng: node film-index.js crawl --force`);
      const playlist = await fs.readFile('film.m3u', 'utf-8').catch(() => '#EXTM3U\n');
      return { skipped: true, playlist };
    } catch {
      /* chưa crawl */
    }
  }

  const out = await crawlFilmSources(label);
  await fs.writeFile(CRAWL_LOCK, `${new Date().toISOString()}\n`, 'utf-8');
  return { ...out, skipped: false };
}

export function crawlLockPath() {
  return path.resolve(CRAWL_LOCK);
}

function countStreams(results) {
  return results.reduce((n, r) => n + (r?.streams?.length ?? 0), 0);
}
