import { FILM_AUDIO_TAB_SELECTORS } from '../../film/audioTrack.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('rophim') && !h.includes('cobephim');
}

function isRophimFamilyHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h.includes('rophim') || h.includes('cobephim');
}

/** getAttribute('href') trả path tương đối — Playwright goto cần URL đầy đủ */
export function resolveWatchHref(href, baseUrl) {
  if (!href || !baseUrl) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

async function readEpisodeLinkHref(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const anchor = el.matches('a[href]') ? el : el.querySelector('a[href]');
      return anchor?.href || null;
    })
    .catch(() => null);
}

async function prepareMatchPage(page, { timeout }) {
  const cap = Math.min(35000, timeout);
  let current = page.url();

  if (/\/phim\/[^/]+\/?$/i.test(current)) {
    const watchHref = await readEpisodeLinkHref(page, 'a[href*="/xem-phim/"]');
    const absolute = resolveWatchHref(watchHref, current);
    if (absolute) {
      await page.goto(absolute, { waitUntil: 'domcontentloaded', timeout: cap });
      await sleep(800);
      current = page.url();
    }
  }

  // Trang tổng /xem-phim/slug (chưa có .episodeId) → mở tập 1 để có player + movieId
  if (/\/xem-phim\/[^/.]+\/?$/i.test(current)) {
    const firstEp = await readEpisodeLinkHref(
      page,
      '#episodes-list a[href*="."], [class*="episode"] a[href*="."]',
    );
    const absolute = resolveWatchHref(firstEp, current);
    if (absolute) {
      await page.goto(absolute, { waitUntil: 'domcontentloaded', timeout: cap });
      await sleep(800);
    }
  }

  await page
    .locator('#episodes-list a, [class*="episode"] a')
    .first()
    .waitFor({ state: 'attached', timeout: Math.min(30000, timeout) })
    .catch(() => {});

  await page
    .waitForSelector('.player, #player, iframe, video', {
      state: 'attached',
      timeout: Math.min(15000, timeout),
    })
    .catch(() => {});

  await page
    .evaluate(() => {
      const box = document.querySelector('#episodes-list, [class*="episode"]');
      box?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    })
    .catch(() => {});

  await sleep(600);
}

/** Chỉ click tab "Tập N", bỏ bản trùng kiểu "P.1 - Tập N". */
function filterTabLabel(label) {
  return /^Tập\s*0*\d+$/i.test(String(label || '').trim());
}

function filterEpisodeHref(href, matchUrl) {
  if (!href || !matchUrl) return true;
  try {
    const slug = new URL(matchUrl).pathname.split('/').pop()?.split('.')[0] ?? '';
    return slug ? href.includes(slug) : true;
  } catch {
    return true;
  }
}

function cleanMatchTitle(title) {
  return String(title || '')
    .replace(/\s*[-|]\s*RoPhim.*$/i, '')
    .replace(/\s*[-|]\s*CôBe Phim.*$/i, '')
    .replace(/\s*Xem phim.*$/i, '')
    .trim();
}

function rophimSlugFromUrl(url) {
  try {
    return new URL(url).pathname.split('/').pop()?.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

async function resolveMovieId(page) {
  return page
    .evaluate(() => {
      const html = document.documentElement.innerHTML || '';
      const normal = html.match(/"movie":\{"id":(\d+)/);
      if (normal) return normal[1];

      const escaped = html.match(/\\"movie\\":\{\\"id\\":(\d+)/);
      if (escaped) return escaped[1];

      const movieId = html.match(/"movieId":(\d+)/);
      if (movieId) return movieId[1];

      return null;
    })
    .catch(() => null);
}

function episodeNumberFromRecord(ep) {
  const byName = Number.parseInt(ep?.name, 10);
  if (Number.isFinite(byName) && byName > 0) return byName;

  const byOrder = Number.parseInt(ep?.episode_order, 10);
  if (Number.isFinite(byOrder) && byOrder > 0) return Math.floor(byOrder / 100);

  return null;
}

function scoreRophimEpisode(ep) {
  const label = `${ep?.server ?? ''} ${ep?.server_type ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let score = 0;
  if (label.includes('voiceover')) score += 1000;
  if (label.includes('thuyet minh') || label.includes('long tieng')) score += 500;
  if (label.includes('ha noi')) score += 50;
  if (label.includes('subtitle') || label.includes('vietsub')) score -= 100;
  return score;
}

async function collectEpisodeItems(page, matchUrl) {
  let hostname;
  try {
    hostname = new URL(matchUrl).hostname;
  } catch {
    return [];
  }

  if (!isRophimFamilyHost(hostname)) {
    return [];
  }

  let movieId = await resolveMovieId(page);
  if (!movieId) {
    const firstHref = await readEpisodeLinkHref(
      page,
      '#episodes-list a[href*="."], [class*="episode"] a[href*="."]',
    );
    const absolute = resolveWatchHref(firstHref, page.url() || matchUrl);
    if (absolute) {
      await page.goto(absolute, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(35000, 60000),
      });
      await sleep(800);
      movieId = await resolveMovieId(page);
    }
  }

  const slug = rophimSlugFromUrl(matchUrl);
  if (!movieId || !slug) {
    return [];
  }

  const apiUrl = new URL(`/baseapi/api/v1/episodes/by-idMovie/${movieId}`, matchUrl).href;
  const rawEpisodes = await page
    .evaluate(async (url) => {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return [];
      return response.json();
    }, apiUrl)
    .catch(() => []);

  if (!Array.isArray(rawEpisodes)) {
    return [];
  }

  const byNum = new Map();
  for (const ep of rawEpisodes) {
    const n = episodeNumberFromRecord(ep);
    if (!n || !ep?.id) continue;

    const current = byNum.get(n);
    const score = scoreRophimEpisode(ep);
    if (!current || score > current.score) {
      byNum.set(n, {
        score,
        label: `Tập ${n}`,
        href: new URL(`/xem-phim/${slug}.${ep.id}`, matchUrl).href,
      });
    }
  }

  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => ({
      label: item.label,
      href: item.href,
    }));
}

export const rophimSiteProfile = {
  id: 'rophim',
  matchHost,
  listingItemSelector: 'a[href*="/xem-phim/"]',
  /** Click từng tập trên cùng trang — giống server tabs khi crawl match */
  episodeTabsSelector: '#episodes-list a, #episodes-list button, [class*="episode"] a, [class*="episode"] button, [class*="ep-item"] a, [class*="ep-item"] button',
  /** RoPhim: bắt buộc chọn server Thuyết minh / Lồng tiếng (không Vietsub) */
  preferThuyetMinhAudio: true,
  audioTabsSelectors: FILM_AUDIO_TAB_SELECTORS,
  filmStreamWaitMs: 14000,
  serverTabsSelector: null,
  filterTabLabel,
  filterEpisodeHref,
  networkIdleCapMs: 12000,
  scrollPasses: 1,
  skipHtmlFetchFallback: true,
  prepareListingPage: null,
  prepareMatchPage,
  filterListingMatch: null,
  cleanMatchTitle,
  collectEpisodeItems,
};
