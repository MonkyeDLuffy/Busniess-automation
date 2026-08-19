import fs from 'node:fs';
import path from 'node:path';
import { scrapeGoogleMaps } from './scraper.js';
import { enrichBusinesses } from './emailFinder.js';
import { appendBusinesses } from './sheets.js';
import { appendBusinessesToNocodb, isNocodbConfigured } from './nocodb.js';
import { sendOutreachToAll, emailSendWarning } from './emailSender.js';
import { createDeduplicator, loadKnownFingerprints, saveDedupIndex } from './dedupe.js';
import { startRun as statsStartRun, completeRun as statsCompleteRun } from './stats.js';
import { saveJob, isPersistentStoreConfigured } from './jobStore.js';
import DATA_DIR from './dataDir.js';

const CONCURRENCY = Number(process.env.CONCURRENCY_LIMIT || 5);

export function saveResults(jobId, businesses) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${jobId}.json`);
  fs.writeFileSync(file, JSON.stringify(businesses, null, 2));
  return file;
}

export function saveRunCsv(businesses = [], onLog) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const files = fs.readdirSync(DATA_DIR);
  let n = 1;
  while (files.some((f) => new RegExp(`^Run_${String(n).padStart(3, '0')}\\.csv$`).test(f))) n++;
  const file = path.join(DATA_DIR, `Run_${String(n).padStart(3, '0')}.csv`);
  const headers = [
    'Name', 'Category', 'Address', 'Phone', 'Website', 'Website Status', 'Business Status',
    'Rating', 'Google Maps URL', 'Place ID', 'Email', 'Email Source', 'Query', 'Found At'
  ];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = businesses.map((b) =>
    [
      b.name, b.category, b.address, b.phone, b.website, b.websiteStatus, b.openStatus, b.rating,
      b.mapsUrl || b.placeUrl || '', b.placeId || '', b.email || '', b.emailSource || '', b.queryType || '', b.foundAt || ''
    ].map(escape)
  );
  fs.writeFileSync(file, [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'));
  onLog?.(`Saved CSV to ${file}`);
  return file;
}

function serializeJob(job) {
  return {
    id: job.id,
    state: job.state,
    options: job.options,
    log: job.log,
    businesses: job.businesses,
    stats: job.stats,
    error: job.error,
    updatedAt: new Date().toISOString()
  };
}

export function createJob(opts) {
  const base = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    state: 'idle',
    log: [],
    businesses: [],
    error: null,
    stats: {},
    options: { ...opts }
  };
  let lastPersist = 0;
  let writeChain = Promise.resolve();
  const persist = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPersist < 2000) return writeChain;
    lastPersist = now;
    writeChain = writeChain.then(() => saveJob(base)).catch(() => {});
    return writeChain;
  };
  base.logPush = (m) => {
    base.log.push(`[${new Date().toLocaleTimeString()}] ${m}`);
    persist();
  };
  base.serialize = () => serializeJob(base);
  const job = new Proxy(base, {
    set(target, prop, value) {
      target[prop] = value;
      if (prop !== 'persist') persist();
      return true;
    }
  });
  job.persist = persist;
  return job;
}

/**
 * Run the full pipeline (background job — job object is mutated in memory).
 * @param {object} opts {location, businessType, maxResults, headless, sendEmails, writeSheet, writeNocodb, skipKnown, concurrency}
 * @returns {Promise<object>} the completed job
 */
export async function startPipeline(opts) {
  const job = createJob(opts);
  try {
    await runJob(job);
  } catch (e) {
    job.state = 'error';
    job.error = e.stack || e.message;
    job.logPush(`FATAL: ${e.message}`);
  }
  return job;
}

export async function runJob(job) {
  const {
    location,
    businessType,
    maxResults = 10,
    headless = true,
    sendEmails = false,
    writeSheet = true,
    writeNocodb = true,
    skipKnown = true,
    concurrency
  } = job.options;
  const started = Date.now();
  const timings = {};

  job.state = 'running';
  job.stats = {
    phase: 'discovery',
    candidatesFound: 0,
    duplicatesSkipped: 0,
    uniqueBusinesses: 0,
    websitesChecked: 0,
    emailsFound: 0,
    completed: 0,
    total: maxResults,
    failures: 0,
    elapsedMs: 0,
    timing: timings
  };
  statsStartRun(job);
  job.persist?.();
  const query = (businessType && location) ? `${businessType} in ${location}` : businessType || location;
  job.logPush(`Pipeline started: "${query}" (target ${maxResults} unique businesses)`);
  job.logPush(isPersistentStoreConfigured()
    ? 'Job store: NocoDB (persistent — trackable across instances).'
    : 'WARNING: NO job store configured (NOCODB_URL/TOKEN/BASE_ID missing) — job progress is memory-only.');

  const stamp = (name) => {
    const ms = Date.now() - timings[name];
    job.stats.timing[name] = ms;
    job.logPush(`[${name}] ${(ms / 1000).toFixed(1)}s`);
  };

  try {
    // 1. Discover unique businesses
    timings.DISCOVERY = Date.now();
    job.logPush('Scraping Google Maps…');
    const known = skipKnown ? loadKnownFingerprints() : new Map();
    const dedup = createDeduplicator({ known });
    if (skipKnown) job.logPush(`Loaded ${dedup.size} previously-saved business fingerprints.`);

    const items = await scrapeGoogleMaps({
      query,
      maxResults,
      headless,
      concurrency: concurrency || CONCURRENCY,
      onLog: (m) => job.logPush(m),
      deduplicator: dedup,
      onProgress: (s) => {
        job.stats.candidatesFound = s.candidatesFound;
        job.stats.duplicatesSkipped = s.duplicatesSkipped;
        job.stats.uniqueBusinesses = s.uniqueBusinesses;
        job.stats.completed = s.uniqueBusinesses;
        job.stats.failures = s.detailFailures || 0;
        job.stats.elapsedMs = Date.now() - started;
        job.persist?.();
      }
    });
    job.stats.candidatesFound = Math.max(job.stats.candidatesFound, items.stats?.candidatesFound || items.length);
    job.stats.duplicatesSkipped = Math.max(job.stats.duplicatesSkipped, items.stats?.duplicatesSkipped || 0);
    job.stats.uniqueBusinesses = items.length;
    job.stats.completed = items.length;
    job.logPush(`Scraped ${items.length} unique businesses (${job.stats.candidatesFound} candidates, ${job.stats.duplicatesSkipped} duplicates skipped).`);
    stamp('DISCOVERY');
    job.persist?.();

    if (!items.length) {
      job.stats.elapsedMs = Date.now() - started;
      job.state = 'done';
      job.stats.phase = 'done';
      job.logPush('No results found.');
      return;
    }

    // 2. Enrich: website status + emails
    job.stats.phase = 'enrichment';
    timings.ENRICHMENT = Date.now();
    job.logPush('Checking websites & finding emails…');
    const enriched = await enrichBusinesses(items, (m) => job.logPush(m), {
      concurrency: concurrency || CONCURRENCY,
      onProgress: (s) => {
        job.stats.websitesChecked = s.websitesChecked;
        job.stats.emailsFound = s.emailsFound;
        job.stats.elapsedMs = Date.now() - started;
        job.persist?.();
      }
    });
    job.businesses = enriched;
    job.stats.emailsFound = enriched.filter((b) => b.email).length;
    job.stats.websitesChecked = enriched.filter((b) => b.website).length;
    stamp('ENRICHMENT');
    job.logPush(`Emails found for ${job.stats.emailsFound} / ${enriched.length} businesses.`);
    job.persist?.();

    // 3. Emails (optional)
    if (sendEmails) {
      job.logPush('Sending outreach emails…');
      const warn = emailSendWarning?.();
      if (warn) job.logPush(`EMAIL WARNING: ${warn}`);
      const r = await sendOutreachToAll(enriched, (m) => job.logPush(m));
      job.stats.emailsSent = r.sent;
      job.stats.emailsFailed = r.failed.length;
      job.logPush(`Done sending: ${r.sent} sent, ${r.failed.length} failed.`);
    }

    // 4. Google Sheets (optional)
    if (writeSheet) {
      try {
        job.logPush('Writing to Google Sheets…');
        const r = await appendBusinesses(enriched);
        job.stats.sheetRows = r.inserted;
        job.stats.sheetRange = r.range;
        job.logPush(`Wrote ${r.inserted} rows to sheet.`);
      } catch (e) {
        job.stats.sheetRows = 0;
        job.logPush(`Sheets write skipped: ${e.message}`);
      }
    }

    // 5. NocoDB (append — never deletes or overwrites existing rows)
    if (writeNocodb) {
      try {
        job.logPush('Pushing to NocoDB…');
        const r = await appendBusinessesToNocodb(enriched, (m) => job.logPush(m));
        job.stats.nocodbRows = r.inserted;
        job.logPush(`Appended ${r.inserted} rows to NocoDB.`);
      } catch (e) {
        job.stats.nocodbRows = 0;
        job.logPush(`NocoDB write failed: ${e.message}`);
      }
    }

    // 6. Persist dedup index so future runs skip already-saved businesses
    try {
      await saveDedupIndex(enriched);
    } catch (e) {
      job.logPush(`Dedup index update skipped: ${e.message}`);
    }

    job.stats.elapsedMs = Date.now() - started;
    job.stats.phase = 'done';
    job.state = 'done';
    job.logPush(`Done ✓ (${(job.stats.elapsedMs / 1000).toFixed(1)}s)`);
  } catch (e) {
    job.state = 'error';
    job.error = e.stack || e.message;
    throw e;
  } finally {
    job.stats.elapsedMs = Date.now() - started;
    statsCompleteRun(job);
    job.persist?.(true);
  }
}
