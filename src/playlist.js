import { cleanMatchTitle as formatMatchTitle } from './matchTitle.js';

export function buildIptvPlaylist(results, { sourceUrl, groupName, resolveProfile } = {}) {
  const lines = ['#EXTM3U'];
  let channelCount = 0;

  for (const result of results) {
    const streams = result?.streams ?? [];
    const rawTitle = result?.title || result?.matchUrl || 'Unknown';
    const profile = sourceUrl && resolveProfile ? resolveProfile(sourceUrl) : null;
    const baseTitle = sanitizeForExtInf(formatMatchTitle(rawTitle, { profile }));

    for (const [index, stream] of streams.entries()) {
      const headers = pickPlaybackHeaders(stream.headers);
      const serverLabel = sanitizeForExtInf(stream.server || `server-${index + 1}`);
      const channelName = `${baseTitle} | ${serverLabel}`;
      const groupTitle = groupName
        ? sanitizeForQuotedAttr(groupName)
        : sanitizeForQuotedAttr(domainGroupName(stream.pageUrl || sourceUrl));
      const displayTitle = sanitizeForExtInf(channelName);

      lines.push(`#EXTINF:-1 tvg-name="${displayTitle}" group-title="${groupTitle}",${displayTitle}`);

      if (headers.Referer) {
        lines.push(`#EXTVLCOPT:http-referrer=${headers.Referer}`);
      }

      if (headers['User-Agent']) {
        lines.push(`#EXTVLCOPT:http-user-agent=${headers['User-Agent']}`);
      }

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

export function pickPlaybackHeaders(headers) {
  const wanted = ['referer', 'origin', 'user-agent', 'cookie'];
  const normalized = {};

  for (const [name, value] of Object.entries(headers ?? {})) {
    if (wanted.includes(name.toLowerCase()) && value) {
      normalized[toHeaderCase(name)] = value;
    }
  }

  if (!normalized.Origin && normalized.Referer) {
    try {
      normalized.Origin = new URL(normalized.Referer).origin;
    } catch {}
  }

  return normalized;
}

export function domainGroupName(url) {
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

export function parseLimit(value, fallback = 100) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toHeaderCase(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');
}

export function sanitizeForExtInf(value) {
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
