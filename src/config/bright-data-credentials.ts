import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface BrightDataCliCredentials {
  api_key?: string;
  apiKey?: string;
}

export function resolveBrightDataCredentialsPath(): string | null {
  if (process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH?.trim()) {
    return process.env.BRIGHTDATA_CLI_CREDENTIALS_PATH.trim();
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'brightdata-cli', 'credentials.json');
  }

  return join(homedir(), '.config', 'brightdata-cli', 'credentials.json');
}

export function loadBrightDataApiTokenFromCli(): string | undefined {
  const credentialsPath = resolveBrightDataCredentialsPath();
  if (!credentialsPath || !existsSync(credentialsPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8')) as BrightDataCliCredentials;
    const token = parsed.api_key?.trim() || parsed.apiKey?.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}
