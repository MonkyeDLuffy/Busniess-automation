import 'dotenv/config';
import { scrapeGoogleMaps } from './scraper.js';
import { enrichBusinesses } from './emailFinder.js';
import { appendBusinesses } from './sheets.js';
import { sendOutreachToAll } from './emailSender.js';
import { saveResults, saveRunCsv } from './pipeline.js';
import { createDeduplicator, loadKnownFingerprints, saveDedupIndex } from './dedupe.js';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const flag = (name) => args.includes(name);

const location = opt('--location', '');
const businessType = opt('--type', '');
const maxResults = Number(opt('--max', 10));
const headless = !flag('--headed');
const sendEmails = flag('--send');
const skipSheet = flag('--no-sheet');
const writeSheet = !skipSheet;
const fresh = flag('--fresh');
const concurrency = Number(opt('--concurrency', process.env.CONCURRENCY_LIMIT || 5));

if (!location || !businessType) {
  console.error('Usage: npm run scrape -- --location "Manchester" --type "coffee shops" [--max 20] [--concurrency 5] [--fresh] [--send] [--no-sheet] [--headed]');
  process.exit(1);
}

function log(m) {
  console.log(`[${new Date().toLocaleTimeString()}] ${m}`);
}

const t0 = Date.now();
log(`Searching "${businessType} in ${location}" (max ${maxResults}, concurrency ${concurrency}${fresh ? ', fresh (ignore saved)' : ''})`);

const known = fresh ? new Map() : loadKnownFingerprints();
const dedup = createDeduplicator({ known });
if (!fresh) log(`Loaded ${dedup.size} previously-saved business fingerprints.`);

const tDisc = Date.now();
let items = await scrapeGoogleMaps({
  query: `${businessType} in ${location}`,
  maxResults,
  headless,
  concurrency,
  deduplicator: dedup,
  onLog: log
});
log(`[DISCOVERY] ${((Date.now() - tDisc) / 1000).toFixed(1)}s — ${items.length} unique businesses (${items.stats?.candidatesFound || items.length} candidates, ${items.stats?.duplicatesSkipped || 0} duplicates skipped)`);

const tEnr = Date.now();
items = await enrichBusinesses(items, log, { concurrency });
log(`[ENRICHMENT] ${((Date.now() - tEnr) / 1000).toFixed(1)}s — emails found: ${items.filter((b) => b.email).length}/${items.length}`);

if (sendEmails) {
  const r = await sendOutreachToAll(items, log);
  log(`Emails sent: ${r.sent}, failed: ${r.failed.length}`);
}

if (writeSheet) {
  try {
    const r = await appendBusinesses(items);
    log(`Sheet: ${r.inserted} rows appended${r.range ? ` (${r.range})` : ''}`);
  } catch (e) {
    log(`Sheets skipped: ${e.message}`);
  }
}

const file = saveResults(`run_${Date.now()}`, items);
log(`Saved ${items.length} results to ${file}`);
saveRunCsv(items, log);

try {
  saveDedupIndex(items);
} catch (e) {
  log(`Dedup index update skipped: ${e.message}`);
}

log(`[TOTAL] ${((Date.now() - t0) / 1000).toFixed(1)}s`);