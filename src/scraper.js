import { extractPlaceId, normalizeText } from './dedupe.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_RETRIES = 2;
const DEFAULT_CONCURRENCY = Number(process.env.CONCURRENCY_LIMIT || 5);

function consentCookies() {
  return [
    { name: 'CONSENT', value: 'YES+cb.20220419-08-p0.cs+FX+411', domain: '.google.com', path: '/' },
    { name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyMjA0MTktMF9SQzIaAmVuIAEaBgiAo_GxBg', domain: '.google.com', path: '/' }
  ];
}

async function closePopovers(page, log) {
  const dialog = page.locator('div[role="dialog"]');
  const n = await dialog.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const d = dialog.nth(i);
    const text = normalizeText(await d.innerText({ timeout: 2000 }).catch(() => ''));
    const isConsent = /before you continue|consent|accept all|reject all|personalized/i.test(text);
    if (!isConsent) continue;
    for (const label of ['Reject all', 'Accept all', 'I agree', 'Got it']) {
      const btn = d.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        log('Dismissed Google consent dialog.');
        break;
      }
    }
  }
}

function cleanDisplay(s) {
  return String(s || '')
    .replace(/^[^\p{L}\p{N}\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function waitForResults(page, log, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const n = await page.locator('a.hfpxzc').count().catch(() => 0);
    if (n > 0) return n;
    await closePopovers(page, log);
    try {
      await page.locator('a.hfpxzc, div[role="feed"]').first().waitFor({ state: 'attached', timeout: 1500 });
    } catch {
      /* keep polling */
    }
  }
  return 0;
}

async function scrollFeed(page, log, targetCount) {
  const feed = page.locator('div[role="feed"]').first();
  const box = await feed.boundingBox().catch(() => null);
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 60;
  await page.mouse.move(x, y);
  let stagnant = 0;
  for (let round = 0; round < 60; round++) {
    const n = await page.locator('a.hfpxzc').count().catch(() => 0);
    if (n >= targetCount) return;
    await page.mouse.wheel(0, 3000);
    await closePopovers(page, log);
    try {
      await page.waitForFunction(
        (args) => document.querySelectorAll(args[0]).length > args[1],
        ['a.hfpxzc', n],
        { timeout: 1200 }
      );
      stagnant = 0;
    } catch {
      stagnant++;
    }
    if (stagnant >= 6) return;
  }
}

async function readCandidates(page) {
  const anchors = page.locator('a.hfpxzc');
  const n = await anchors.count().catch(() => 0);
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = anchors.nth(i);
    const href = await a.getAttribute('href', { timeout: 2000 }).catch(() => null);
    const name = await a.getAttribute('aria-label', { timeout: 2000 }).catch(() => null);
    if (!href && !name) continue;
    list.push({
      name: cleanDisplay(name),
      url: href ? new URL(href, 'https://www.google.com').toString() : null,
      placeId: extractPlaceId(href || '')
    });
  }
  return list;
}

async function waitContactData(page, log, timeoutMs = 10000) {
  const sel = 'button[data-item-id="address"], button[data-item-id^="phone:"], a[data-item-id="authority"]';
  try {
    await page.locator(sel).first().waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    log('  (contact block not loaded — capturing visible data)');
    return false;
  }
}

async function extractPlace(page) {
  const place = { name: null, category: null, rating: null, address: null, phone: null, website: null, openStatus: null };
  const T = 3000;

  place.name = cleanDisplay(await page.locator('h1.DUwDvf, h1.fontHeadlineSmall').first().textContent({ timeout: T }).catch(() => null));
  place.category = cleanDisplay(
    await page.locator('button[jsaction*=".category"], a[jsaction*=".category"]').first().textContent({ timeout: T }).catch(() => null)
  );
  place.rating = cleanDisplay(await page.locator('div.F7nice span[aria-hidden="true"]').first().textContent({ timeout: T }).catch(() => null));
  place.address = cleanDisplay(await page.locator('button[data-item-id="address"]').first().textContent({ timeout: T }).catch(() => null));
  place.phone = cleanDisplay(
    await page.locator('button[data-item-id^="phone:"], button[data-item-id^="phone:tel"]').first().textContent({ timeout: T }).catch(() => null)
  );
  place.website = await page.locator('a[data-item-id="authority"]').first().getAttribute('href', { timeout: T }).catch(() => null);

  const statusSel = page
    .locator(
      'span[aria-label^="Open"], span[aria-label^="Closed"], span[aria-label^="Temporarily"], span[aria-label^="Permanently"]'
    )
    .first();
  place.openStatus =
    normalizeText(await statusSel.getAttribute('aria-label', { timeout: T }).catch(() => null)) ||
    normalizeText(await statusSel.textContent({ timeout: T }).catch(() => null));

  return place;
}

function normalizeOpenStatus(s) {
  if (!s) return 'Unknown';
  const m = String(s).match(/^(open|closed|temporarily closed|permanently closed)/i);
  return m ? m[0].charAt(0).toUpperCase() + m[0].slice(1) : 'Unknown';
}

export async function scrapeGoogleMaps(opts = {}) {
  const {
    query,
    maxResults = 10,
    headless = true,
    onLog,
    deduplicator = null,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress = null
  } = opts;
  const log = onLog || (() => {});
  const stats = {
    phase: 'discovery',
    candidatesFound: 0,
    duplicatesSkipped: 0,
    uniqueBusinesses: 0,
    detailFailures: 0,
    total: maxResults
  };
  const emit = () => onProgress?.({ ...stats });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  });
  await context.addCookies(consentCookies());

  const results = [];
  try {
    const feedPage = await context.newPage();
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    log(`Opening ${url}`);
    await feedPage.goto(url, { waitUntil: 'commit', timeout: 60000 });
    await closePopovers(feedPage, log);

    let count = await waitForResults(feedPage, log);
    if (!count) {
      log('No results on first load — reloading to retry (captcha/consent page?).');
      await feedPage.reload({ waitUntil: 'commit', timeout: 60000 });
      await closePopovers(feedPage, log);
      count = await waitForResults(feedPage, log);
    }
    if (!count) {
      log('WARNING: no result links found after retry. This usually means a captcha/consent page — retry in a few minutes.');
      await feedPage.close().catch(() => {});
      return withStats(results, stats);
    }

    const collectTarget = Math.min(maxResults * 2 + 10, 400);
    await scrollFeed(feedPage, log, collectTarget);

    const localSeen = new Set();
    const candidateQueue = [];
    let candidates = [];
    const enqueueFresh = (list) => {
      let added = 0;
      for (const c of list) {
        const key = c.placeId || c.url || c.name;
        if (!key || localSeen.has(key)) {
          if (key) stats.duplicatesSkipped++;
          continue;
        }
        localSeen.add(key);
        candidateQueue.push(c);
        added++;
      }
      candidates = list;
      stats.candidatesFound = list.length;
      return added;
    };

    enqueueFresh(await readCandidates(feedPage));
    stats.candidatesFound = candidates.length;
    log(`Candidates found: ${stats.candidatesFound}`);
    emit();

    const processCandidate = async (page, c) => {
      const prelim = { name: c.name, placeUrl: c.url, placeId: c.placeId };
      if (deduplicator && deduplicator.isDuplicate(prelim)) {
        stats.duplicatesSkipped++;
        return null;
      }
      if (!c.url) {
        stats.detailFailures++;
        return null;
      }

      let place = null;
      for (let attempt = 0; attempt < MAX_RETRIES && !place; attempt++) {
        try {
          if (c.url) {
            await page.goto(c.url, { waitUntil: 'commit', timeout: 30000 });
            await closePopovers(page, log);
          }
          const ok = await page
            .locator('h1.DUwDvf, h1.fontHeadlineSmall')
            .first()
            .waitFor({ state: 'attached', timeout: 12000 })
            .then(() => true)
            .catch(() => false);
          if (!ok) continue;
          await waitContactData(page, log);
          place = await extractPlace(page);
        } catch (e) {
          if (attempt >= MAX_RETRIES - 1) log(`  ✗ ${c.name || '?'}: ${e.message}`);
        }
      }
      if (!place) {
        stats.detailFailures++;
        return null;
      }
      if (!place.name) place.name = c.name;
      if (!place.name) {
        stats.detailFailures++;
        return null;
      }
      place.placeUrl = c.url;
      place.placeId = c.placeId || extractPlaceId(c.url || '');
      place.mapsUrl = c.url;
      place.openStatus = normalizeOpenStatus(place.openStatus);
      place.queryType = query;
      place.foundAt = new Date().toISOString();

      if (deduplicator && deduplicator.checkAndAdd(place)) {
        stats.duplicatesSkipped++;
        return null;
      }
      return place;
    };

    const shouldStop = () => results.length >= maxResults;
    let loadInFlight = Promise.resolve();
    const loadMore = () => {
      const p = loadInFlight
        .then(async () => {
          if (shouldStop()) return;
          const before = candidates.length;
          await scrollFeed(feedPage, log, Math.max(candidates.length + 12, collectTarget));
          const fresh = await readCandidates(feedPage);
          enqueueFresh(fresh);
          if (fresh.length <= before && candidateQueue.length === 0) return;
        })
        .catch(() => {});
      loadInFlight = p;
      return p;
    };

    const worker = async () => {
      const page = await context.newPage();
      try {
        while (!shouldStop()) {
          const c = nextIdx < candidateQueue.length ? candidateQueue[nextIdx++] : null;
          if (!c) {
            const beforeLen = candidateQueue.length;
            await loadMore();
            if (shouldStop()) break;
            if (candidateQueue.length === beforeLen) break;
            continue;
          }
          const b = await processCandidate(page, c);
          if (b && !shouldStop()) {
            results.push(b);
            stats.uniqueBusinesses = results.length;
            log(`  [${results.length}/${maxResults}] ${b.name}${b.website ? ' — ' + b.website : ''}`);
            emit();
          }
        }
      } finally {
        await page.close().catch(() => {});
      }
    };

    let nextIdx = 0;
    const workerCount = Math.max(1, Math.min(concurrency, Math.max(candidateQueue.length, 1)));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await feedPage.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return withStats(results, stats);
}

function withStats(results, stats) {
  results.stats = stats;
  return results;
}
