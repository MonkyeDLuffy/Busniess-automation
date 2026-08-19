const state = {
  currentJob: null,
  polling: null,
  results: []
};

const $ = (id) => document.getElementById(id);

const USER_THEMES = {
  Earth: { accent: '#8fb4ff', accentSoft: '#b9cdf2' },
  Nikhil: { accent: '#7ee6a8', accentSoft: '#aef0c7' },
  Aadarsh: { accent: '#ff9a76', accentSoft: '#ffc2a8' }
};

function applyUserTheme(username) {
  const theme = USER_THEMES[username] || { accent: '#8fb4ff', accentSoft: '#b9cdf2' };
  const root = document.documentElement;
  root.style.setProperty('--blue', theme.accent);
  root.style.setProperty('--soft-blue', theme.accentSoft);
  const avatar = $('userAvatar');
  avatar.style.background = `linear-gradient(135deg, ${theme.accent}, ${theme.accentSoft})`;
  const mark = $('brandMark');
  mark.style.background = `linear-gradient(135deg, ${theme.accent}, ${theme.accentSoft})`;
}

async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await res.json();
    const username = data.username;
    $('userName').textContent = username;
    $('userAvatar').textContent = username.charAt(0).toUpperCase();
    $('userLabel').textContent = 'Dashboard';
    $('dashboardTitle').textContent = `${username}'s Dashboard`;
    $('dashboardSub').textContent = `Local business outreach console`;
    document.title = `${username}'s Dashboard — Business Finder`;
    applyUserTheme(username);
  } catch {
    $('userLabel').textContent = 'Offline';
  }
}

function setConfigNote() {
  const note = $('config-note');
  const { sheetsConfigured, nocodbConfigured, emailConfigured, emailSendWarning } = window.__health || {};
  const warnings = [];
  if (emailSendWarning) warnings.push(emailSendWarning);
  if (nocodbConfigured === false) warnings.push('NocoDB not configured (NOCODB_URL / NOCODB_TOKEN / NOCODB_TABLE_ID).');
  if (sheetsConfigured === false) warnings.push('Google Sheets credentials missing — results will only be saved locally.');
  if (emailConfigured === false) warnings.push('Resend email credentials missing (RESEND_API_KEY / RESEND_FROM).');
  note.textContent = warnings.length ? warnings.join(' ') : 'All services configured. Ready to run.';
}

function fmtElapsed(ms) {
  if (!ms) return '';
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderStats(job) {
  const s = job.stats || {};
  const set = (id, v) => { $('stat-' + id).textContent = v ?? 0; };
  set('phase', s.phase || job.state);
  set('candidates', s.candidatesFound ?? 0);
  set('dupes', s.duplicatesSkipped ?? 0);
  set('unique', s.uniqueBusinesses ?? job.businesses?.length ?? 0);
  set('websites', s.websitesChecked ?? 0);
  set('emails', s.emailsFound ?? 0);
  set('completed', `${s.completed ?? job.businesses?.length ?? 0}/${s.total ?? '—'}`);
  $('elapsed').textContent = fmtElapsed(s.elapsedMs);
}

async function init() {
  await loadUser();
  const res = await fetch('/api/health');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const health = await res.json();
  window.__health = health;
  setConfigNote();
  const chip = $('status-chip');
  const dot = chip.querySelector('.dot');
  if (health.sheetsConfigured && health.emailConfigured) {
    chip.classList.add('ok');
    $('status-text').textContent = 'All systems ready';
  } else {
    chip.classList.add('warn');
    $('status-text').textContent = 'Partial setup';
  }

  $('maxResults').addEventListener('input', () => {
    $('maxResultsOut').value = $('maxResults').value;
  });

  $('startBtn').addEventListener('click', startJob);
  $('sendBtn').addEventListener('click', sendEmails);
  $('exportBtn').addEventListener('click', exportJson);
  $('logoutBtn').addEventListener('click', logout);
  $('refreshStatsBtn').addEventListener('click', loadStats);
  $('responseForm').addEventListener('submit', logResponse);
  loadStats();
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.status === 401) return;
    const data = await res.json();
    renderDashboard(data);
  } catch {
    /* dashboard is best-effort */
  }
}

