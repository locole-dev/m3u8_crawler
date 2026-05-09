import playwrightExtra from 'playwright-extra';

(async () => {
  const browser = await playwrightExtra.chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://khandaia3.me', { waitUntil: 'networkidle' });
  const count = await page.$$eval('a[href*="truc-tiep"]', as => as.length);
  console.log('truc-tiep links:', count);
  await browser.close();
})();
