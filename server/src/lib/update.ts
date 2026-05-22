import { readFileSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';

export function normalizeVersionTag(value: string): string {
  const version = value.trim();
  if (!version) return '';
  if (version.startsWith('v')) return version;
  return /^\d+\.\d+\.\d+/.test(version) ? `v${version}` : version;
}

function readPackageVersion(path: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? normalizeVersionTag(pkg.version) : '';
  } catch {
    return '';
  }
}

/**
 * Get local version from the VERSION file injected at Docker build time,
 * falling back to package.json for source/local deployments.
 * Safe for public endpoints — no network or git operations.
 */
export function getLocalVersion(): string {
  try {
    const version = readFileSync('/app/VERSION', 'utf-8').trim();
    if (version) return normalizeVersionTag(version);
  } catch {
    /* no VERSION file */
  }
  try {
    const version = readFileSync(join(process.cwd(), 'VERSION'), 'utf-8').trim();
    if (version) return normalizeVersionTag(version);
  } catch {
    /* no local VERSION file */
  }

  const packageVersion =
    readPackageVersion(join(process.cwd(), 'package.json')) ||
    readPackageVersion(join(process.cwd(), 'server/package.json'));
  if (packageVersion) return packageVersion;

  return 'unknown';
}

interface GithubRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
}

function fetchLatestRelease(repo: string): Promise<GithubRelease | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': '3DPartHub' },
      timeout: 10000,
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

export interface UpdateCheckResult {
  current: string;
  remote: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  releaseNotes?: string;
}

/**
 * Check for updates by comparing local version with latest GitHub release.
 * No git operations — works in pure Docker image deployments.
 */
export async function checkUpdateAvailable(): Promise<UpdateCheckResult> {
  const current = getLocalVersion();
  const release = await fetchLatestRelease('liaoweixiang2024-blip/3DPartHub');

  if (!release) {
    return { current, remote: 'unknown', updateAvailable: false };
  }

  const remote = release.tag_name;
  const updateAvailable =
    current !== 'unknown' &&
    normalizeVersionTag(current).replace(/^v/, '') !== normalizeVersionTag(remote).replace(/^v/, '');

  return {
    current,
    remote,
    updateAvailable,
    releaseUrl: release.html_url,
    releaseNotes: release.body || undefined,
  };
}
