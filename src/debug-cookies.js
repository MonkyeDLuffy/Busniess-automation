import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function run(withCookies) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  if (withCookies) {
    await context.addCookies([
      { name: 'CONSENT', value: 'YES+cb.20220419-08-p0.cs+FX+411', domain: '.google.com', path: '/' },
      { name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyMjA0MTktMF9SQzIaAmVuIAEaBgiAo_GxBg', domain: '.google.com', path: '/' }
    ]);
  }
  const page = await context.newPage();
  await page.goto('https://www.google.com/maps/search/coffee+shops+in+London', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const feedCount = await page.locator('div[role="feed"]').count();
  let feedHtml = '';
  if (feedCount > 0) {
    feedHtml = await page.locator('div[role="feed"]').innerHTML().catch(() => 'ERR');
  }
  let cookieDlg = '';
  const dlg = page.locator('div[role="dialog"]');
  if (await dlg.count().catch(() => 0)) {
    cookieDlg = (await dlg.first().innerText().catch(() => '')).slice(0, 150);
  }
  await browser.close();
  return { feedCount, cookieDlg, feedHtml: feedHtml.slice(0, 2500) };
}

console.log('=== WITHOUT consent cookies ===');
const a = await run(false);
console.log('feedCount:', a.feedCount);
console.log('cookieDlg:', JSON.stringify(a.cookieDlg));
console.log('feedHtml:', a.feedHtml);

console.log('\n=== WITH consent cookies ===');
const b = await run(true);
console.log('feedCount:', b.feedCount);
console.log('cookieDlg:', JSON.stringify(b.cookieDlg));
console.log('feedHtml:', b.feedHtml);