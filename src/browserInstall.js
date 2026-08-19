import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import AdmZip from 'adm-zip';

const require = createRequire(import.meta.url);

const PLATFORM = { win32: 'win', linux: 'linux', darwin: 'mac' }[process.platform] + '-' + process.arch;

const ZIP_SUFFIX = {
  'linux-x64': 'linux64/chrome-headless-shell-linux64.zip',
  'linux-arm64': 'linux64/chrome-headless-shell-linux-arm64.zip',
  'win-x64': 'win64/chrome-headless-shell-win64.zip',
  'mac-x64': 'mac-x64/chrome-headless-shell-mac-x64.zip',
  'mac-arm64': 'mac-arm64/chrome-headless-shell-mac-arm64.zip'
};

const EXEC_SUFFIX = {
  'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  'linux-arm64': ['chrome-linux', 'headless_shell'],
  'win-x64': ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
  'mac-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  'mac-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell']
};

export function browserInstallTarget(platform = PLATFORM) {
  return {
    zipSuffix: ZIP_SUFFIX[platform] || ZIP_SUFFIX['linux-x64'],
    execParts: EXEC_SUFFIX[platform] || EXEC_SUFFIX['linux-x64']
  };
}

export async function trySparticuzBrowser() {
  if (process.platform !== 'linux') return null;
  try {
    const mod = await import('@sparticuz/chromium');
    const sp = mod.default || mod;
    const executablePath = await sp.executablePath();
    return { executablePath, args: sp.args || [] };
  } catch {
    return null;
  }
}

function chmodTree(root, executablePath) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      fs.chmodSync(p, 0o755);
      chmodTree(p, executablePath);
    } else {
      fs.chmodSync(p, p === executablePath ? 0o755 : 0o644);
    }
  }
}

export async function downloadAndExtractBrowser() {
  const browsersJson = JSON.parse(
    fs.readFileSync(path.join(path.dirname(require.resolve('playwright-core')), 'browsers.json'), 'utf8')
  );
  const desc = browsersJson.browsers.find((b) => b.name === 'chromium-headless-shell');
  if (!desc) throw new Error('chromium-headless-shell not listed in playwright-core/browsers.json');
  const { zipSuffix, execParts } = browserInstallTarget();
  const url = `https://cdn.playwright.dev/builds/cft/${desc.browserVersion}/${zipSuffix}`;

  const browsersDir = path.join(os.tmpdir(), 'pw-browsers');
  const browserDir = path.join(browsersDir, `chromium_headless_shell-${desc.revision}`);
  fs.mkdirSync(browserDir, { recursive: true });

  const executablePath = path.join(browserDir, ...execParts);
  if (!fs.existsSync(executablePath)) {
    const zipPath = path.join(os.tmpdir(), `pw-shell-${desc.revision}.zip`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Browser download failed (HTTP ${res.status}): ${url}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    try {
      new AdmZip(zipPath).extractAllTo(browserDir, true);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Chromium extracted but executable missing: ${executablePath}`);
    }
  }
  chmodTree(browserDir, executablePath);
  return { executablePath, browsersPath: browsersDir };
}