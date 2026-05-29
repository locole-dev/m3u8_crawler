import { defaultSiteProfile } from '../sites/profiles/default.js';
import { rophimSiteProfile } from '../sites/profiles/rophim.js';
import { cobephimSiteProfile } from '../sites/profiles/cobephim.js';

const FILM_PROFILES = [cobephimSiteProfile, rophimSiteProfile];

export function resolveFilmProfile(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return defaultSiteProfile;
  }

  for (const p of FILM_PROFILES) {
    if (p.matchHost(host)) {
      return p;
    }
  }

  return defaultSiteProfile;
}
