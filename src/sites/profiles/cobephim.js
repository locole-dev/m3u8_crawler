import { rophimSiteProfile } from './rophim.js';

function matchHost(hostname) {
  return hostname.toLowerCase().includes('cobephim');
}

/** CôBe Phim: navigate thẳng URL từng tập; chờ stream lâu hơn RoPhim */
export const cobephimSiteProfile = {
  ...rophimSiteProfile,
  id: 'cobephim',
  matchHost,
  episodeNavigateByGoto: true,
  filmStreamWaitMs: 16000,
  filmRetryStreamWaitMs: 20000,
  filmGotoSleepMs: 1500,
};
