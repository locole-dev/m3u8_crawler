import { M3U8Extractor } from '../M3U8Extractor.js';
import { resolveFilmProfile } from './registry.js';

const DEFAULT_FILM_TIMEOUT = 120000;
const DEFAULT_SERIES_TIMEOUT = 900000;

const FILM_AD_BLOCK_PATTERNS = [
  '**/*excavatenearbywand*',
  '**/*doubleclick*',
  '**/*googlesyndication*',
];

function parseFilmHeadless() {
  const raw = process.env.FILM_HEADLESS ?? process.env.HEADLESS ?? 'false';
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

/**
 * Crawler phim — profile + timeout riêng, không dùng registry bóng đá.
 */
export class FilmExtractor extends M3U8Extractor {
  constructor(options = {}) {
    super({
      ...options,
      resolveProfile: resolveFilmProfile,
      filmMode: true,
      headless: options.headless ?? parseFilmHeadless(),
      timeout:
        options.timeout ??
        (Number.parseInt(process.env.FILM_TIMEOUT_MS, 10) || DEFAULT_FILM_TIMEOUT),
    });
    this._filmRoutesReady = false;
  }

  async init() {
    await super.init();

    if (!this._filmRoutesReady && this.context) {
      for (const pattern of FILM_AD_BLOCK_PATTERNS) {
        await this.context.route(pattern, (route) => route.abort()).catch(() => {});
      }
      this._filmRoutesReady = true;
    }

    return this;
  }

  async extractFromMatch(matchUrl, options = {}) {
    const profile = this.resolveProfile(matchUrl);
    const seriesTimeout =
      Number.parseInt(process.env.FILM_MATCH_TIMEOUT_MS, 10) ||
      (profile.episodeTabsSelector ? DEFAULT_SERIES_TIMEOUT : this.config.timeout);

    const prev = this.config.timeout;
    this.config.timeout = Math.max(prev, seriesTimeout);
    try {
      return await super.extractFromMatch(matchUrl, options);
    } finally {
      this.config.timeout = prev;
    }
  }

  async close() {
    await super.close();
    this._filmRoutesReady = false;
  }
}
