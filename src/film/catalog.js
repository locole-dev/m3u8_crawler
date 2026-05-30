import fs from 'fs/promises';
import path from 'path';

import { buildFilmCatalogPlaylist } from './playlist.js';
import {
  ensureFilmOutputDir,
  FILM_JSON_PATH,
  FILM_M3U_PATH,
} from './paths.js';

export function filmCatalogKey(cfg, result = null) {
  return normalizeUrl(result?.matchUrl) || normalizeUrl(cfg?.targetUrl) || normalizePath(cfg?.configPath);
}

export async function loadFilmCatalog(configs = []) {
  await ensureFilmOutputDir();

  const catalog = new Map();
  const raw = await fs.readFile(FILM_JSON_PATH, 'utf-8').catch((error) => {
    if (error.code !== 'ENOENT') {
      console.warn(`[phim] cannot read ${FILM_JSON_PATH}: ${error.message}`);
    }
    return null;
  });

  if (!raw) {
    return catalog;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[phim] cannot parse ${FILM_JSON_PATH}: ${error.message}`);
    return catalog;
  }

  const results = Array.isArray(parsed) ? parsed : [];
  for (const result of results) {
    if (!result || typeof result !== 'object' || streamCount(result) === 0) {
      continue;
    }

    const cfg = findConfigForResult(result, configs);
    if (!cfg) {
      continue;
    }

    catalog.set(filmCatalogKey(cfg, result), { result, cfg });
  }

  return catalog;
}

export function mergeFilmResult(catalog, { result, cfg }) {
  const key = filmCatalogKey(cfg, result);
  if (!key || !result) {
    return { action: 'skipped', reason: 'invalid-result', key, oldCount: 0, newCount: 0 };
  }

  const existing = catalog.get(key);
  const oldCount = streamCount(existing?.result);
  const newCount = streamCount(result);
  const isPartial = Boolean(result.timedOut || result.error);

  if (newCount === 0) {
    if (existing) {
      return { action: 'kept', reason: 'empty-result', key, oldCount, newCount };
    }
    return { action: 'skipped', reason: 'empty-result', key, oldCount, newCount };
  }

  if (existing && isPartial && newCount < oldCount) {
    return { action: 'kept', reason: 'partial-smaller', key, oldCount, newCount };
  }

  catalog.set(key, { result, cfg });
  return {
    action: existing ? 'replaced' : 'added',
    reason: isPartial ? 'partial-saved' : 'ok',
    key,
    oldCount,
    newCount,
  };
}

export async function persistFilmCatalog(catalog, configs = []) {
  await ensureFilmOutputDir();

  const filmEntries = orderedFilmEntries(catalog, configs);
  const results = filmEntries.map(({ result }) => result);
  const playlist = buildFilmCatalogPlaylist(filmEntries);

  await writeAtomic(FILM_JSON_PATH, `${JSON.stringify(results, null, 2)}\n`);
  await writeAtomic(FILM_M3U_PATH, playlist);

  return {
    filmEntries,
    results,
    playlist,
    filmCount: filmEntries.length,
    streamCount: countStreams(results),
  };
}

export function orderedFilmEntries(catalog, configs = []) {
  const ordered = [];
  const seen = new Set();

  for (const cfg of configs) {
    const directKey = filmCatalogKey(cfg);
    const direct = catalog.get(directKey);
    if (direct && !seen.has(directKey)) {
      ordered.push(direct);
      seen.add(directKey);
    }

    for (const [key, entry] of catalog.entries()) {
      if (seen.has(key)) {
        continue;
      }
      if (sameConfig(entry.cfg, cfg)) {
        ordered.push(entry);
        seen.add(key);
      }
    }
  }

  return ordered;
}

export function countStreams(results) {
  return results.reduce((n, r) => n + streamCount(r), 0);
}

export function streamCount(result) {
  return Array.isArray(result?.streams) ? result.streams.length : 0;
}

async function writeAtomic(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;

  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

function findConfigForResult(result, configs) {
  const matchUrl = normalizeUrl(result?.matchUrl);
  if (!matchUrl) {
    return null;
  }

  return configs.find((cfg) => normalizeUrl(cfg.targetUrl) === matchUrl) ?? null;
}

function sameConfig(a, b) {
  if (!a || !b) {
    return false;
  }

  const aUrl = normalizeUrl(a.targetUrl);
  const bUrl = normalizeUrl(b.targetUrl);
  if (aUrl && bUrl && aUrl === bUrl) {
    return true;
  }

  const aPath = normalizePath(a.configPath);
  const bPath = normalizePath(b.configPath);
  return Boolean(aPath && bPath && aPath === bPath);
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  return raw ? path.normalize(raw).toLowerCase() : '';
}
