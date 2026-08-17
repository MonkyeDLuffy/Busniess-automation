import { kv, createClient } from '@vercel/kv';

const REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_URL ||
  '';
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  '';

export const KV_ENABLED = !!(REDIS_URL && REDIS_TOKEN);

const client = KV_ENABLED ? createClient({ url: REDIS_URL, token: REDIS_TOKEN }) : kv;

const memory = new Map();

export const kvStore = {
  enabled: KV_ENABLED,
  async get(key) {
    return KV_ENABLED ? client.get(key) : (memory.get(key) ?? null);
  },
  async set(key, value, ttlSec) {
    if (KV_ENABLED) {
      await client.set(key, value, ttlSec ? { ex: ttlSec } : undefined);
    } else {
      memory.set(key, value);
    }
  },
  async del(key) {
    if (KV_ENABLED) {
      await client.del(key);
    } else {
      memory.delete(key);
    }
  },
  async keys(pattern) {
    if (KV_ENABLED) {
      const prefix = String(pattern).replace(/\*$/, '');
      const keys = await client.keys(pattern);
      return keys.filter((k) => k.startsWith(prefix));
    }
    const prefix = String(pattern).replace(/\*$/, '');
    return [...memory.keys()].filter((k) => k.startsWith(prefix));
  },
  async mget(...keys) {
    if (KV_ENABLED) {
      return client.mget(...keys);
    }
    return keys.map((k) => memory.get(k) ?? null);
  }
};