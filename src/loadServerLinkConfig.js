import fs from 'fs/promises';
import path from 'path';

export const FOOTBALL_DIR = 'server_link/football';
export const FILM_DIR = 'server_link/phim';

/**
 * Read a single JSON config file and return a normalized crawl config object.
 */
function parseConfigFile(raw, filePath) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const rawSub = parsed.subCommand ?? 'list';
    const subCommand = String(rawSub).toLowerCase() === 'match' ? 'match' : 'list';
    const targetUrl = String(parsed.targetUrl || parsed.listingUrl || parsed.url || '').trim();

    let limitArg;
    if (parsed.limit !== undefined && parsed.limit !== null && String(parsed.limit).trim() !== '') {
      limitArg = String(parsed.limit);
    }

    const groupNameRaw = parsed.groupName;
    const groupName = groupNameRaw !== undefined && groupNameRaw !== null && String(groupNameRaw).trim() !== ''
        ? String(groupNameRaw).trim()
        : undefined;

    const filmTitleRaw = parsed.filmTitle ?? parsed.title;
    const filmTitle =
      filmTitleRaw !== undefined && filmTitleRaw !== null && String(filmTitleRaw).trim() !== ''
        ? String(filmTitleRaw).trim()
        : undefined;

    const itemSelectorRaw = parsed.itemSelector ?? parsed.listingItemSelector;
    const itemSelector =
      itemSelectorRaw !== undefined && itemSelectorRaw !== null && String(itemSelectorRaw).trim() !== ''
        ? String(itemSelectorRaw).trim()
        : undefined;

    const serverTabsRaw = parsed.serverTabsSelector;
    const serverTabsSelector =
      serverTabsRaw !== undefined && serverTabsRaw !== null && String(serverTabsRaw).trim() !== ''
        ? String(serverTabsRaw).trim()
        : undefined;

    if (!targetUrl) return null;

    return {
      subCommand,
      targetUrl,
      limitArg,
      itemSelector,
      serverTabsSelector,
      groupName,
      filmTitle,
      configPath: filePath,
    };
  } catch {
    return null;
  }
}

async function readConfigsFromDir(dir, cliDefaults = {}) {
  const configs = [];

  try {
    const entries = await fs.readdir(dir);
    const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();

    for (const file of jsonFiles) {
      const filePath = path.join(dir, file);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const cfg = parseConfigFile(raw, filePath);
        if (cfg) configs.push(cfg);
      } catch (e) {
        console.warn(`[server_link] Failed to read ${filePath}: ${e.message}`);
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[server_link] Cannot read directory ${dir}: ${e.message}`);
    }
  }

  return configs;
}

function applyCliFallback(configs, cliDefaults) {
  if (configs.length > 0) return configs;

  const subCommand = String(cliDefaults.subCommand ?? 'list').toLowerCase() === 'match' ? 'match' : 'list';
  const targetUrl = String(cliDefaults.targetUrl ?? '').trim();
  if (targetUrl) {
    return [
      {
        subCommand,
        targetUrl,
        limitArg: cliDefaults.limitArg,
        itemSelector: undefined,
        serverTabsSelector: undefined,
        groupName: undefined,
        configPath: '(cli/env fallback)',
      },
    ];
  }

  return configs;
}

/**
 * Resolve ALL crawl configs from a directory of JSON files.
 */
export async function resolveAllCrawlConfigs(cliDefaults = {}, options = {}) {
  const dir =
    options.dir ??
    process.env.SERVER_LINK_DIR ??
    (options.category === 'film' ? process.env.SERVER_LINK_FILM_DIR || FILM_DIR : process.env.SERVER_LINK_FOOTBALL_DIR || FOOTBALL_DIR);

  const configs = await readConfigsFromDir(dir);
  return applyCliFallback(configs, cliDefaults);
}

/** Football sources: server_link/football/*.json */
export async function resolveFootballConfigs(cliDefaults = {}) {
  const dir = process.env.SERVER_LINK_FOOTBALL_DIR || FOOTBALL_DIR;
  const configs = await readConfigsFromDir(dir);
  return applyCliFallback(configs, cliDefaults);
}

/** Film sources: server_link/phim/*.json */
export async function resolveFilmConfigs(cliDefaults = {}) {
  const dir = process.env.SERVER_LINK_FILM_DIR || FILM_DIR;
  return readConfigsFromDir(dir);
}

/**
 * Resolve a single crawl config (legacy — used by CLI fallback).
 * Reads the first available JSON in football folder.
 */
export async function resolveCrawlConfig(cliDefaults = {}) {
  const configs = await resolveFootballConfigs(cliDefaults);
  return configs.length > 0 ? configs[0] : null;
}
