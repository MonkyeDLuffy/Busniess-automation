import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NOCODB_COLUMNS = [
  { title: 'Name', uidt: 'SingleLineText' },
  { title: 'Category', uidt: 'SingleLineText' },
  { title: 'Address', uidt: 'SingleLineText' },
  { title: 'Phone', uidt: 'SingleLineText' },
  { title: 'Website', uidt: 'URL' },
  { title: 'Website Status', uidt: 'SingleLineText' },
  { title: 'Business Status', uidt: 'SingleLineText' },
  { title: 'Rating', uidt: 'Decimal' },
  { title: 'Google Maps URL', uidt: 'URL' },
  { title: 'Place ID', uidt: 'SingleLineText' },
  { title: 'Email', uidt: 'Email' },
  { title: 'Email Source', uidt: 'SingleLineText' },
  { title: 'Query', uidt: 'SingleLineText' },
  { title: 'Found At', uidt: 'SingleLineText' }
];

const PERMISSION_HINT =
  'The NocoDB API token is missing write permissions. In NocoDB go to Account Settings → API Tokens, ' +
  'and give this token "Read & write" for Records and Fields (or create a new token with those permissions).';

async function throwHttpError(prefix, res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  const hint = res.status === 403 ? ` ${PERMISSION_HINT}` : '';
  throw new Error(`${prefix} (${res.status})${hint}: ${text}`);
}

export function isNocodbConfigured() {
  return !!(process.env.NOCODB_URL && process.env.NOCODB_TOKEN && process.env.NOCODB_TABLE_ID);
}

function baseUrl() {
  return String(process.env.NOCODB_URL || '').replace(/\/+$/, '');
}

function headers() {
  return {
    'xc-token': process.env.NOCODB_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

export async function listColumns(onLog) {
  const res = await fetch(`${baseUrl()}/api/v2/meta/tables/${process.env.NOCODB_TABLE_ID}`, {
    headers: headers()
  });
  if (!res.ok) return throwHttpError('NocoDB: failed to read table meta', res);
  const data = await res.json();
  return Array.isArray(data.columns) ? data.columns : [];
}

export async function ensureColumns(onLog) {
  const existing = new Set((await listColumns(onLog)).map((c) => c.title));
  let created = 0;
  for (const col of NOCODB_COLUMNS) {
    if (existing.has(col.title)) continue;
    const res = await fetch(`${baseUrl()}/api/v2/meta/tables/${process.env.NOCODB_TABLE_ID}/columns`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(col)
    });
    if (!res.ok) return throwHttpError(`NocoDB: could not create column "${col.title}"`, res);
    created++;
    onLog?.(`NocoDB: created column "${col.title}"`);
  }
  return created;
}

function buildColMap(columns) {
  const map = {};
  for (const c of columns) {
    if (c.title && c.column_name) map[c.title] = c.column_name;
  }
  return map;
}

function mapBusiness(b, colMap, now) {
  const row = {};
  const set = (title, value) => {
    const key = colMap[title];
    if (key) row[key] = value == null ? null : value;
  };
  set('Name', b.name || null);
  set('Category', b.category || null);
  set('Address', b.address || null);
  set('Phone', b.phone || null);
  set('Website', b.website || null);
  set('Website Status', b.websiteStatus || null);
  set('Business Status', b.openStatus || null);
  set('Rating', b.rating ?? null);
  set('Google Maps URL', b.mapsUrl || b.placeUrl || null);
  set('Place ID', b.placeId || null);
  set('Email', b.email || null);
  set('Email Source', b.emailSource || null);
  set('Query', b.queryType || null);
  set('Found At', b.foundAt || now);
  return row;
}

export async function appendBusinessesToNocodb(businesses = [], onLog) {
  if (!isNocodbConfigured()) {
    throw new Error('NocoDB not configured (NOCODB_URL / NOCODB_TOKEN / NOCODB_TABLE_ID).');
  }
  if (!businesses.length) return { inserted: 0 };

  const created = await ensureColumns(onLog);
  if (created > 0) onLog?.(`NocoDB: ${created} column(s) created.`);

  const colMap = buildColMap(await listColumns(onLog));
  const now = new Date().toISOString();
  const rows = businesses.map((b) => mapBusiness(b, colMap, now));

  const CHUNK = 100;
  let inserted = 0;
  const url = `${baseUrl()}/api/v2/tables/${process.env.NOCODB_TABLE_ID}/records`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(chunk)
    });
    if (!res.ok) return throwHttpError('NocoDB: insert failed', res);
    inserted += chunk.length;
  }
  onLog?.(`NocoDB: appended ${inserted} row(s) to "${process.env.NOCODB_TABLE_NAME || 'Business-automation'}".`);
  return { inserted };
}
