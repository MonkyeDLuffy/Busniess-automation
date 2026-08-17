import { google } from 'googleapis';
import fs from 'node:fs';

const HEADERS = [
  'Name',
  'Address',
  'Phone',
  'Email',
  'Website',
  'Website Status',
  'Business Status',
  'Rating',
  'Query',
  'Found At',
  'Email Source',
  'Email Sent',
  'Sent At'
];

function getAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyFile) {
    throw new Error('Google service account key not found. Set GOOGLE_SERVICE_ACCOUNT_KEY (see .env).');
  }
  let credentials;
  try {
    const trimmed = keyFile.trim();
    if (trimmed.startsWith('{')) {
      credentials = JSON.parse(trimmed);
    } else if (fs.existsSync(trimmed)) {
      credentials = JSON.parse(fs.readFileSync(trimmed, 'utf8'));
    }
  } catch {
    /* fall through to error below */
  }
  if (!credentials) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be a path to a service-account JSON file, or the JSON itself.');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return auth;
}

export function isSheetsConfigured() {
  return !!(process.env.SPREADSHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

async function getSheets() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaders(sheets, spreadsheetId, sheetTitle) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => s.properties.title === sheetTitle) || meta.data.sheets[0];
  const title = sheet?.properties?.title;
  const range = `${title}!A1`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const existing = res.data.values?.[0] || [];
  if (existing.length >= 6) {
    // Headers already present
    return { title };
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });
  return { title };
}

export async function appendBusinesses(businesses = []) {
  if (!businesses.length) return { inserted: 0 };
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheets = await getSheets();
  const { title } = await ensureHeaders(sheets, spreadsheetId, process.env.SHEET_TAB || 'Businesses');
  const tab = process.env.SHEET_TAB || title;

  const now = new Date().toISOString();
  const rows = businesses.map((b) => [
    b.name || '',
    b.address || '',
    b.phone || '',
    b.email || '',
    b.website || '',
    b.websiteStatus || '',
    b.openStatus || '',
    b.rating || '',
    b.queryType || '',
    b.foundAt || now,
    b.emailSource || 'website',
    b.emailSent ? 'Yes' : '',
    b.sentAt || ''
  ]);

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:M`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows }
  });
  return { inserted: rows.length, range: res.data.updates?.updatedRange || '' };
}