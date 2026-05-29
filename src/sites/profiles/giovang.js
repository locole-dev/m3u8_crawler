function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchHost(hostname) {
  const h = hostname.toLowerCase();
  return h.includes('giovang');
}

async function prepareListingPage(page, { timeout }) {
  const sel = 'a.hrefLiveStream';
  await page
    .waitForSelector(sel, {
      state: 'attached',
      timeout: Math.min(28000, timeout),
    })
    .catch(() => {});
  await sleep(1000);
  await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight * 0.35, 1000))).catch(() => {});
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(800);
}

function filterListingMatch(m) {
  const href = (m.href || '').toLowerCase();
  return href.includes('giovang') && href.includes('/truc-tiep-') && href.includes('-vs-');
}

function formatTeamName(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^(fc|am|vs|u17|u21|clb|5g)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function slugToMatchMeta(href) {
  try {
    const path = new URL(href).pathname.replace(/\/$/, '');
    const m = path.match(/\/truc-tiep-(.+)-vs-(.+)-(\d{2})-(\d{2})-([a-z0-9]+)$/i);
    if (!m) return null;

    const year = new Date().getFullYear();
    return {
      home: m[1].replace(/-/g, ' '),
      away: m[2].replace(/-/g, ' '),
      scheduleDate: `${m[3]}/${m[4]}/${year}`,
    };
  } catch {
    return null;
  }
}

function parseCardMeta(cardText) {
  const text = String(cardText || '');
  const timeMatch = text.match(/(\d{1,2}:\d{2}):?\d{0,2}\s*\|\s*(\d{2}\/\d{2})/);
  const blvMatch = text.match(/\bBLV\s+([A-Za-zÀ-ỹ0-9\s]+?)\s+HT/i);

  return {
    time: timeMatch?.[1] ?? null,
    date: timeMatch?.[2] ?? null,
    blv: blvMatch?.[1]?.trim() ?? null,
  };
}

function resolveListingTitle(match) {
  const meta = slugToMatchMeta(match.href);
  const card = parseCardMeta(match.cardText);

  if (!meta) {
    return match.title || match.href;
  }

  const schedule =
    card.time && card.date
      ? `${card.time} ${card.date}/${new Date().getFullYear()}`
      : meta.scheduleDate;

  const parts = [`${formatTeamName(meta.home)} vs ${formatTeamName(meta.away)}`, schedule];
  if (card.blv) parts.push(`BLV ${card.blv}`);
  return parts.join(' | ');
}

export const giovangSiteProfile = {
  id: 'giovang',
  matchHost,
  listingItemSelector: 'a.hrefLiveStream',
  listingCardSelector: '.item-match-live',
  serverTabsSelector: '[role="tab"], .nav-tabs a, .nav-tabs button, .server-item a',
  networkIdleCapMs: 12000,
  scrollPasses: 2,
  skipHtmlFetchFallback: false,
  prepareListingPage,
  filterListingMatch,
  resolveListingTitle,
};
