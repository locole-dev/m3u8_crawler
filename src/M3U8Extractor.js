import playwrightExtra from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

import { loadConfig } from './config.js';
import {
  LISTING_ITEM_SELECTORS,
  PLAY_SELECTORS,
  SERVER_SELECTORS,
} from './selectors.js';
import { resolveSiteProfile } from './sites/registry.js';

const { chromium } = playwrightExtra;
const M3U8_URL_RE = /\.m3u8(\?|$)/i;
const DEFAULT_FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

chromium.use(stealth());

export class M3U8Extractor {
  constructor(options = {}) {
    this.config = loadConfig(options);
    this.browser = null;
    this.context = null;
    this.activeCaptures = new Set();
    this.boundContextRequestHandler = null;
  }

  async init() {
    if (this.context) {
      return this;
    }

    this.browser = await chromium.launch({
      headless: this.config.headless,
      proxy: this.config.proxy,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        ...this.config.launchArgs,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent: this.config.userAgent ?? defaultDesktopUserAgent(this.browser.version()),
      extraHTTPHeaders: this.config.extraHeaders,
      locale: this.config.locale,
      ignoreHTTPSErrors: true,
    });

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    await this.#blockConfiguredUrls();

    this.#attachContextRequestListener();
    return this;
  }

  async listMatches(listingUrl, { itemSelector } = {}) {
    if (!this.context) {
      await this.init();
    }

    const profile = resolveSiteProfile(listingUrl);
    const primarySelector = itemSelector ?? profile.listingItemSelector ?? null;
    const selectors = primarySelector ? [primarySelector] : LISTING_ITEM_SELECTORS;
    const networkCap = profile.networkIdleCapMs ?? 8000;
    const scrollPasses = profile.scrollPasses ?? 1;

    const page = await this.context.newPage();

    try {
      await this.#safeGoto(page, listingUrl);

      if (typeof profile.prepareListingPage === 'function') {
        await profile.prepareListingPage(page, { timeout: this.config.timeout });
      } else if (primarySelector) {
        await page
          .waitForSelector(primarySelector, {
            state: 'attached',
            timeout: Math.min(25000, this.config.timeout),
          })
          .catch(() => {});
        await sleep(800);
      }

      const tryExtract = async () => this.#extractFirstMatchingLinks(page, selectors, listingUrl);

      let matches = await tryExtract();
      if (matches.length > 0) {
        return matches;
      }

      await this.#actHuman(page);
      await this.#waitForQuiet(page, Math.min(networkCap, this.config.timeout));
      matches = await tryExtract();
      if (matches.length > 0) {
        return matches;
      }

      for (let i = 0; i < scrollPasses; i += 1) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await sleep(i === 0 ? 2000 : 1200);
        matches = await tryExtract();
        if (matches.length > 0) {
          return matches;
        }
      }

      if (profile.skipHtmlFetchFallback) {
        return [];
      }
      return this.#fetchListingLinks(listingUrl);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async extractFromMatch(matchUrl, { serverTabsSelector, title } = {}) {
    if (!this.context) {
      await this.init();
    }

    const capture = this.#createCapture();
    this.activeCaptures.add(capture);

    const runPromise = this.#runExtractFromMatch(capture, matchUrl, {
      serverTabsSelector,
      title,
    });
    runPromise.catch(() => {});

    try {
      return await raceWithTimeout([runPromise], this.config.timeout, () => ({
        matchUrl,
        title: title ?? '',
        pageUrl: safePageUrl(this.#latestOpenPage(capture)),
        streams: capture.results,
        timedOut: true,
      }));
    } finally {
      await this.#cleanupCapture(capture);
    }
  }

  async extractAll(listingUrl, { limit = 100, itemSelector, serverTabsSelector } = {}) {
    const profile = resolveSiteProfile(listingUrl);
    let matches = await this.listMatches(listingUrl, { itemSelector });

    if (typeof profile.filterListingMatch === 'function') {
      matches = matches.filter((m) => profile.filterListingMatch(m));
    }

    // Lọc bỏ các trận "Sắp đấu" và "Kết thúc" để đỡ tốn thời gian chờ timeout
    matches = matches.filter((m) => {
      const raw = m.title ?? '';
      const norm = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isUpcoming = norm.includes('sap dau') || norm.includes('sap dien ra');
      const isFinished = norm.includes('ket thuc') || norm.includes('da dien ra');
      return !isUpcoming && !isFinished;
    });

    const selected = matches.slice(0, limit);
    const results = [];
    const tabs = serverTabsSelector ?? profile.serverTabsSelector ?? undefined;

    for (const [index, match] of selected.entries()) {
      const result = await this.extractFromMatch(match.href, {
        serverTabsSelector: tabs,
        title: match.title,
      });
      results.push(result);

      if (index < selected.length - 1) {
        await sleep(randomInt(1000, 3000));
      }
    }

    return results;
  }

  async extract(url) {
    const result = await this.extractFromMatch(url);

    return {
      ...result,
      results: result.streams,
    };
  }

  async close() {
    if (this.context && this.boundContextRequestHandler) {
      this.context.off('request', this.boundContextRequestHandler);
    }

    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = null;
    this.browser = null;
    this.boundContextRequestHandler = null;
    this.activeCaptures.clear();
  }

  #attachContextRequestListener() {
    if (!this.context || this.boundContextRequestHandler) {
      return;
    }

    this.boundContextRequestHandler = (request) => this.#handleContextRequest(request);
    this.context.on('request', this.boundContextRequestHandler);
  }

  async #blockConfiguredUrls() {
    for (const pattern of this.config.blockedUrlPatterns) {
      await this.context.route(pattern, (route) => route.abort()).catch(() => {});
    }
  }

  #handleContextRequest(request) {
    const requestUrl = request.url();

    if (!M3U8_URL_RE.test(requestUrl)) {
      return;
    }

    const requestPage = safeRequestPage(request);

    for (const capture of this.activeCaptures) {
      const belongsToCapture = requestPage
        ? capture.pages.has(requestPage)
        : this.activeCaptures.size === 1;

      if (belongsToCapture) {
        this.#collectM3U8Request(request, capture);
      }
    }
  }

  async #runExtractFromMatch(capture, matchUrl, { serverTabsSelector, title } = {}) {
    const onPage = (page) => this.#trackCapturePage(capture, page);
    this.context.on('page', onPage);

    try {
      const page = await this.context.newPage();
      this.#trackCapturePage(capture, page);

      await this.#safeGoto(page, matchUrl);
      await this.#actHuman(page);
      await sleep(500);

      if (capture.results.length > 0) {
        await sleep(this.config.collectMs);
        return this.#buildMatchResult(capture, matchUrl, title, page);
      }

      await this.#extractFromDefaultPlayer(capture);
      await this.#extractFromServerTabs(capture, serverTabsSelector);

      return this.#buildMatchResult(capture, matchUrl, title, page);
    } catch (error) {
      console.warn(`Extract warning for ${matchUrl}: ${error.message}`);

      return {
        matchUrl,
        title: title ?? '',
        pageUrl: safePageUrl(this.#latestOpenPage(capture)),
        streams: capture.results,
        error: error.message,
      };
    } finally {
      this.context.off('page', onPage);
      capture.currentServerLabel = null;
    }
  }

  async #extractFromServerTabs(capture, preferredSelector) {
    const activePage = this.#latestOpenPage(capture);
    const groups = await this.#findServerTabGroups(activePage, preferredSelector);

    if (groups.length === 0) {
      return;
    }

    let tabOrder = 0;

    for (const group of groups) {
      for (const item of group.items) {
        tabOrder += 1;
        const beforeCount = capture.results.length;
        capture.currentServerLabel = item.label || `server-${tabOrder}`;

        await group.frame
          .locator(group.selector)
          .nth(item.index)
          .click({ timeout: 2000 })
          .catch(() => {});

        await this.#waitForQuiet(this.#latestOpenPage(capture), Math.min(5000, this.config.timeout));
        await this.#actHuman(this.#latestOpenPage(capture));
        await this.#clickPlayAcrossPages(capture);
        await this.#waitForNewStream(capture, beforeCount, Math.min(6000, this.config.timeout));

        if (capture.results.length > beforeCount) {
          await sleep(this.config.collectMs);
        }
      }
    }
  }

  async #buildMatchResult(capture, matchUrl, title, fallbackPage) {
    const finalPage = this.#latestOpenPage(capture) ?? fallbackPage;

    return {
      matchUrl,
      title: title ?? (await this.#safeTitle(finalPage)),
      pageUrl: safePageUrl(finalPage),
      streams: capture.results,
    };
  }

  async #extractFromDefaultPlayer(capture) {
    const beforeCount = capture.results.length;
    capture.currentServerLabel = null;

    await this.#clickPlayAcrossPages(capture);
    const gotStream = await this.#waitForNewStream(capture, beforeCount, this.config.timeout);

    if (!gotStream && capture.results.length === beforeCount) {
      await this.#waitForQuiet(this.#latestOpenPage(capture), Math.min(8000, this.config.timeout));
      await this.#clickPlayAcrossPages(capture);
      await this.#waitForNewStream(capture, beforeCount, this.config.timeout);
    }

    if (capture.results.length > beforeCount) {
      await sleep(this.config.collectMs);
    }
  }

  #createCapture() {
    return {
      pages: new Set(),
      results: [],
      seen: new Set(),
      waiters: new Set(),
      currentServerLabel: null,
      lastPage: null,
    };
  }

  #trackCapturePage(capture, page) {
    if (!page || capture.pages.has(page)) {
      return;
    }

    capture.pages.add(page);
    capture.lastPage = page;
    page.on('close', () => {
      if (capture.lastPage === page) {
        capture.lastPage = this.#latestOpenPage(capture);
      }
    });
  }

  async #cleanupCapture(capture) {
    this.activeCaptures.delete(capture);

    for (const waiter of [...capture.waiters]) {
      waiter.resolve(null);
    }

    await Promise.all([...capture.pages].map((page) => page.close().catch(() => {})));

    capture.pages.clear();
    capture.waiters.clear();
  }

  #collectM3U8Request(request, capture) {
    const requestUrl = request.url();

    if (capture.seen.has(requestUrl)) {
      return null;
    }

    capture.seen.add(requestUrl);

    const result = {
      url: requestUrl,
      headers: request.headers(),
      method: request.method(),
      resourceType: request.resourceType(),
      frameUrl: safeFrameUrl(request),
      pageUrl: safeRequestPageUrl(request),
      server: capture.currentServerLabel,
    };

    capture.results.push(result);

    for (const waiter of [...capture.waiters]) {
      if (capture.results.length > waiter.beforeCount) {
        waiter.resolve(result);
      }
    }

    return result;
  }

  async #waitForNewStream(capture, beforeCount, timeout) {
    if (capture.results.length > beforeCount) {
      return capture.results[beforeCount];
    }

    return new Promise((resolve) => {
      let timeoutId;
      const waiter = {
        beforeCount,
        resolve: (result) => {
          clearTimeout(timeoutId);
          capture.waiters.delete(waiter);
          resolve(result);
        },
      };

      capture.waiters.add(waiter);
      timeoutId = setTimeout(() => {
        capture.waiters.delete(waiter);
        resolve(null);
      }, timeout);
    });
  }

  async #clickPlayAcrossPages(capture) {
    let clicked = false;
    const pages = [...capture.pages].filter((page) => !page.isClosed()).reverse();

    for (const page of pages) {
      if (await this.#clickPlayWithRetry(page)) {
        clicked = true;
      }
    }

    return clicked;
  }

  async #clickPlayWithRetry(page) {
    if (!page || page.isClosed()) {
      return false;
    }

    let clicked = await this.#clickPlayInFrame(page.mainFrame());

    if (!clicked) {
      await this.#waitForQuiet(page, Math.min(8000, this.config.timeout));
      clicked = await this.#clickPlayInFrame(page.mainFrame());
    }

    return clicked;
  }

  async #clickPlayInFrame(frame) {
    let clicked = false;

    for (const selector of PLAY_SELECTORS) {
      try {
        const locator = frame.locator(selector).first();

        if ((await locator.count()) === 0) {
          continue;
        }

        if (!(await locator.isVisible({ timeout: 500 }))) {
          continue;
        }

        await locator.click({
          timeout: 1500,
          force: selector === 'video',
        });

        clicked = true;
        await sleep(randomInt(250, 700));
        break;
      } catch {
        // Player overlays vary a lot; the next selector or frame may still work.
      }
    }

    for (const childFrame of frame.childFrames()) {
      if (await this.#clickPlayInFrame(childFrame)) {
        clicked = true;
      }
    }

    return clicked;
  }

  async #findServerTabGroups(page, preferredSelector) {
    if (!page || page.isClosed()) {
      return [];
    }

    const selectors = preferredSelector ? [preferredSelector] : SERVER_SELECTORS;
    const frames = uniqueFrames(page.frames());
    const groups = [];

    for (const frame of frames) {
      for (const selector of selectors) {
        const group = await this.#readVisibleServerItems(frame, selector);

        if (group.items.length > 0) {
          groups.push(group);
        }
      }
    }

    return groups;
  }

  async #readVisibleServerItems(frame, selector) {
    const locator = frame.locator(selector);
    const count = await locator.count().catch(() => 0);
    const items = [];

    for (let index = 0; index < Math.min(count, 30); index += 1) {
      const item = locator.nth(index);
      const visible = await item.isVisible({ timeout: 300 }).catch(() => false);

      if (!visible) {
        continue;
      }

      const label = await item
        .evaluate((element) => {
          const text = (element.innerText || element.textContent)?.replace(/\s+/g, ' ').trim();
          return (
            text ||
            element.getAttribute('aria-label') ||
            element.getAttribute('title') ||
            element.getAttribute('data-server') ||
            ''
          );
        })
        .catch(() => '');

      items.push({
        index,
        label: label || `server-${items.length + 1}`,
      });
    }

    return {
      frame,
      selector,
      items,
    };
  }

  async #extractLinks(page, selector) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    if (count === 0) {
      return [];
    }

    return locator
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const anchor = element.matches('a[href]')
              ? element
              : element.querySelector('a[href]');

            if (!anchor) {
              return null;
            }

            const href = anchor.href;
            const title =
              anchor.getAttribute('aria-label') ||
              anchor.getAttribute('title') ||
              (anchor.innerText || anchor.textContent)?.replace(/\s+/g, ' ').trim() ||
              (element.innerText || element.textContent)?.replace(/\s+/g, ' ').trim() ||
              href;

            return { title, href };
          })
          .filter(Boolean)
      )
      .then((links) =>
        links.filter(
          (link) =>
            link.href &&
            !link.href.startsWith('javascript:') &&
            !link.href.startsWith('mailto:') &&
            !link.href.startsWith('tel:')
        )
      )
      .catch(() => []);
  }

  async #fetchListingLinks(listingUrl) {
    try {
      const response = await fetch(listingUrl, {
        headers: {
          'User-Agent': this.config.userAgent ?? DEFAULT_FETCH_USER_AGENT,
          'Accept-Language': this.config.extraHeaders['Accept-Language'] ?? 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      return filterLikelyMatchLinks(
        filterSameOriginMatches(dedupeByHref(extractAnchorMatches(html, listingUrl)), listingUrl)
      );
    } catch {
      return [];
    }
  }

  async #extractFirstMatchingLinks(page, selectors, listingUrl) {
    let allMatches = [];
    for (const selector of selectors) {
      const matches = filterLikelyMatchLinks(
        filterSameOriginMatches(dedupeByHref(await this.#extractLinks(page, selector)), listingUrl)
      );
      allMatches.push(...matches);
    }
    return dedupeByHref(allMatches);
  }

  async #safeGoto(page, url) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });
    } catch (error) {
      console.warn(`Navigation warning for ${url}: ${error.message}`);
    }
  }

  async #waitForQuiet(page, timeout) {
    if (!page || page.isClosed()) {
      return;
    }

    await page
      .waitForLoadState('networkidle', {
        timeout,
      })
      .catch(() => {});
  }

  async #safeTitle(page) {
    if (!page || page.isClosed()) {
      return '';
    }

    return page.title().catch(() => '');
  }

  #latestOpenPage(capture) {
    if (capture.lastPage && !capture.lastPage.isClosed()) {
      return capture.lastPage;
    }

    return [...capture.pages].reverse().find((page) => !page.isClosed()) ?? null;
  }

  async #actHuman(page) {
    if (!page || page.isClosed()) {
      return;
    }

    try {
      await page.mouse.move(randomInt(160, 520), randomInt(160, 420), {
        steps: randomInt(8, 18),
      });
      await page.mouse.wheel(0, randomInt(120, 420));
      await sleep(randomInt(350, 900));
    } catch {
      // Human-like input is best-effort only.
    }
  }
}

