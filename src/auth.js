import crypto from 'node:crypto';

const USERS = new Map([
  ['Earth', 'Extenbitch'],
  ['Aadarsh', 'Sexydogaadarsh'],
  ['Nikhil', 'Bigassnikhil']
]);

const TTL_MS = 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set (add it to your environment / .env).');
  return s;
}

export function isValidUser(username, password) {
  const expected = USERS.get(username);
  return !!expected && expected === password;
}

export function issueToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (expected !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || Date.now() > data.exp) return null;
    return data.u;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i !== -1) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return cookies;
}