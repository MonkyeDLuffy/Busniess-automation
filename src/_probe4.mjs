import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const urls = [
  'https://www.google.com/maps/place/Vohuman+Cafe/data=!4m7!3m6!1s0x3bc2c0580f2b091d:0x17824b3c0a333279!8m2!3d18.5325972!4d73.8768405!16s%2Fg%2F1yfprvc1p!19sChIJHQkrD1jAwjsReTIzCjxLghc?authuser=0&hl=en&rclk=1',
  'https://www.google.com/maps/place/Zen+Cafe/data=!4m7!3m6!1s0x3bc2c16b78b3763d:0x9ba39123e9e04d69!8m2!3d18.538643!4d73.8865596!16s%2Fg%2F11gnpy4h5p!19sChIJPXazeGvBwjsRaU3g6SORo5s?authuser=0&hl=en&rclk=1',
  'https://www.google.com/maps/place/CAFE+FLYING+GYPSY%27S/data=!4m7!3m6!1s0x3bc2c1641b34664d:0x4067a60f7000cdf4!8m2!3d18.5239789!4d73.8424699!16s%2Fg%2F11pzfmx6w_!19sChIJTWY0G2TBwjsR9M0AcA-mZ0A?authuser=0&hl=en&rclk=1'
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  timezoneId: 'Europe/London'
});
await context.addCookies([
  { name: 'CONSENT', value: 'YES+cb.20220419-08-p0.cs+FX+411', domain: '.google.com', path: '/' },
  { name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyMjA0MTktMF9SQzIaAmVuIAEaBgiAo_GxBg', domain: '.google.com', path: '/' }
]);

const t0 = Date.now();
async function open(i, u) {
  const page = await context.newPage();
  const ts = Date.now();
  try {
    await page.goto(u, { waitUntil: 'commit', timeout: 30000 });
    const g = Date.now() - ts;
    let h1ms = 'nf';
    try {
      await page.locator('h1.DUwDvf, h1.fontHeadlineSmall').first().waitFor({ state: 'attached', timeout: 15000 });
      h1ms = Date.now() - ts - g;
    } catch {}
    console.log(`worker ${i}: goto=${g}ms h1=${h1ms}ms total=${Date.now() - ts}ms`);
  } catch (e) {
    console.log(`worker ${i}: ERROR ${e.message.slice(0, 80)}`);
  } finally {
    await page.close().catch(() => {});
  }
}
await Promise.all(urls.map((u, i) => open(i, u)));
console.log('ALL DONE in', Date.now() - t0, 'ms');
await browser.close();