function dedupeByHref(matches) {
  const seen = new Map();
  const deduped = [];

  for (const match of matches) {
    const existing = seen.get(match.href);

    if (existing) {
      if (titleScore(match, match.href) > titleScore(existing, existing.href)) {
        existing.title = match.title;
      }

      continue;
    }

    seen.set(match.href, match);
    deduped.push(match);
  }

  return deduped;
}

function titleScore(match, href) {
  const title = match.title ?? '';

  if (!title || title === href) {
    return 0;
  }

  if (/\bvs\b/i.test(title)) {
    return 3;
  }

  if (title.length > 8) {
    return 2;
  }

  return 1;
}

function filterSameOriginMatches(matches, listingUrl) {
  let origin;

  try {
    origin = new URL(listingUrl).origin;
  } catch {
    return matches;
  }

  return matches.filter((match) => {
    try {
      return new URL(match.href).origin === origin;
    } catch {
      return false;
    }
  });
}

function filterLikelyMatchLinks(matches) {
  return matches.filter((match) =>
    looksLikeMatchLink({
      href: match.href,
      title: match.title,
      className: match.className ?? '',
    })
  );
}

function extractAnchorMatches(html, baseUrl) {
  const matches = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(html))) {
    const attrs = parseAttributes(match[1]);
    const href = attrs.href;

    if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
      continue;
    }

    const absoluteHref = toAbsoluteUrl(href, baseUrl);

    if (!absoluteHref) {
      continue;
    }

    const innerText = normalizeText(stripTags(match[2]));
    const title = normalizeText(attrs['aria-label'] || attrs.title || innerText || absoluteHref);
    const className = attrs.class || '';

    if (!looksLikeMatchLink({ href: absoluteHref, title, className })) {
      continue;
    }

    matches.push({
      title,
      href: absoluteHref,
    });
  }

  return matches;
}

