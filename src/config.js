import 'dotenv/config';

export const DEFAULT_VIEWPORT = Object.freeze({
  width: 1366,
  height: 768,
});

export function loadConfig(options = {}) {
  const viewport = {
    ...DEFAULT_VIEWPORT,
    ...(options.viewport ?? {}),
  };

  const extraHeaders = {
    'Accept-Language': options.acceptLanguage ?? process.env.ACCEPT_LANGUAGE ?? 'en-US,en;q=0.9',
    ...parseExtraHeaders(process.env.EXTRA_HEADERS),
    ...(options.extraHeaders ?? {}),
  };

  return {
    headless: options.headless ?? parseBoolean(process.env.HEADLESS, true),
    timeout: options.timeout ?? parseInteger(process.env.TIMEOUT_MS, 30000),
    collectMs: options.collectMs ?? parseInteger(process.env.COLLECT_MS, 3000),
    viewport,
    userAgent: options.userAgent ?? emptyToUndefined(process.env.USER_AGENT),
    proxy: normalizeProxy(options.proxy ?? process.env.PROXY),
    extraHeaders,
    locale: options.locale ?? process.env.LOCALE ?? 'en-US',
    launchArgs: options.launchArgs ?? [],
    blockedUrlPatterns:
      options.blockedUrlPatterns ?? parseList(process.env.BLOCKED_URL_PATTERNS, ['**/guard_v1.js']),
  };
}

function emptyToUndefined(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseExtraHeaders(raw) {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseList(raw, fallback = []) {
  if (!raw) {
    return fallback;
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProxy(proxy) {
  if (!proxy) {
    return undefined;
  }

  if (typeof proxy === 'object') {
    return proxy.server ? proxy : undefined;
  }

  const raw = String(proxy).trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    const normalized = { server };

    if (parsed.username) {
      normalized.username = decodeURIComponent(parsed.username);
    }

    if (parsed.password) {
      normalized.password = decodeURIComponent(parsed.password);
    }

    return normalized;
  } catch {
    return { server: raw };
  }
}
