import { M3U8Extractor } from './src/M3U8Extractor.js';

const TARGETS = [
  'https://cauthutv.cc/',
  'https://sv2.hoiquan3.live/trang-chu',
];

(async () => {
  const ext = new M3U8Extractor({ headless: false });
  await ext.init();

  for (const url of TARGETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${url}`);
    console.log('='.repeat(60));

    try {
      // Step 1: List matches
      const matches = await ext.listMatches(url);
      console.log(`Found ${matches.length} matches:`);
      for (const m of matches.slice(0, 15)) {
        console.log(`  [${m.title?.substring(0, 80)}] → ${m.href}`);
      }

      if (matches.length === 0) {
        console.log('⚠️  No matches found — selectors likely incompatible with this site.');
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
    }
  }

  await ext.close();
})();