function renderDashboard(d) {
  const t = d.totals || {};
  const num = (n) => Number(n || 0).toLocaleString();
  $('dash-runs').textContent = num(t.runs);
  $('dash-unique').textContent = num(t.uniqueBusinesses);
  $('dash-emails-found').textContent = num(t.emailsFound);
  $('dash-emails-sent').textContent = num(t.emailsSent);
  $('dash-failures').textContent = num(t.emailFailures);
  $('dash-responses').textContent = num(t.responses);
  $('dash-rate').textContent = `${t.responseRate ?? 0}%`;
  renderRuns(d.history || []);
  renderSends(d.sends || []);
  renderResponses(d.responses || []);
}

function renderRuns(history) {
  const body = $('dashRunsBody');
  if (!history.length) {
    body.innerHTML = `<tr class="empty"><td colspan="7">No runs yet — start your first search.</td></tr>`;
    return;
  }
  body.innerHTML = history
    .slice(0, 12)
    .map((h) => {
      const when = h.finishedAt || h.startedAt;
      const date = when ? new Date(when).toLocaleString() : '—';
      const state = h.state || '—';
      const cls = state === 'done' ? 'ok' : state === 'error' ? 'bad' : '';
      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td class="bname">${escapeHtml(h.query || '—')}</td>
        <td><span class="pill ${cls}">${escapeHtml(state)}</span></td>
        <td>${Number(h.uniqueBusinesses ?? h.candidatesFound ?? 0).toLocaleString()}</td>
        <td>${Number(h.emailsFound ?? 0).toLocaleString()}</td>
        <td>${Number(h.emailsSent ?? 0).toLocaleString()}</td>
        <td>${Number(h.sheetRows ?? 0).toLocaleString()}</td>
      </tr>`;
    })
    .join('');
}

function renderSends(sends) {
  const body = $('dashSendsBody');
  if (!sends.length) {
    body.innerHTML = `<tr class="empty"><td colspan="4">No email sends recorded yet.</td></tr>`;
    return;
  }
  body.innerHTML = sends
    .slice(0, 10)
    .map((s) => {
      const date = s.sentAt ? new Date(s.sentAt).toLocaleString() : '—';
      const ok = s.result === 'sent';
      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(s.name || '')}</td>
        <td>${escapeHtml(s.to || '')}</td>
        <td><span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'sent' : 'failed'}</span></td>
      </tr>`;
    })
    .join('');
}

function renderResponses(responses) {
  const list = $('respList');
  if (!responses.length) {
    list.innerHTML = `<li class="resp-empty">No responses logged yet — add one when a lead replies.</li>`;
    return;
  }
  list.innerHTML = responses
    .slice(0, 12)
    .map((r) => {
      const date = r.at ? new Date(r.at).toLocaleString() : '—';
      const good = ['positive', 'callback', 'meeting'].includes(r.type);
      return `<li class="resp-item">
        <div class="resp-top">
          <span class="resp-who"><strong>${escapeHtml(r.name || r.email || 'Anonymous')}</strong>${r.email ? ` &lt;${escapeHtml(r.email)}&gt;` : ''}</span>
          <span class="pill ${good ? 'ok' : ''}">${escapeHtml(r.type || 'reply')}</span>
        </div>
        ${r.note ? `<div class="resp-note">${escapeHtml(r.note)}</div>` : ''}
        <div class="resp-date">${escapeHtml(date)}</div>
      </li>`;
    })
    .join('');
}

async function logResponse(evt) {
  evt.preventDefault();
  const body = {
    name: $('respName').value.trim(),
    email: $('respEmail').value.trim(),
    type: $('respType').value,
    note: $('respNote').value.trim()
  };
  if (!body.name && !body.email) {
    alert('Enter a contact name or email.');
    return;
  }
  const res = await fetch('/api/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to log response');
    return;
  }
  $('respName').value = '';
  $('respEmail').value = '';
  $('respNote').value = '';
  loadStats();
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function startJob() {
  const location = $('location').value.trim();
  const businessType = $('businessType').value.trim();
  if (!location || !businessType) {
    alert('Enter both a location and a business type.');
    return;
  }
  const body = {
    location,
    businessType,
    maxResults: Number($('maxResults').value),
    writeSheet: $('writeSheet').checked,
    writeNocodb: $('writeNocodb').checked,
    skipKnown: $('skipKnown').checked,
    sendEmails: $('sendEmails').checked,
    headless: true
  };
  $('log').innerHTML = '';
  $('startBtn').disabled = true;

  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to start job');
    $('startBtn').disabled = false;
    return;
  }
  state.currentJob = data.id;
  startPolling();
}

