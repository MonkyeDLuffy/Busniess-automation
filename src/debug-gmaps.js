import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
const page = await context.newPage();

// Capture console & failed requests
page.on('console', (msg) => console.log('CONSOLE:', msg.type(), msg.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('https://www.google.com/maps/search/coffee%20shops%20in%20London', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

console.log('URL:', page.url());
console.log('TITLE:', await page.title());

const body = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1500) : 'NO BODY');
console.log('BODY TEXT:\n', body);

const cnt = await page.locator('div[role="dialog"], form, input#searchboxinput, div[role="feed"]').count();
console.log('DIALOG/FORM/INPUT/FEED count:', cnt);
if (cnt > 0) {
  const info = await page.evaluate(() => {
    return [...document.querySelectorAll('div[role="dialog"], form, input#searchboxinput, div[role="feed"]')]
      .slice(0, 6)
      .map((el) => ({ tag: el.tagName, role: el.getAttribute('role'), id: el.id, txt: (el.innerText || '').slice(0, 120) }));
  });
  console.log('ELEMS:', JSON.stringify(info, null, 2));
}

await page.screenshot({ path: 'debug-screen.png', fullPage: false });
console.log('screenshot saved');
await browser.close();