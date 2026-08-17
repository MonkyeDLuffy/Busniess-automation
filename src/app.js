import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJob, runJob } from './pipeline.js';
import { isSheetsConfigured } from './sheets.js';
import { isEmailConfigured, emailSendWarning, sendOutreachToAll } from './emailSender.js';
import { isNocodbConfigured } from './nocodb.js';
import { kvStore } from './kvstore.js';
import { isValidUser, issueToken, verifyToken, parseCookies } from './auth.js';

let waitUntilFn = null;
try {
  const vf = await import('@vercel/functions');
  waitUntilFn = vf.waitUntil || null;
} catch {
  waitUntilFn = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function getSessionUser(req) {
  return verifyToken(parseCookies(req).session);
}

function requireAuth(req, res, next) {
  if (!getSessionUser(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    options: job.options,
    log: job.log || [],
    businesses: job.businesses || [],
    stats: job.stats || {},
    error: job.error || null
  };
}

app.get('/', (req, res) => {
  if (!getSessionUser(req)) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/login.html', (req, res) => {
  if (getSessionUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!isValidUser(username, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = issueToken(username);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/`);
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', requireAuth);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    kvConfigured: kvStore.enabled,
    sheetsConfigured: isSheetsConfigured(),
    nocodbConfigured: isNocodbConfigured(),
    emailConfigured: isEmailConfigured(),
    emailSendWarning: emailSendWarning()
  });
});

app.post('/api/jobs', async (req, res) => {
  const opts = {
    location: String(req.body.location || '').trim(),
    businessType: String(req.body.businessType || '').trim(),
    maxResults: Number(req.body.maxResults) || 10,
    headless: req.body.headless !== false,
    sendEmails: req.body.sendEmails === true,
    writeSheet: req.body.writeSheet !== false,
    writeNocodb: req.body.writeNocodb !== false,
    skipKnown: req.body.skipKnown !== false,
    concurrency: Number(req.body.concurrency) || undefined
  };
  if (!opts.location || !opts.businessType) {
    return res.status(400).json({ error: 'Both location and business type are required.' });
  }
  const job = await createJob(opts);
  const finish = (e) => {
    if (e) {
      job.state = 'error';
      job.error = e.stack || e.message;
      job.logPush(`FATAL: ${e.message}`);
    }
    return job.persistNow();
  };
  const run = runJob(job)
    .then(() => finish(null))
    .catch(finish);
  if (waitUntilFn) {
    waitUntilFn(run);
  } else {
    run.catch(() => {});
  }
  res.json({ id: job.id, state: job.state });
});

app.get('/api/jobs', async (req, res) => {
  const keys = await kvStore.keys('job:*');
  const jobs = await kvStore.mget(...keys);
  res.json(jobs.filter(Boolean).map(publicJob));
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await kvStore.get(`job:${req.params.id}`);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/export', async (req, res) => {
  const job = await kvStore.get(`job:${req.params.id}`);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ businesses: job.businesses || [] });
});

app.post('/api/jobs/:id/send-emails', async (req, res) => {
  const job = await kvStore.get(`job:${req.params.id}`);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!isEmailConfigured()) {
    return res.status(400).json({ error: 'Email sending not configured (RESEND_API_KEY / RESEND_FROM).' });
  }
  const warning = emailSendWarning();
  try {
    const r = await sendOutreachToAll(job.businesses || [], (m) => job.log?.push(`[${new Date().toLocaleTimeString()}] ${m}`));
    res.json({ ...r, warning });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default app;