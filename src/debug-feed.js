import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
context.addCookies([
  { name: 'CONSENT', value: 'YES+cb.20220419-08-p0.cs+FX+411', domain: '.google.com', path: '/' },
  { name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyMjA0MTktMF9SQzIaAmVuIAEaBgiAo_GxBg', domain: '.google.com', path: '/' }
]);
const page = await context.newPage();
await page.goto('https://www.google.com/maps/search/coffee+shops+in+London', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

// list ALL a.hfpxzc anywhere
const all = await page.locator('a.hfpxzc').count();
console.log('a.hfpxzc anywhere:', all);

// check within feed
const inFeed = await page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  if (!feed) return { feedPresent: false };
  const anchors = feed.querySelectorAll('a[href*="/maps/place/"]');
  const arr = [...anchors];
  return {
    feedPresent: true,
    placeAnchors: arr.length,
    sample: arr.slice(0, 3).map((a) => ({
      cls: a.className,
      href: a.getAttribute('href')?.slice(0, 80),
      title: a.getAttribute('aria-label')?.slice(0, 60),
      inner: a.innerHTML.slice(0, 300)
    }))
  };
});
console.log(JSON.stringify(inFeed, null, 2));

await browser.close();