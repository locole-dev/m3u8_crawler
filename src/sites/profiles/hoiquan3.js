function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('hoiquan') || h.endsWith('hoiquan3.live');
}

async function prepareListingPage(page, { timeout }) {
  const sel = 'a[href*="/truc-tiep/"]';
  await page
    .waitForSelector(sel, {
      state: 'attached',
      timeout: Math.min(28000, timeout),
    })
    .catch(() => {});
  await sleep(1000);
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight * 0.35, 900))).catch(() => {});
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(800);
}

import { cleanHoiquanMatchTitle } from '../../matchTitle.js';

/** Bỏ link chỉ là CTA cá cược / không phải trận */
function filterListingMatch(m) {
  const href = (m.href || '').toLowerCase();
  if (!href.includes('/truc-tiep/')) return false;
  const t = (m.title || '').toLowerCase();
  if (t.includes('đặt cược') && t.length < 40) return false;
  return true;
}

export const hoiquan3SiteProfile = {
  id: 'hoiquan3',
  matchHost,
  listingItemSelector: 'a[href*="/truc-tiep/"]',
  serverTabsSelector: '[role="tab"], .nav-tabs a, .nav-tabs button',
  networkIdleCapMs: 12000,
  scrollPasses: 2,
  skipHtmlFetchFallback: false,
  prepareListingPage,
  filterListingMatch,
  cleanMatchTitle: cleanHoiquanMatchTitle,
};
