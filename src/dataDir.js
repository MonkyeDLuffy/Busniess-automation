import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_VERCEL = process.env.VERCEL === '1';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'data')
  : path.resolve(__dirname, '../data');

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* read-only fs — callers handle errors */
}

export default DATA_DIR;
