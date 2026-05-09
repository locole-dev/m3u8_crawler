import { M3U8Extractor } from './src/M3U8Extractor.js';

(async () => {
  const ext = new M3U8Extractor({ headless: false });
  await ext.init();
  const matches = await ext.listMatches('https://khandaia3.me');
  console.log(`Found ${matches.length} matches initially.`);
  
  const filtered = matches.filter(m => {
    const normalized = m.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return !normalized.includes('sap dau') && !normalized.includes('sap dien ra');
  });
  console.log(`Found ${filtered.length} matches after filtering.`);
  
  await ext.close();
})();
