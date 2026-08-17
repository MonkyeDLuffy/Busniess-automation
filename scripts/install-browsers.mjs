import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cliPath = path.join(path.dirname(require.resolve('playwright')), 'cli.js');

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' };
const child = spawn(process.execPath, [cliPath, 'install', 'chromium', '--only-shell'], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));