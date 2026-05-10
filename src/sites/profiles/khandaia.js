function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('khandaia');
}

async function prepareListingPage(page, { timeout }) {
  const selectors = [
    'a[href*="/truc-tiep/"]',
    '.match-hot-card-container a[href]',
    '.match-super-hot-card-container a[href]',
  ];
  for (const sel of selectors) {
    await page.waitForSelector(sel, { state: 'attached', timeout: Math.min(8000, timeout) }).catch(() => {});
  }
  await sleep(600);
}

export const khandaiaSiteProfile = {
  id: 'khandaia',
  matchHost,
  listingItemSelector: 'a[href*="/truc-tiep/"]',
  serverTabsSelector: '.server-item, .list-server a, [class*="server"] a',
  networkIdleCapMs: 10000,
  scrollPasses: 2,
  skipHtmlFetchFallback: false,
  prepareListingPage,
  filterListingMatch: null,
};
