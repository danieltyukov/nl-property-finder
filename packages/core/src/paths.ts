import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Paths {
  configDir: string;
  dataDir: string;
  configFile: string;
  secretsFile: string;
  schemaFile: string;
  lastGoodFile: string;
  dbFile: string;
  browserDir: string;
  documentsDir: string;
  logsDir: string;
  tokenFile: string;
}

const APP = 'nl-property-finder';

/**
 * Where everything lives. `NLPF_HOME` puts config and data under one folder,
 * which is what tests and demo mode use. Otherwise the platform convention:
 * XDG on Linux, Application Support on macOS, APPDATA on Windows.
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Paths {
  let configDir: string;
  let dataDir: string;
  if (env.NLPF_HOME) {
    configDir = join(env.NLPF_HOME, 'config');
    dataDir = join(env.NLPF_HOME, 'data');
  } else if (platform === 'darwin') {
    configDir = dataDir = join(homedir(), 'Library', 'Application Support', APP);
  } else if (platform === 'win32') {
    const base = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    configDir = join(base, APP, 'config');
    dataDir = join(base, APP, 'data');
  } else {
    configDir = join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP);
    dataDir = join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), APP);
  }
  const paths: Paths = {
    configDir,
    dataDir,
    configFile: join(configDir, 'config.yaml'),
    secretsFile: join(configDir, 'secrets.env'),
    schemaFile: join(configDir, 'config.schema.json'),
    lastGoodFile: join(dataDir, 'config.last-good.json'),
    dbFile: join(dataDir, 'nlpf.db'),
    browserDir: join(dataDir, 'browser'),
    documentsDir: join(dataDir, 'documents'),
    logsDir: join(dataDir, 'logs'),
    tokenFile: join(dataDir, 'api-token'),
  };
  for (const dir of [configDir, dataDir, paths.browserDir, paths.documentsDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
