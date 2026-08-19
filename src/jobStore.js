const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;
const PREFIX = 'job:';
const TTL = 3600;

export function isPersistentStoreConfigured() {
  return !!(REDIS_URL && REDIS_TOKEN);
}

async function redis(command, ...args) {
  const base = REDIS_URL.replace(/\/$/, '');
  const path = args.map((a) => encodeURIComponent(String(a))).join('/');
  const res = await fetch(`${base}/${command}/${path}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function saveJob(job) {
  if (!isPersistentStoreConfigured()) return;
  const data = job.serialize ? job.serialize() : job;
  await redis('set', PREFIX + data.id, JSON.stringify(data), 'EX', TTL);
}

export async function getJob(id) {
  if (!isPersistentStoreConfigured()) return null;
  try {
    const raw = await redis('get', PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function listJobs() {
  if (!isPersistentStoreConfigured()) return [];
  try {
    const scan = await redis('scan', '0', 'match', PREFIX + '*', 'count', '100');
    const keys = Array.isArray(scan) && scan[1] ? scan[1] : [];
    if (!keys.length) return [];
    const values = await redis('mget', ...keys);
    return (Array.isArray(values) ? values : [])
      .filter(Boolean)
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}