import { defaultSiteProfile } from './profiles/default.js';
import { hoiquan3SiteProfile } from './profiles/hoiquan3.js';
import { cauthutvSiteProfile } from './profiles/cauthutv.js';
import { khandaiaSiteProfile } from './profiles/khandaia.js';

/** Thứ tự: site cụ thể trước, default cuối không dùng trong vòng lặp */
const SPECIFIC_PROFILES = [hoiquan3SiteProfile, cauthutvSiteProfile, khandaiaSiteProfile];

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
