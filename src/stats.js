import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

const HISTORY_CAP = 500;
const SEND_CAP = 5000;
const RESPONSE_CAP = 2000;

function defaultStats() {
  return { history: [], sends: [], responses: [] };
}

function readStats() {
  if (!fs.existsSync(STATS_FILE)) seedFromDataDir();
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    return {
      history: Array.isArray(raw.history) ? raw.history : [],
      sends: Array.isArray(raw.sends) ? raw.sends : [],
      responses: Array.isArray(raw.responses) ? raw.responses : []
    };
  } catch {
    return defaultStats();
  }
}

function writeStats(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2));
}

function trim(arr, cap) {
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

function seedFromDataDir() {
  const s = defaultStats();
  try {
    if (!fs.existsSync(DATA_DIR)) {
      writeStats(s);
      return;
    }
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!/\.json$/.test(f)) continue;
      if (f === 'dedup-index.json' || f === 'stats.json' || f === 'sessions.json') continue;
      const file = path.join(DATA_DIR, f);
      let arr;
      try {
        arr = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (!Array.isArray(arr) || !arr.length) continue;
      const mtime = fs.statSync(file).mtime.toISOString();
      s.history.push({
        id: f.replace(/\.json$/, ''),
        startedAt: mtime,
        finishedAt: mtime,
        state: 'done',
        query: arr[0]?.queryType || 'historical run',
        candidatesFound: arr.length,
        uniqueBusinesses: arr.length,
        emailsFound: arr.filter((b) => b && b.email).length,
        legacy: true
      });
    }
  } catch {
    /* ignore */
  }
  writeStats(s);
}

export function getStats() {
  const s = readStats();
  const sum = (key) => s.history.reduce((acc, h) => acc + (Number(h[key]) || 0), 0);
  const totals = {
    runs: s.history.length,
    completedRuns: s.history.filter((h) => h.state === 'done').length,
    failedRuns: s.history.filter((h) => h.state === 'error').length,
    candidatesFound: sum('candidatesFound'),
    uniqueBusinesses: sum('uniqueBusinesses'),
    websitesChecked: sum('websitesChecked'),
    emailsFound: sum('emailsFound'),
    emailsSent: s.sends.filter((x) => x.result === 'sent').length,
    emailFailures: s.sends.filter((x) => x.result === 'failed').length,
    sheetRows: sum('sheetRows'),
    nocodbRows: sum('nocodbRows'),
    responses: s.responses.length
  };
  totals.responseRate = totals.emailsSent
    ? Math.round((totals.responses / totals.emailsSent) * 1000) / 10
    : 0;
  return {
    totals,
    history: [...s.history].reverse(),
    sends: [...s.sends].reverse(),
    responses: [...s.responses].reverse()
  };
}

export function startRun(job) {
  const s = readStats();
  s.history.push({
    id: job.id,
    startedAt: new Date().toISOString(),
    state: job.state,
    query:
      job.options.businessType && job.options.location
        ? `${job.options.businessType} in ${job.options.location}`
        : job.options.businessType || job.options.location || '',
    location: job.options.location,
    businessType: job.options.businessType,
    maxResults: job.options.maxResults
  });
  trim(s.history, HISTORY_CAP);
  writeStats(s);
}

export function completeRun(job) {
  const s = readStats();
  const entry = s.history.find((h) => h.id === job.id);
  if (!entry) return;
  Object.assign(entry, {
    state: job.state,
    finishedAt: new Date().toISOString(),
    elapsedMs: job.stats?.elapsedMs || 0,
    candidatesFound: job.stats?.candidatesFound ?? 0,
    duplicatesSkipped: job.stats?.duplicatesSkipped ?? 0,
    uniqueBusinesses: job.stats?.uniqueBusinesses ?? job.businesses?.length ?? 0,
    websitesChecked: job.stats?.websitesChecked ?? 0,
    emailsFound: job.stats?.emailsFound ?? 0,
    emailsSent: job.stats?.emailsSent ?? 0,
    emailsFailed: job.stats?.emailsFailed ?? 0,
    sheetRows: job.stats?.sheetRows ?? 0,
    nocodbRows: job.stats?.nocodbRows ?? 0,
    error: job.error || null
  });
  writeStats(s);
}

export function recordEmailSend({ to, name, id }) {
  const s = readStats();
  s.sends.push({ result: 'sent', to, name, id, sentAt: new Date().toISOString() });
  trim(s.sends, SEND_CAP);
  writeStats(s);
}

export function recordEmailFailure({ to, name, error }) {
  const s = readStats();
  s.sends.push({ result: 'failed', to, name, error, sentAt: new Date().toISOString() });
  trim(s.sends, SEND_CAP);
  writeStats(s);
}

export function recordResponse({ email, name, type = 'reply', note = '' }) {
  const s = readStats();
  const entry = {
    id: `resp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    email,
    name,
    type,
    note
  };
  s.responses.push(entry);
  trim(s.responses, RESPONSE_CAP);
  writeStats(s);
  return entry;
}
