const POSTER_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
  '.film-poster img',
  '.movie-poster img',
  '[class*="poster"] img',
  '[class*="thumb"] img',
  '.detail-poster img',
  'img[itemprop="image"]',
];

export function fallbackFilmPosterUrl(title) {
  const name = encodeURIComponent(String(title || 'Phim').trim().slice(0, 48) || 'Phim');
  return `https://ui-avatars.com/api/?name=${name}&size=512&background=2d3748&color=e2e8f0&format=png`;
}

export async function extractFilmPosterUrl(page, profile = {}) {
  const selectors = profile.posterSelectors ?? POSTER_SELECTORS;

  try {
    const url = await page.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const content = el.getAttribute?.('content') || el.src || el.getAttribute?.('data-src');
        if (content && /^https?:\/\//i.test(content)) return content;
      }
      return '';
    }, selectors);

    if (url) return url.trim();
  } catch {
    /* ignore */
  }

  return '';
}

export function resolveFilmPosterUrl(extracted, filmTitle) {
  const raw = String(extracted || '').trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return fallbackFilmPosterUrl(filmTitle);
}
