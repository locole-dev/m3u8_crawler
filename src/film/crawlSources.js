import fs from 'fs/promises';
import path from 'path';
import { FilmExtractor } from './FilmExtractor.js';
import { resolveFilmConfigs } from '../loadServerLinkConfig.js';
import { parseLimit } from '../playlist.js';
import { formatHcmTime, hcmLogPrefix } from '../formatTime.js';
import {
  ensureFilmOutputDir,
  FILM_CRAWL_LOCK_PATH,
  FILM_JSON_PATH,
  FILM_M3U_PATH,
} from './paths.js';
import {
  countStreams,
  loadFilmCatalog,
  mergeFilmResult,
  persistFilmCatalog,
} from './catalog.js';

const CRAWL_GAP_MS = Number.parseInt(process.env.FILM_CRAWL_GAP_MS, 10) || 1500;

export async function crawlFilmSources(label, cliDefaults = {}) {
  const configs = await resolveFilmConfigs(cliDefaults);
  if (configs.length === 0) {
    console.log(`${hcmLogPrefix()} [phim] ${label}: no configs in server_link/phim/.`);
    return { results: [], playlist: '#EXTM3U\n' };
  }

  await ensureFilmOutputDir();

  const catalog = await loadFilmCatalog(configs);
  let persisted = null;
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
      const crawlResult = await crawlOneConfig(extractor, cfg, label);
      mergeCrawlResult(catalog, crawlResult, cfg, label);
      persisted = await persistFilmCatalog(catalog, configs);
      logPersistedCatalog(label, persisted, configs.length);
    }
  } finally {
    releaseRejectionGuard();
    await extractor.close();
  }

  if (!persisted) {
    persisted = await persistFilmCatalog(catalog, configs);
  }

  console.log(
    `${hcmLogPrefix()} [phim] ${label}: ${persisted.filmCount} phim, ${persisted.streamCount} tập → ${path.basename(FILM_M3U_PATH)} / ${path.basename(FILM_JSON_PATH)}`,
  );

  return persisted;
}

export async function crawlOneFilmSource(specifier, label = 'Manual (one)') {
  const configs = await resolveFilmConfigs();
  const cfg = resolveFilmConfigSpecifier(configs, specifier);

  if (!cfg) {
    throw new Error(`Không tìm thấy film config: ${specifier}`);
  }

  await ensureFilmOutputDir();

  const catalog = await loadFilmCatalog(configs);
  const extractor = new FilmExtractor({
    timeout: Number.parseInt(process.env.FILM_TIMEOUT_MS, 10) || 120000,
    collectMs: Number.parseInt(process.env.FILM_COLLECT_MS, 10) || 1500,
  });
  const releaseRejectionGuard = attachBrowserClosedRejectionGuard();

  try {
    await extractor.init();
    const crawlResult = await crawlOneConfig(extractor, cfg, label);
    mergeCrawlResult(catalog, crawlResult, cfg, label);
    const persisted = await persistFilmCatalog(catalog, configs);
    logPersistedCatalog(label, persisted, configs.length);
    return { ...persisted, cfg, crawlResult };
  } finally {
    releaseRejectionGuard();
    await extractor.close();
  }
}

async function crawlOneConfig(extractor, cfg, label, { retry = false } = {}) {
  const tag = retry ? ' (retry)' : '';
  console.log(`${hcmLogPrefix()} [phim] ${label}${tag}: ${cfg.subCommand} ${cfg.targetUrl} (${cfg.configPath})`);

  try {
    await ensureFilmBrowser(extractor);

    if (cfg.subCommand === 'match') {
      const result = await extractor.extractFromMatch(cfg.targetUrl, {
        serverTabsSelector: cfg.serverTabsSelector,
      });
      console.log(
        `${hcmLogPrefix()} [phim] ${label}: 1 phim, ${result.streams?.length ?? 0} tập`,
      );
      return { ok: true, entries: [{ result, cfg }], results: [result] };
    } else {
      const limit = parseLimit(cfg.limitArg, 100);
      const list = await extractor.extractAll(cfg.targetUrl, {
        limit,
        itemSelector: cfg.itemSelector,
        serverTabsSelector: cfg.serverTabsSelector,
      });
      console.log(
        `${hcmLogPrefix()} [phim] ${label}: ${list.length} phim, ${countStreams(list)} stream(s)`,
      );
      return {
        ok: true,
        entries: list.map((result) => ({ result, cfg })),
        results: list,
      };
    }
  } catch (err) {
    console.error(
      `${hcmLogPrefix()} [phim] ${label}: failed ${cfg.targetUrl}: ${err.message}`,
    );
    if (!retry && isBrowserClosedError(err)) {
      await restartFilmBrowser(extractor).catch(() => {});
      return crawlOneConfig(extractor, cfg, label, { retry: true });
    }
    return { ok: false, entries: [], results: [], error: err };
  }
}

