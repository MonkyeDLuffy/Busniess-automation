const JOBS_TABLE = 'JobRuns';
const JOB_COLUMNS = [
  { title: 'JobID', uidt: 'SingleLineText' },
  { title: 'State', uidt: 'SingleLineText' },
  { title: 'Options', uidt: 'LongText' },
  { title: 'Log', uidt: 'LongText' },
  { title: 'Stats', uidt: 'LongText' },
  { title: 'Businesses', uidt: 'LongText' },
  { title: 'Error', uidt: 'LongText' },
  { title: 'Updated At', uidt: 'SingleLineText' }
];

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

export function isPersistentStoreConfigured() {
  return !!(process.env.NOCODB_URL && process.env.NOCODB_TOKEN && process.env.NOCODB_BASE_ID);
}

async function throwHttpError(prefix, res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  throw new Error(`${prefix} (${res.status}): ${text}`);
}

let tableCache = null;

async function ensureJobTable() {
  if (tableCache) return tableCache;
  const listRes = await fetch(`${baseUrl()}/api/v2/meta/bases/${process.env.NOCODB_BASE_ID}/tables`, {
    headers: headers()
  });
  if (!listRes.ok) throw await throwHttpError('NocoDB: list tables failed', listRes);
  const data = await listRes.json();
  const tables = Array.isArray(data) ? data : data.list || [];
  let table = tables.find((t) => t.title === JOBS_TABLE);
  if (!table) {
    const createRes = await fetch(`${baseUrl()}/api/v2/meta/bases/${process.env.NOCODB_BASE_ID}/tables`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title: JOBS_TABLE, columns: JOB_COLUMNS })
    });
    if (!createRes.ok) throw await throwHttpError('NocoDB: create JobRuns table failed', createRes);
    table = await createRes.json();
  }
  const metaRes = await fetch(`${baseUrl()}/api/v2/meta/tables/${table.id}`, { headers: headers() });
  const meta = await metaRes.json().catch(() => null);
  const colMap = {};
  for (const c of meta?.columns || []) {
    if (c.title && c.column_name) colMap[c.title] = c.column_name;
  }
  tableCache = { id: table.id, colMap };
  return tableCache;
}

async function findRecord(tableId, colMap, jobId) {
  const res = await fetch(
    `${baseUrl()}/api/v2/tables/${tableId}/records?where=${encodeURIComponent(`(${colMap['JobID']},eq,${jobId})`)}&limit=1`,
    { headers: headers() }
  );
  if (!res.ok) throw await throwHttpError('NocoDB: job lookup failed', res);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.list || [];
  return list[0] || null;
}

function recordToJob(rec, colMap) {
  const col = (title) => rec[title] ?? rec[colMap[title]];
  const parse = (v) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };
  return {
    id: col('JobID'),
    state: col('State') || 'unknown',
    options: parse(col('Options')) || {},
    log: parse(col('Log')) || [],
    stats: parse(col('Stats')) || {},
    businesses: parse(col('Businesses')) || [],
    error: col('Error') || null,
    updatedAt: col('Updated At') || null
  };
}

export async function saveJob(job) {
  if (!isPersistentStoreConfigured()) return;
  const data = job.serialize ? job.serialize() : job;
  const { id: tableId, colMap } = await ensureJobTable();
  const col = (title) => colMap[title];
  const row = {
    [col('JobID')]: data.id,
    [col('State')]: data.state || 'unknown',
    [col('Options')]: JSON.stringify(data.options || {}),
    [col('Log')]: JSON.stringify(data.log || []),
    [col('Stats')]: JSON.stringify(data.stats || {}),
    [col('Businesses')]: JSON.stringify(data.businesses || []),
    [col('Error')]: data.error || null,
    [col('Updated At')]: data.updatedAt || new Date().toISOString()
  };
  const existing = await findRecord(tableId, colMap, data.id);
  const url = existing
    ? `${baseUrl()}/api/v2/tables/${tableId}/records/${existing.id}`
    : `${baseUrl()}/api/v2/tables/${tableId}/records`;
  const res = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: headers(),
    body: JSON.stringify(row)
  });
  if (!res.ok) throw await throwHttpError(existing ? 'NocoDB: job update failed' : 'NocoDB: job insert failed', res);
}

export async function getJob(id) {
  if (!isPersistentStoreConfigured()) return null;
  try {
    const { id: tableId, colMap } = await ensureJobTable();
    const rec = await findRecord(tableId, colMap, id);
    return rec ? recordToJob(rec, colMap) : null;
  } catch {
    return null;
  }
}

export async function listJobs() {
  if (!isPersistentStoreConfigured()) return [];
  try {
    const { id: tableId, colMap } = await ensureJobTable();
    const res = await fetch(
      `${baseUrl()}/api/v2/tables/${tableId}/records?limit=50&sort=${encodeURIComponent('-Updated At')}`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.list || [];
    return list.map((r) => recordToJob(r, colMap)).filter((j) => j.id);
  } catch {
    return [];
  }
}