function looksLikeMatchLink({ href, title, className }) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const path = url.pathname.toLowerCase();
  const text = `${title} ${className}`.toLowerCase();

  return (
    /\bvs\b/i.test(title) ||
    text.includes('match') ||
    text.includes('live') ||
    path.includes('-vs-')
  );
}

function parseAttributes(rawAttrs) {
  const attrs = {};
  const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attrRe.exec(rawAttrs))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }

  return attrs;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function normalizeText(value) {
  return decodeHtml(String(value).replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

function safeFrameUrl(request) {
  try {
    return request.frame()?.url() ?? null;
  } catch {
    return null;
  }
}

function safeRequestPage(request) {
  try {
    return request.frame()?.page() ?? null;
  } catch {
    return null;
  }
}

function safeRequestPageUrl(request) {
  try {
    return request.frame()?.page()?.url() ?? null;
  } catch {
    return null;
  }
}

function safePageUrl(page) {
  try {
    return page?.url() ?? null;
  } catch {
    return null;
  }
}

function uniqueFrames(frames) {
  return [...new Set(frames)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function defaultDesktopUserAgent(browserVersion) {
  const version = browserVersion.match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? '124.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function raceWithTimeout(promises, timeout, onTimeout = () => null) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(onTimeout()), timeout);
  });

  try {
    return await Promise.race([...promises, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
