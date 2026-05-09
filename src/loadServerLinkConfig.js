import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIR = 'server_link';

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

    if (!targetUrl) return null;

    return { subCommand, targetUrl, limitArg, configPath: filePath };
  } catch {
    return null;
  }
}

/**
 * Resolve a single crawl config (legacy — used by CLI fallback).
 * Reads the first available JSON in server_link/, merged with CLI/env defaults.
 */
export async function resolveCrawlConfig(cliDefaults = {}) {
  const configs = await resolveAllCrawlConfigs(cliDefaults);
  return configs.length > 0 ? configs[0] : null;
}

/**
 * Resolve ALL crawl configs from every JSON file in server_link/.
 * Each file = one source to crawl. Falls back to CLI/env if no files found.
 */
export async function resolveAllCrawlConfigs(cliDefaults = {}) {
  const dir = process.env.SERVER_LINK_DIR || DEFAULT_DIR;
  const configs = [];

  try {
    const entries = await fs.readdir(dir);
    const jsonFiles = entries.filter(f => f.endsWith('.json')).sort();

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

  // Fallback: if no JSON files found, use CLI/env defaults
  if (configs.length === 0) {
    const subCommand = String(cliDefaults.subCommand ?? 'list').toLowerCase() === 'match' ? 'match' : 'list';
    const targetUrl = String(cliDefaults.targetUrl ?? '').trim();
    if (targetUrl) {
      configs.push({
        subCommand,
        targetUrl,
        limitArg: cliDefaults.limitArg,
        configPath: '(cli/env fallback)',
      });
    }
  }

  return configs;
}
