import fs from 'fs/promises';

const DEFAULT_RELATIVE_PATH = 'server_link/khandai.json';

/**
 * Merge crawl settings from server_link JSON (re-read each call) with CLI/env fallbacks.
 * JSON fields: subCommand (list|match), targetUrl | listingUrl | url, limit (number)
 */
export async function resolveCrawlConfig(cliDefaults = {}) {
  const configPath = process.env.SERVER_LINK_CONFIG || DEFAULT_RELATIVE_PATH;
  const subCli = cliDefaults.subCommand ?? 'list';
  const urlCli = String(cliDefaults.targetUrl ?? '').trim();
  const limitCli = cliDefaults.limitArg;

  let fileData = {};
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    fileData = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[server_link] ${configPath}: ${e.message}`);
    }
  }

  const rawSub = fileData.subCommand ?? subCli;
  const subCommand = String(rawSub).toLowerCase() === 'match' ? 'match' : 'list';

  const targetUrl = String(
    fileData.targetUrl || fileData.listingUrl || fileData.url || urlCli || '',
  ).trim();

  let limitArg = limitCli;
  if (
    fileData.limit !== undefined &&
    fileData.limit !== null &&
    String(fileData.limit).trim() !== ''
  ) {
    limitArg = String(fileData.limit);
  }

  if (!targetUrl) {
    return null;
  }

  return { subCommand, targetUrl, limitArg, configPath };
}
