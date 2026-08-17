import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resend } from 'resend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARD_PATH = path.resolve(__dirname, '../../1.png');
const CARD_CID = 'agency-card';

let resendClient = null;
let cardAttachment = null;

export function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export function emailSendWarning() {
  if (!isEmailConfigured()) return 'Resend not configured (RESEND_API_KEY / RESEND_FROM).';
  const from = String(process.env.RESEND_FROM || '').toLowerCase();
  if (from === 'onboarding@resend.dev' || from.startsWith('onboarding@')) {
    return 'RESEND_FROM is the default "onboarding@resend.dev" sender. It can only send to your own Resend account email (vadukiyaearth@gmail.com). To send outreach to real business addresses, verify a domain at resend.com/domains and set RESEND_FROM to an address on it.';
  }
  if (from.endsWith('@resend.dev')) {
    return 'RESEND_FROM uses Resend\u2019s unverified default domain "@resend.dev", which Resend rejects for sending. Set RESEND_FROM to an address on a domain verified in your Resend account (e.g. offanime.cc).';
  }
  if (!from.includes('@')) return 'RESEND_FROM is not a valid email address.';
  return null;
}

function getClient() {
  if (!isEmailConfigured()) {
    throw new Error('Resend not configured. Set RESEND_API_KEY and RESEND_FROM (see .env).');
  }
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

function loadCardAttachment() {
  if (cardAttachment) return cardAttachment;
  try {
    if (!fs.existsSync(CARD_PATH)) return null;
    cardAttachment = {
      filename: '1.png',
      content: fs.readFileSync(CARD_PATH).toString('base64'),
      contentType: 'image/png',
      disposition: 'inline',
      contentId: CARD_CID
    };
  } catch {
    cardAttachment = null;
  }
  return cardAttachment;
}

const SUBJECT = (name, hasWebsite) =>
  hasWebsite
    ? `Quick question about ${name || 'your'} website`
    : `Quick question for ${name || 'your business'}`;

const HTML_TEMPLATE = ({ name, unsub, card, variant }) => {
  const isSite = variant === 'website';
  const body = isSite
    ? `<p>We've taken a quick look at your website${name ? ` for ${name}` : ''} and, for the
    current market trends, your website isn't suited well to help you grow — it may be holding
    your business back from new customers.</p>
    <p>Don't worry — it's a quick fix. If you're interested, just reply to this email and we'll
    create a <strong>free demo website</strong> for you to see the difference.</p>`
    : `<p>We're reaching out because we think your business could benefit from
    having a stronger local presence online — a modern, fast website and
    better visibility so local customers can find you more easily.</p>
    <p>Would you have 15 minutes this week for a quick chat? No pressure at all —
    we'd love to learn a little about what you do.</p>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;line-height:1.6">
    <h2 style="color:#111">Hello${name ? ` ${name}` : ''},</h2>
    ${body}
    <p>Best regards,<br/>The Noix Team</p>
    ${card ? `<img src="cid:${card}" alt="Digital business card" style="display:block;max-width:480px;width:100%;margin:20px auto 0;border-radius:12px;" />` : ''}
    <p style="margin-top:24px;font-size:11px;color:#999">
      You're receiving this because you're listed as a local business in a public directory.
      ${unsub ? `<a href="${unsub}">Unsubscribe</a>` : 'Reply "STOP" to stop receiving emails.'}
    </p>
  </div>
`;
};

export async function sendOutreachEmail({ to, name, hasWebsite = false }) {
  if (!to) throw new Error('No recipient email.');
  const client = getClient();
  const unsub = process.env.UNSUBSCRIBE_URL ? `${process.env.UNSUBSCRIBE_URL}?email=${encodeURIComponent(to)}` : null;
  const card = loadCardAttachment();
  const res = await client.emails.send({
    from: process.env.RESEND_FROM,
    to,
    subject: SUBJECT(name, hasWebsite),
    html: HTML_TEMPLATE({ name, unsub, card: card ? card.contentId : null, variant: hasWebsite ? 'website' : 'general' }),
    ...(card ? { attachments: [card] } : {})
  });
  if (res.error) throw new Error(res.error.message || 'Resend error');
  return { id: res.data?.id, to, name };
}

export async function sendOutreachToAll(businesses, onLog) {
  const targets = businesses.filter((b) => b.email);
  const skipped = businesses.length - targets.length;
  let sent = 0;
  const failed = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(3, targets.length) }, async () => {
    while (i < targets.length) {
      const b = targets[i++];
      try {
        const r = await sendOutreachEmail({ to: b.email, name: b.name, hasWebsite: !!b.website });
        b.emailSent = true;
        b.sentAt = new Date().toISOString();
        sent++;
        onLog?.(`  ✓ sent to ${b.email} (${r.id})`);
      } catch (e) {
        failed.push({ name: b.name, email: b.email, error: e.message });
        onLog?.(`  ✗ failed ${b.email}: ${e.message}`);
      }
    }
  });
  await Promise.all(runners);
  if (skipped) onLog?.(`  — ${skipped} business(es) skipped (no email found)`);
  return { sent, failed, skipped };
}
