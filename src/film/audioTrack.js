/** Hàng server RoPhim: #Hà Nội (Vietsub) | #Hà Nội (Thuyết Minh) — không nhầm với Tập N */
export const FILM_AUDIO_TAB_SELECTORS = [
  '[class*="phimus"] a',
  '[class*="phimus"] button',
  '[class*="phimus"] [role="button"]',
  '[class*="phimus"] li',
  '.phimus-server-item',
  '.server-item',
  '.server-item a',
  '.server-item button',
  '.list-server a',
  '.list-server button',
  '.servers a',
  '.servers button',
  '[class*="server-list"] a',
  '[class*="server-list"] button',
  '[class*="track"] a',
  '[class*="track"] button',
  '.btn-tab',
  '.nav-tabs a',
  '.nav-tabs button',
];

/** RoPhim: ô có "(Thuyết Minh)" trong text */
export const ROPHIM_TM_TEXT_LOCATOR =
  'a, button, [role="button"], [role="tab"], li, span, div';

const PREFERRED_AUDIO_PATTERNS = [
  /\(\s*thuy[eê]t\s*minh\s*\)/i,
  /\(\s*l[oồ]ng\s*ti[eế]ng\s*\)/i,
  /thuy[eê]t\s*minh/i,
  /l[oồ]ng\s*ti[eế]ng/i,
  /\btm\b/i,
  /\blt\b/i,
];

const VIETSUB_AUDIO_PATTERNS = [
  /vietsub/i,
  /ph[uụ]\s*đ[eề]/i,
  /\bsub\b/i,
  /subtitle/i,
  /hardsub/i,
];

export function normalizeAudioLabel(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isEpisodeTabLabel(label) {
  return /^tập\s*0*\d+$/i.test(String(label || '').trim());
}

export function episodeNumberFromLabel(label) {
  const m = String(label || '').match(/Tập\s*(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function formatEpisodeLabel(epNum) {
  return `Tập ${epNum}`;
}

export function scoreFilmStreamUrl(url) {
  const u = String(url).toLowerCase();
  let score = 2;
  if (/\/\d+kb\//.test(u)) score = 1;
  if (u.endsWith('/index.m3u8') || u.includes('/index.m3u8?')) score = 3;
  if (/vietsub|subtitle|subtitles|hardsub|\/sub\//.test(u)) score = 0;
  if (/thuyetminh|thuyet-minh|longtieng|long-tieng|\/tm\/|\/lt\/|\bdub\b/.test(u)) score = 4;
  return score;
}

export function scoreAudioTrackLabel(label) {
  const t = normalizeAudioLabel(label);
  if (!t || isEpisodeTabLabel(label)) return -200;
  if (VIETSUB_AUDIO_PATTERNS.some((re) => re.test(t))) return -100;
  if (PREFERRED_AUDIO_PATTERNS.some((re) => re.test(t))) return 100;
  return 5;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryClickCandidate(best) {
  try {
    await best.click();
    await sleep(600);
    return true;
  } catch {
    return false;
  }
}

async function collectAudioCandidates(frame, selectors) {
  const candidates = [];

  const tmText = frame
    .locator(ROPHIM_TM_TEXT_LOCATOR)
    .filter({ hasText: /\(\s*Thuyết\s*Minh\s*\)|\(\s*Lồng\s*tiếng\s*\)|Thuyết\s*Minh|Lồng\s*tiếng/i });

  const tmCount = await tmText.count().catch(() => 0);
  for (let i = 0; i < Math.min(tmCount, 12); i += 1) {
    const item = tmText.nth(i);
    const visible = await item.isVisible({ timeout: 300 }).catch(() => false);
    if (!visible) continue;

    const label = await item.innerText().catch(() => '');
    const score = scoreAudioTrackLabel(label);
    if (score < 50) continue;

    candidates.push({
      score: score + (/\(\s*Thuyết\s*Minh\s*\)/i.test(label) ? 10 : 0),
      label,
      click: () => item.click({ timeout: 3000 }),
    });
  }

  for (const selector of selectors) {
    const loc = frame.locator(selector);
    const count = await loc.count().catch(() => 0);

    for (let index = 0; index < Math.min(count, 24); index += 1) {
      const item = loc.nth(index);
      const visible = await item.isVisible({ timeout: 200 }).catch(() => false);
      if (!visible) continue;

      const label = await item
        .evaluate((el) =>
          (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .catch(() => '');

      if (!label || label.length > 120 || isEpisodeTabLabel(label)) continue;

      const score = scoreAudioTrackLabel(label);
      candidates.push({
        score,
        label,
        click: () => item.click({ timeout: 3000 }),
      });
    }
  }

  return candidates;
}

/**
 * Click server Thuyết minh / Lồng tiếng (vd. #Hà Nội (Thuyết Minh)).
 * ok:false nếu chỉ có Vietsub hoặc click thất bại.
 */
export async function selectPreferredFilmAudio(page, profile = {}) {
  const selectors = profile.audioTabsSelectors ?? FILM_AUDIO_TAB_SELECTORS;
  const candidates = [];
  const frames = [page, ...page.frames()];

  for (const frame of frames) {
    if (frame.isDetached?.()) continue;
    const batch = await collectAudioCandidates(frame, selectors);
    candidates.push(...batch);
  }

  if (candidates.length === 0) {
    return { ok: true, reason: 'no-audio-tabs', label: null };
  }

  const preferred = candidates.filter((c) => c.score >= 50);
  if (preferred.length === 0) {
    if (candidates.every((c) => c.score < 0)) {
      return { ok: false, reason: 'only-vietsub', label: null };
    }
    return { ok: true, reason: 'single-or-unknown', label: null };
  }

  preferred.sort((a, b) => b.score - a.score);
  const best = preferred[0];
  const clicked = await tryClickCandidate(best);

  if (!clicked) {
    return { ok: false, reason: 'click-failed', label: best.label };
  }

  return { ok: true, reason: 'clicked', label: best.label };
}
