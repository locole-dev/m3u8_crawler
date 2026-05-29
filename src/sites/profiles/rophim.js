import { FILM_AUDIO_TAB_SELECTORS } from '../../film/audioTrack.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('rophim') && !h.includes('cobephim');
}

async function prepareMatchPage(page, { timeout }) {
  const current = page.url();
  if (/\/phim\/[^/]+\/?$/i.test(current)) {
    const watchHref = await page
      .locator('a[href*="/xem-phim/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (watchHref) {
      await page.goto(watchHref, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(35000, timeout),
      });
      await sleep(800);
    }
  }

  await page
    .locator('[class*="episode"] a')
    .first()
    .waitFor({ state: 'attached', timeout: Math.min(20000, timeout) })
    .catch(() => {});

  await page
    .waitForSelector('.player, #player, iframe, video', {
      state: 'attached',
      timeout: Math.min(15000, timeout),
    })
    .catch(() => {});

  await page
    .evaluate(() => {
      const box = document.querySelector('[class*="episode"]');
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

export const rophimSiteProfile = {
  id: 'rophim',
  matchHost,
  listingItemSelector: 'a[href*="/xem-phim/"]',
  /** Click từng tập trên cùng trang — giống server tabs khi crawl match */
  episodeTabsSelector: '[class*="episode"] a, [class*="episode"] button, [class*="ep-item"] a, [class*="ep-item"] button',
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
};
