import { defaultSiteProfile } from './profiles/default.js';
import { hoiquan3SiteProfile } from './profiles/hoiquan3.js';
import { cauthutvSiteProfile } from './profiles/cauthutv.js';
import { khandaiaSiteProfile } from './profiles/khandaia.js';
import { colatvSiteProfile } from './profiles/colatv.js';
import { giovangSiteProfile } from './profiles/giovang.js';

/** Bóng đá — không gồm profile phim (xem src/film/registry.js) */
const SPECIFIC_PROFILES = [
  hoiquan3SiteProfile,
  cauthutvSiteProfile,
  khandaiaSiteProfile,
  colatvSiteProfile,
  giovangSiteProfile,
];

export function resolveSiteProfile(listingUrl) {
  let host = '';
  try {
    host = new URL(listingUrl).hostname.toLowerCase();
  } catch {
    return defaultSiteProfile;
  }

  for (const p of SPECIFIC_PROFILES) {
    if (p.matchHost(host)) {
      return p;
    }
  }

  return defaultSiteProfile;
}