function startPolling() {
  if (state.polling) clearInterval(state.polling);
  const url = `/api/jobs/${state.currentJob}`;
  state.polling = setInterval(async () => {
    const res = await fetch(url);
    if (!res.ok) return;
    const job = await res.json();
    if (!job || !job.id) return;
    const maxAge = 90 * 1000;
    const lastUpdate = Date.parse(job.updatedAt) || Date.now();
    if (job.state === 'running' && Date.now() - lastUpdate > maxAge) {
      job.state = 'error';
      job.error = 'Timed out: the job exceeded the Vercel free-tier 60s limit. Reduce maxResults or retry.';
      clearInterval(state.polling);
      state.polling = null;
    }
    renderJob(job);
    loadStats();
    if (job.state === 'done' || job.state === 'error') {
      clearInterval(state.polling);
      state.polling = null;
      $('startBtn').disabled = false;
      $('sendBtn').disabled = !job.businesses?.length;
      $('exportBtn').disabled = !job.businesses?.length;
      if (job.state === 'error') alert('Job failed:\n' + job.error);
    }
  }, 1500);
}

function renderJob(job) {
  const badge = $('state-badge');
  badge.textContent = job.state;
  badge.className = 'state-badge ' + job.state;

  renderStats(job);

  $('log').innerHTML = job.log
    .map((l) => `<li>${l}</li>`)
    .join('');
  $('log').scrollTop = $('log').scrollHeight;

  $('resultsBody').innerHTML = job.businesses.length
    ? job.businesses
        .map(
          (b, i) => `<tr>
            <td>${i + 1}</td>
            <td class="bname">${escapeHtml(b.name || '')}</td>
            <td>${escapeHtml(b.address || '')}</td>
            <td>${escapeHtml(b.phone || '')}</td>
            <td>${escapeHtml(b.email || '—')}</td>
            <td>${b.website ? `<a href="${escapeHtml(b.website)}" target="_blank" rel="noopener">link</a>` : '—'}</td>
            <td><span class="pill ${b.websiteStatus === 'Active' ? 'ok' : 'bad'}">${escapeHtml(b.websiteStatus || '')}</span></td>
            <td>${escapeHtml(b.openStatus || '')}</td>
            <td>${b.emailSent ? '✓' : ''}</td>
          </tr>`
        )
        .join('')
    : `<tr class="empty"><td colspan="9">No results yet — run a search.</td></tr>`;

  $('results-count').textContent = `${job.businesses.length} businesses`;
}

async function sendEmails() {
  if (!state.currentJob) return;
  if (!confirm('Send outreach emails to all found businesses? This cannot be undone.')) return;
  $('sendBtn').disabled = true;
  const res = await fetch(`/api/jobs/${state.currentJob}/send-emails`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Failed to send');
    $('sendBtn').disabled = false;
    return;
  }
  let msg = `Sent ${data.sent} emails, ${data.failed?.length || 0} failed, ${data.skipped || 0} skipped.`;
  if (data.warning) msg += `\n\n${data.warning}`;
  if (data.failed?.length) {
    const reasons = [...new Set(data.failed.slice(0, 3).map((f) => f.error))].join('\n');
    msg += `\n\nFailure reason(s):\n${reasons}`;
  }
  alert(msg);
  $('sendBtn').disabled = false;
  startPolling();
}

async function exportJson() {
  if (!state.currentJob) return;
  const res = await fetch(`/api/jobs/${state.currentJob}/export`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Export failed');
    return;
  }
  const blob = new Blob([JSON.stringify(data.businesses || [], null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `results_${state.currentJob}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

init();