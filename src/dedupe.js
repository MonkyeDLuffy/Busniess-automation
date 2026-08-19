import fs from 'node:fs';
import path from 'node:path';
import DATA_DIR from './dataDir.js';

const INDEX_FILE = path.join(DATA_DIR, 'dedup-index.json');

export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;
  let out = digits;
  if (out.startsWith('91') && out.length > 10) out = out.slice(2);
  else if (out.startsWith('1') && out.length === 11) out = out.slice(1);
  if (out.startsWith('0') && out.length > 10) out = out.slice(1);
  return out;
}

export function normalizeDomain(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(String(url)) ? url : `https://${url}`);
  } catch {
    return null;
  }
  return parsed.hostname.replace(/^www\./i, '').toLowerCase().replace(/\.$/, '');
}

export function extractPlaceId(url) {
  if (!url) return null;
  const m = String(url).match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  return m ? m[0].toLowerCase() : null;
}

export function fingerprint(b) {
  const placeId = extractPlaceId(b.placeUrl || b.mapsUrl || b.url || b.gmapsUrl || '');
  return {
    placeId,
    phone: normalizePhone(b.phone),
    domain: normalizeDomain(b.website),
    name: normalizeText(b.name),
    address: normalizeText(b.address)
  };
}

export function flatKeys(b) {
  const f = fingerprint(b);
  const keys = new Set();
  if (f.placeId) keys.add(`place:${f.placeId}`);
  if (f.phone) keys.add(`phone:${f.phone}`);
  if (f.domain && f.name) keys.add(`domname:${f.domain}|${f.name}`);
  if (f.name && f.address) keys.add(`nameaddr:${f.name}|${f.address}`);
  return keys;
}

export function createDeduplicator({ known = new Map() } = {}) {
  const seen = new Map(known);
  return {
    isDuplicate(b) {
      for (const k of flatKeys(b)) if (seen.has(k)) return true;
      return false;
    },
    add(b) {
      for (const k of flatKeys(b)) if (!seen.has(k)) seen.set(k, b.name || '');
    },
    checkAndAdd(b) {
      if (this.isDuplicate(b)) return true;
      this.add(b);
      return false;
    },
    get size() {
      return seen.size;
    }
  };
}

export function loadKnownFingerprints() {
  const map = new Map();
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const obj = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
      return map;
    }
  } catch {
    /* fall through to rebuild from run files */
  }
  try {
    if (!fs.existsSync(DATA_DIR)) return map;
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!/\.json$/.test(f) || f === 'dedup-index.json') continue;
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        if (!Array.isArray(arr)) continue;
        for (const b of arr) for (const k of flatKeys(b)) if (!map.has(k)) map.set(k, b.name || '');
      } catch {
        /* skip unreadable file */
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

export function saveDedupIndex(businesses = []) {
  const map = loadKnownFingerprints();
  for (const b of businesses) for (const k of flatKeys(b)) map.set(k, b.name || '');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(Object.fromEntries(map), null, 2));
  return map.size;
}
