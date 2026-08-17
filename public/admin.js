const state = {
  currentJob: null,
  polling: null,
  results: []
};

const $ = (id) => document.getElementById(id);

function setConfigNote() {
  const note = $('config-note');
  const { kvConfigured, sheetsConfigured, nocodbConfigured, emailConfigured, emailSendWarning } = window.__health || {};
  const warnings = [];
  if (emailSendWarning) warnings.push(emailSendWarning);
  if (kvConfigured === false) warnings.push('No Redis/KV connected — jobs run in memory and won\'t survive restarts. Connect Upstash Redis in Vercel.');
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
  if (health.sheetsConfigured && health.emailConfigured && health.kvConfigured) {
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
    const job = await res.json();
    if (!job) return;
    renderJob(job);
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