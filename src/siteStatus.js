const CONTROLLER_TIMEOUT = 10000;
const cache = new Map();

export async function checkWebsiteStatus(website) {
  if (!website) return 'No website';
  try {
    const url = new URL(website);
    if (!['http:', 'https:'].includes(url.protocol)) return 'Invalid URL';
  } catch {
    return 'Invalid URL';
  }
  if (cache.has(website)) return cache.get(website);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROLLER_TIMEOUT);
  let result;
  try {
    const res = await fetch(website, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BusinessFinder/1.0)' }
    });
    result = res.ok ? 'Active' : `Error ${res.status}`;
  } catch {
    result = 'Unreachable';
  } finally {
    clearTimeout(timer);
  }
  cache.set(website, result);
  return result;
}

export function clearWebsiteStatusCache() {
  cache.clear();
}