function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('oastaug') || h.includes('colatv') || h.endsWith('colatv.live');
}

async function prepareListingPage(page, { timeout }) {
  const sel = 'a.blv-link[href*="houseId"]';
  await page
    .waitForSelector(sel, {
      state: 'attached',
      timeout: Math.min(28000, timeout),
    })
    .catch(() => {});
  await sleep(1000);
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight * 0.4, 1200))).catch(() => {});
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(800);
}

function filterListingMatch(m) {
  const href = (m.href || '').toLowerCase();
  return href.includes('/truc-tiep/') && href.includes('-vs-') && href.includes('houseid=');
}

function slugToMatchMeta(href) {
  try {
    const path = new URL(href).pathname;
    const m = path.match(/\/truc-tiep\/(.+)-luc-(\d{4})-ngay-(\d{2}-\d{2}-\d{4})/i);
    if (!m) return null;

    const body = m[1];
    const vsIdx = body.lastIndexOf('-vs-');
    if (vsIdx === -1) return null;

    const home = body.slice(0, vsIdx).replace(/-/g, ' ');
    const away = body.slice(vsIdx + 4).replace(/-/g, ' ');
    const hhmm = m[2];
    const [day, month, year] = m[3].split('-');

    return {
      home,
      away,
      schedule: `${hhmm.slice(0, 2)}:${hhmm.slice(2)} ${day}/${month}/${year}`,
    };
  } catch {
    return null;
  }
}

function formatTeamName(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^(fc|am|vs|u17|u21|clb)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function resolveListingTitle(match) {
  const meta = slugToMatchMeta(match.href);
  const blvRaw = String(match.title || '').trim();
  const blv = blvRaw.replace(/^BLV\s+/i, '').trim();

  if (!meta) {
    return blvRaw || match.href;
  }

  const parts = [
    `${formatTeamName(meta.home)} vs ${formatTeamName(meta.away)}`,
    meta.schedule,
  ];
  if (blv) parts.push(`BLV ${blv}`);
  return parts.join(' | ');
}

export const colatvSiteProfile = {
  id: 'colatv',
  matchHost,
  listingItemSelector: 'a.blv-link[href*="houseId"]',
  serverTabsSelector: null,
  networkIdleCapMs: 12000,
  scrollPasses: 2,
  skipHtmlFetchFallback: false,
  prepareListingPage,
  filterListingMatch,
  resolveListingTitle,
};
