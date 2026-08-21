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
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
}

function fetchJsonFromGithub(path: string): Promise<unknown> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path,
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

function fetchLatestRelease(repo: string): Promise<GithubRelease | null> {
  return fetchJsonFromGithub(`/repos/${repo}/releases/latest`).then((value) => (value as GithubRelease | null) ?? null);
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

export interface UpdateHistoryEntry {
  version: string;
  title?: string;
  publishedAt?: string;
  releaseUrl: string;
  notes: string;
}

// 版本历史缓存：列表全量拉取代价大（50 条 releases + 全部 notes），
// 拉到后长期缓存；每次只用轻量的 /releases/latest 探测最新版本号，
// 版本号变化（发了新版本）才重新全量拉取。探测本身再套一层短 TTL，
// 避免频繁打开关于页时连 latest 都不打（GitHub API 有速率限制）。
let historyCache: { at: number; entries: UpdateHistoryEntry[] } | null = null;
let latestProbeCache: { at: number; version: string } | null = null;
const LATEST_PROBE_TTL_MS = 10 * 60 * 1000;
const HISTORY_MAX_ENTRIES = 20;

function parseUpdateTitleFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  // 发布说明格式：## 更新标题\n\n<标题内容>（见 docs/releases/vX.md 模板）
  const match = body.match(/##\s*更新标题\s*\n+\s*([^\n]+)/);
  const title = match?.[1]?.trim();
  return title || undefined;
}

/** 轻量探测最新发布版本号（带短 TTL，命中缓存直接返回缓存值） */
async function probeLatestVersion(): Promise<string | null> {
  if (latestProbeCache && Date.now() - latestProbeCache.at < LATEST_PROBE_TTL_MS) {
    return latestProbeCache.version;
  }
  const release = await fetchLatestRelease('liaoweixiang2024-blip/3DPartHub');
  if (!release?.tag_name) return null;
  latestProbeCache = { at: Date.now(), version: release.tag_name };
  return release.tag_name;
}

/**
 * 版本更新历史（关于页时间线数据源）：最近 N 个 GitHub Releases，
 * 按发布时间倒序。拉取失败（离线/限流）返回空数组，前端显示占位。
 */
export async function getUpdateHistory(): Promise<UpdateHistoryEntry[]> {
  // 已有缓存：只在探测到新版本发布时才全量刷新
  if (historyCache) {
    const latest = await probeLatestVersion();
    const cachedTop = historyCache.entries[0]?.version;
    if (!latest || latest === cachedTop) return historyCache.entries;
    // latest 与缓存顶版本不一致 → 有新版本发布，落到下方全量拉取
  }

  const raw = await fetchJsonFromGithub('/repos/liaoweixiang2024-blip/3DPartHub/releases?per_page=50');
  if (!Array.isArray(raw)) return historyCache?.entries ?? [];

  const entries: UpdateHistoryEntry[] = raw
    .filter((item): item is GithubRelease => {
      const release = item as GithubRelease;
      return Boolean(release && release.tag_name && release.html_url && !release.draft && !release.prerelease);
    })
    .map((release) => ({
      version: release.tag_name,
      title: parseUpdateTitleFromBody(release.body) || release.name || undefined,
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      notes: (release.body || '').trim(),
    }))
    .slice(0, HISTORY_MAX_ENTRIES);

  historyCache = { at: Date.now(), entries };
  return entries;
}
