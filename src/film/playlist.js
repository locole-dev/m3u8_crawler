import {
  pickPlaybackHeaders,
  sanitizeForExtInf,
} from '../playlist.js';

function sanitizeForQuotedAttr(value) {
  return String(value)
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('"', "'")
    .trim();
}

/** "Xem phim Đời Cải Thảo tập 7 Vietsub..." → "Đời Cải Thảo" */
export function parseFilmSeriesTitle(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';

  t = t
    .replace(/^Xem phim\s+/i, '')
    .replace(/\s+tập\s*\d+.*$/i, '')
    .replace(/\s*[-|]\s*Vietsub.*$/i, '')
    .replace(/\s*[-|]\s*Thuyết Minh.*$/i, '')
    .replace(/\s*[-|]\s*RoPhim.*$/i, '')
    .replace(/\s*[-|]\s*CôBe Phim.*$/i, '')
    .replace(/\s+FHD$/i, '')
    .trim();

  return t;
}

function resolveFilmTitle(result, cfg) {
  const fromCfg = String(cfg?.filmTitle ?? '').trim();
  if (fromCfg) return fromCfg;

  const fromPage = parseFilmSeriesTitle(result?.title);
  if (fromPage) return fromPage;

  try {
    const slug = new URL(result?.matchUrl || cfg?.targetUrl || '').pathname.split('/').pop() || '';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Phim';
  }
}

/**
 * Mỗi phim = 1 nhóm (#EXTGRP + group-title), tập = kênh con "Tên phim | Tập N".
 */
export function buildFilmCatalogPlaylist(filmEntries) {
  const lines = ['#EXTM3U'];
  let channelCount = 0;

  for (const { result, cfg } of filmEntries) {
    const streams = result?.streams ?? [];
    if (streams.length === 0) continue;

    const filmTitle = resolveFilmTitle(result, cfg);
    const groupTitle = sanitizeForQuotedAttr(filmTitle);
    const seriesLabel = sanitizeForExtInf(filmTitle);

    lines.push(`#EXTGRP:${groupTitle}`);

    for (const stream of streams) {
      const headers = pickPlaybackHeaders(stream.headers);
      const epLabel = sanitizeForExtInf(stream.server || 'Tập');
      const displayTitle = `${seriesLabel} | ${epLabel}`;

      lines.push(
        `#EXTINF:-1 tvg-name="${displayTitle}" group-title="${groupTitle}" tvg-group="${groupTitle}",${displayTitle}`,
      );

      if (headers.Referer) {
        lines.push(`#EXTVLCOPT:http-referrer=${headers.Referer}`);
      }
      if (headers['User-Agent']) {
        lines.push(`#EXTVLCOPT:http-user-agent=${headers['User-Agent']}`);
      }

      const kodiParts = [];
      if (headers.Origin) kodiParts.push(`Origin=${encodeURIComponent(headers.Origin)}`);
      if (headers.Referer) kodiParts.push(`Referer=${encodeURIComponent(headers.Referer)}`);
      if (headers['User-Agent']) kodiParts.push(`User-Agent=${encodeURIComponent(headers['User-Agent'])}`);
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

  return `${lines.join('\n')}\n`;
}
