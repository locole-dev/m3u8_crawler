function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('cauthutv') || h.endsWith('cauthutv.cc');
}

async function prepareListingPage(page, { timeout }) {
  const sel = 'a[href*="-vs-"]';
  await page
    .waitForSelector(sel, {
      state: 'attached',
      timeout: Math.min(22000, timeout),
    })
    .catch(() => {});
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5)).catch(() => {});
  await sleep(400);
}

function filterListingMatch(m) {
  const href = (m.href || '').toLowerCase();
  return href.includes('-vs-') && href.includes('cauthutv.cc');
}

export const cauthutvSiteProfile = {
  id: 'cauthutv',
  matchHost,
  listingItemSelector: 'a[href*="-vs-"]',
  serverTabsSelector: null,
  networkIdleCapMs: 10000,
  scrollPasses: 2,
  skipHtmlFetchFallback: false,
  prepareListingPage,
  filterListingMatch,
};
