import { checkWebsiteStatus } from './siteStatus.js';
import { normalizeDomain } from './dedupe.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CONTACT_PAGE_PATHS = ['/contact', '/contact-us', '/contacts', '/about', '/about-us', '/get-in-touch'];
const HOME_TIMEOUT = 8000;
const PAGE_TIMEOUT = 6000;

const domainEmailCache = new Map();

function isLikelyEmail(email) {
  const cleaned = email.toLowerCase().trim();
  if (!EMAIL_RE.test(cleaned) && !cleaned.includes('@')) return false;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico)$/i.test(cleaned.split('@')[0])) return false;
  if (
    /(@2x|@3x|sentry\.io|wixpress|your-email|your-email-here|@email\.com|@company\.com|@domain\.com|@yourdomain|@yourcompany|@yoursite|@yoursitename|@yourname|@yourbusiness|@placeholder|@noemail|@test\.com|@testing\.com|@website\.com|@example\.co|@mailinator|@yopmail|example@|sample@|your@|test@|email@example|contact@example)/i.test(cleaned)
  ) return false;
  return true;
}

async function fetchText(url, timeout = PAGE_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BusinessFinder/1.0)' }
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function extractEmails(html) {
  const found = new Set();
  const matches = html.match(/href="mailto:([^"?]+)"/gi) || [];
  for (const m of matches) {
    const email = m.replace(/^href="mailto:/i, '').replace(/"/g, '').trim();
    if (isLikelyEmail(email)) found.add(email.toLowerCase());
  }
  for (const m of html.match(EMAIL_RE) || []) {
    if (isLikelyEmail(m)) found.add(m.toLowerCase());
  }
  return [...found];
}

function toAbsolute(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

function pickBestEmail(candidates) {
  const rank = (e) =>
    (/(info|hello|contact|admin|office|sales|mail|inquiries|support)/i.test(e) ? -2 : 0) +
    (/\.(com|co|co\.uk|org|net|io)$/i.test(e) ? -1 : 0) + e.length;
  return candidates.sort((a, b) => rank(a) - rank(b))[0] || null;
}

export async function findEmailForBusiness(business, onLog) {
  const website = business.website;
  if (!website) return { email: null, source: 'none', homeOk: false, homeStatus: null, fromCache: false };

  const domain = normalizeDomain(website);
  if (domain && domainEmailCache.has(domain)) {
    const cached = domainEmailCache.get(domain);
    return { email: cached.email, source: cached.source, homeOk: cached.homeOk, homeStatus: cached.homeStatus, fromCache: true };
  }

  const emails = new Set();
  const home = await fetchText(website, HOME_TIMEOUT);
  if (home.ok) {
    for (const e of extractEmails(home.text)) emails.add(e);
  }

  if (emails.size === 0) {
    const urls = CONTACT_PAGE_PATHS.slice(0, 3).map((p) => toAbsolute(website, p)).filter(Boolean);
    const pages = await Promise.all(urls.map((u) => fetchText(u, PAGE_TIMEOUT)));
    for (const page of pages) {
      if (!page.ok) continue;
      for (const e of extractEmails(page.text)) emails.add(e);
      if (emails.size > 0) break;
    }
  }

  if (emails.size === 0 && home.text) {
    const mailtos = home.text.match(/href="mailto:([^"?]+)"/gi) || [];
    for (const m of mailtos) {
      const email = m.replace(/^href="mailto:/i, '').replace(/"/g, '').trim().toLowerCase();
      if (isLikelyEmail(email)) emails.add(email);
    }
  }

  if (emails.size === 0 && process.env.HUNTER_API_KEY) {
    try {
      const hunterRes = await fetch(
        `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain || website)}&api_key=${process.env.HUNTER_API_KEY}`
      );
      if (hunterRes.ok) {
        const data = await hunterRes.json();
        const first = data?.data?.emails?.[0];
        if (first?.value && isLikelyEmail(first.value)) {
          emails.add(first.value.toLowerCase());
          onLog?.(`  ↑ Hunter.io lookup → ${first.value}`);
        }
      }
    } catch {
      /* fallback silently */
    }
  }

  const email = pickBestEmail([...emails]);
  const result = { email, source: email ? 'website' : 'none', homeOk: home.ok, homeStatus: home.ok ? home.status : null, fromCache: false };
  if (domain) domainEmailCache.set(domain, result);
  return result;
}

const CONCURRENCY = Number(process.env.CONCURRENCY_LIMIT || 5);

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function enrichBusinesses(businesses, onLog, options = {}) {
  const limit = Math.max(1, Math.min(options.concurrency || CONCURRENCY, 20));
  const stats = { websitesChecked: 0, emailsFound: 0, total: businesses.length };
  const onProgress = options.onProgress;

  return runLimited(businesses, limit, async (b) => {
    let find;
    try {
      find = await findEmailForBusiness(b, onLog);
    } catch {
      find = { email: null, source: 'none', homeOk: false, homeStatus: null, fromCache: false };
    }
    b.email = find.email;
    b.emailStatus = find.email ? 'found' : 'none';
    b.emailSource = find.source;

    try {
      if (!b.website) {
        b.websiteStatus = 'No website';
      } else if (find.homeOk) {
        b.websiteStatus = find.homeStatus >= 200 && find.homeStatus < 300 ? 'Active' : `Error ${find.homeStatus}`;
      } else {
        b.websiteStatus = await checkWebsiteStatus(b.website);
      }
      if (b.website) stats.websitesChecked++;
    } catch {
      b.websiteStatus = 'Unknown';
    }

    if (find.email) stats.emailsFound++;
    onLog?.(`  ${b.name}: website ${b.websiteStatus || 'n/a'}, email ${find.email || '—'}`);
    onProgress?.({ ...stats });
    return b;
  });
}