function mergeCrawlResult(catalog, crawlResult, cfg, label) {
  const entries = crawlResult.entries ?? [];

  if (entries.length === 0) {
    console.warn(`${hcmLogPrefix()} [phim] ${label}: không có kết quả mới, giữ catalog cũ: ${cfg.filmTitle || cfg.targetUrl}`);
    return [];
  }

  return entries.map((entry) => {
    const report = mergeFilmResult(catalog, entry);
    logMergeReport(label, entry, report);
    return report;
  });
}

function logMergeReport(label, entry, report) {
  const filmTitle = entry.cfg?.filmTitle || entry.result?.title || entry.result?.matchUrl || entry.cfg?.targetUrl;
  const prefix = `${hcmLogPrefix()} [phim] ${label}:`;

  if (report.action === 'added' || report.action === 'replaced') {
    console.log(`${prefix} đã lưu ${filmTitle}: ${report.newCount} tập (${report.action})`);
    return;
  }

  if (report.action === 'kept') {
    console.warn(`${prefix} giữ bản cũ ${filmTitle}: cũ ${report.oldCount} tập, mới ${report.newCount} tập (${report.reason})`);
    return;
  }

  console.warn(`${prefix} bỏ qua ${filmTitle}: ${report.reason}`);
}

function logPersistedCatalog(label, persisted, totalConfigs) {
  console.log(
    `${hcmLogPrefix()} [phim] ${label}: catalog ${persisted.filmCount}/${totalConfigs} phim, ${persisted.streamCount} tập`,
  );
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
      await fs.access(FILM_CRAWL_LOCK_PATH);
      console.log(`[phim] Đã crawl rồi (${FILM_CRAWL_LOCK_PATH}). Bỏ qua. Dùng: node film-index.js crawl --force`);
      const playlist = await fs.readFile(FILM_M3U_PATH, 'utf-8').catch(() => '#EXTM3U\n');
      return { skipped: true, playlist };
    } catch {
      /* chưa crawl */
    }
  }

  const out = await crawlFilmSources(label);
  await fs.writeFile(FILM_CRAWL_LOCK_PATH, `${formatHcmTime()}\n`, 'utf-8');
  return { ...out, skipped: false };
}

export function crawlLockPath() {
  return FILM_CRAWL_LOCK_PATH;
}

function resolveFilmConfigSpecifier(configs, specifier) {
  const raw = String(specifier || '').trim();
  if (!raw) {
    return null;
  }

  const rawLower = raw.toLowerCase();
  const rawSlug = path.basename(rawLower, '.json');
  const rawAbs = path.resolve(rawLower);

  return (
    configs.find((cfg) => cfg.targetUrl === raw) ??
    configs.find((cfg) => cfg.targetUrl?.toLowerCase() === rawLower) ??
    configs.find((cfg) => path.resolve(String(cfg.configPath || '').toLowerCase()) === rawAbs) ??
    configs.find((cfg) => path.basename(String(cfg.configPath || '').toLowerCase(), '.json') === rawSlug) ??
    configs.find((cfg) => slugFromUrl(cfg.targetUrl) === rawSlug) ??
    null
  );
}

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.split('/').pop()?.split('.')[0]?.toLowerCase() ?? '';
  } catch {
    return '';
  }
}
