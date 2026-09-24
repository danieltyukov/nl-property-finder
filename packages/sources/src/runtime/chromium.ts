import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

export interface ResolveChromiumOptions {
  /** An explicit path wins over everything else. */
  executablePath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Existence check, for tests. */
  exists?: (path: string) => boolean;
  /** The executable Playwright expects for its own revision, for tests. Default: `chromium.executablePath()`. */
  playwrightPath?: () => string | undefined;
}

function playwrightCacheDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'ms-playwright');
}

function executablesIn(revisionDir: string, platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac'].flatMap((d) => [
      join(revisionDir, d, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      join(revisionDir, d, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]);
  }
  if (platform === 'win32') return ['chrome-win64', 'chrome-win'].map((d) => join(revisionDir, d, 'chrome.exe'));
  return ['chrome-linux64', 'chrome-linux'].map((d) => join(revisionDir, d, 'chrome'));
}

const SYSTEM_CHROME: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/**
 * Finds a Chromium to drive, in this order: an explicit `executablePath`;
 * Playwright's download cache (its own revision first, then any other
 * installed revision, newest first); `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; a
 * system Chrome or Chromium. Returns undefined when none exists.
 */
export function resolveChromium(opts: ResolveChromiumOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  if (opts.executablePath) return exists(opts.executablePath) ? opts.executablePath : undefined;

  const candidates: string[] = [];
  const own = (opts.playwrightPath ?? (() => {
    try {
      return chromium.executablePath();
    } catch {
      return undefined;
    }
  }))();
  if (own) candidates.push(own);

  const cache = playwrightCacheDir(env, platform);
  try {
    const revisions = readdirSync(cache)
      .map((d) => /^chromium-(\d+)$/.exec(d))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const m of revisions) candidates.push(...executablesIn(join(cache, m[0]), platform));
  } catch {
    // No cache folder: fall through to the other options.
  }
  if (env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) candidates.push(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE);
  candidates.push(...(SYSTEM_CHROME[platform] ?? []));
  return candidates.find((c) => exists(c));
}

const versions = new Map<string, Promise<number | undefined>>();

/**
 * Major version of a Chrome executable from `--version`, cached per path.
 * Not attempted on Windows, where `chrome.exe --version` opens a window.
 */
export function chromeMajorVersion(executable: string, platform: NodeJS.Platform = process.platform): Promise<number | undefined> {
  if (platform === 'win32') return Promise.resolve(undefined);
  let v = versions.get(executable);
  if (!v) {
    v = new Promise((resolve) => {
      execFile(executable, ['--version'], { timeout: 10_000 }, (err, stdout) => {
        const m = /(\d+)\.\d+\.\d+\.\d+/.exec(String(stdout));
        resolve(err || !m ? undefined : Number(m[1]));
      });
    });
    versions.set(executable, v);
  }
  return v;
}
