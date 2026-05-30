#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function usage() {
  console.log(`3DPartHub deploy health report verifier

Usage:
  node scripts/verify-deploy-health-report.mjs deploy-health-report.json
  node scripts/verify-deploy-health-report.mjs deploy-health-report.json --require-text deploy-health-report.txt
  node scripts/verify-deploy-health-report.mjs deploy-evidence-20260526-120000.tar.gz
  node scripts/verify-deploy-health-report.mjs deploy-evidence-20260526-120000

Options:
  --allow-warnings       Accept a report with warnings and no failures.
  --max-age-hours HOURS  Fail when generatedAt is older than HOURS.
  --require-text FILE    Also require the plain-text report to exist and look valid.
  --require-final-conclusion
                         Fail unless the acceptance summary is ready for a final production conclusion.
  --summary FILE         Write a Markdown acceptance summary after verification.
  --summary-json FILE    Write a machine-readable JSON acceptance summary.
  -h, --help             Show this help.`);
}

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`Cannot read valid JSON report: ${file} (${detail})`);
  }
}

function ensureParentDir(file) {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
}

function markdownEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function parseJsonText(body, label) {
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(`Cannot read valid JSON from ${label} (${detail})`);
  }
}

function parseGeneratedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2');
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isEvidenceArchive(file) {
  return file.endsWith('.tar.gz') || file.endsWith('.tgz');
}

const EVIDENCE_MANIFEST_FILE = 'manifest.json';
const EVIDENCE_PAYLOAD_FILES = [
  'deploy-health-report.json',
  'deploy-health-report.txt',
  'compose-ps.txt',
  'compose-services.txt',
  'api-logs-tail.txt',
  'web-logs-tail.txt',
  'docker-ps.txt',
  'docker-system-df.txt',
  'host-resources.txt',
  'network-listeners.txt',
  'backup-inventory.txt',
  'deployment-provenance.txt',
  'README.txt',
];
const REQUIRED_EVIDENCE_FILES = [...EVIDENCE_PAYLOAD_FILES, EVIDENCE_MANIFEST_FILE];
const REQUIRED_EVIDENCE_FILE_SET = new Set(REQUIRED_EVIDENCE_FILES);
const TAR_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const PROVENANCE_MAX_BYTES = 256 * 1024;
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:DB_PASSWORD|REDIS_PASSWORD|JWT_SECRET|ADMIN_PASS|BACKUP_SIGNING_SECRET|BACKUP_ENCRYPTION_SECRET|DATABASE_URL|REDIS_URL|REDISCLI_AUTH|SMTP_PASS|MINIO_SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN)\s*[:=]\s*(?!\[redacted\]|\*\*\*|<redacted>|not included\b)['"]?[^\s'"]{4,}/i;
const SECRET_URL_PATTERN =
  /\b(?:postgres(?:ql)?|redis|mysql|mongodb):\/\/[^\s:@/]*:(?!\*\*\*@|\[redacted\]@|<redacted>@)[^@\s/]+@/i;
const AUTH_HEADER_PATTERN = /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+(?!\[redacted\])\S+/i;

function assertSafeArchiveEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (
      path.isAbsolute(normalized) ||
      /^[A-Za-z]:\//.test(normalized) ||
      segments.includes('..') ||
      normalized.startsWith('-')
    ) {
      fail(`Evidence archive contains unsafe path: ${entry}`);
    }
    if (segments.some((segment) => segment.startsWith('-'))) {
      fail(`Evidence archive contains unsafe path segment: ${entry}`);
    }
    if (segments.includes('.env')) {
      fail('Evidence archive must not include .env');
    }
  }
}

function assertSafeArchiveEntryTypes(entries, verboseListing) {
  const lines = verboseListing
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const type = lines[index][0];
    if (type !== '-' && type !== 'd') {
      fail(`Evidence archive contains unsupported entry type: ${entries[index] || lines[index]}`);
    }
    if (type === '-') {
      const normalized = (entries[index] || '').replace(/\\/g, '/');
      const segments = normalized.split('/').filter(Boolean);
      const name = path.basename(normalized);
      if (!REQUIRED_EVIDENCE_FILE_SET.has(name)) {
        fail(`Evidence archive contains unexpected evidence file: ${entries[index] || name}`);
      }
      if (segments.length > 2) {
        fail(`Evidence archive contains nested evidence file: ${entries[index]}`);
      }
    }
  }
}

function runTar(args, label) {
  const result = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: TAR_MAX_BUFFER_BYTES });
  if (result.error) fail(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || '';
}

function runTarBuffer(args, label) {
  const result = spawnSync('tar', args, { maxBuffer: TAR_MAX_BUFFER_BYTES });
  if (result.error) fail(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = Buffer.concat([result.stderr || Buffer.alloc(0), result.stdout || Buffer.alloc(0)])
      .toString('utf8')
      .trim();
    fail(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || Buffer.alloc(0);
}

function findEvidenceFile(root, name) {
  const found = findEvidenceFiles(root, name);
  if (found.length > 1) fail(`Evidence directory contains multiple ${name} files`);
  return found[0] || '';
}

function findEvidenceFiles(root, name) {
  const found = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`Evidence directory contains symlink: ${fullPath}`);
    if (entry.isFile() && entry.name === name) found.push(fullPath);
    if (entry.isDirectory()) {
      found.push(...findEvidenceFiles(fullPath, name));
    }
  }
  return found;
}

function assertNoEnvFile(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.name === '.env') fail('Evidence directory must not include .env');
    if (entry.isDirectory()) assertNoEnvFile(fullPath);
  }
}

function assertOnlyExpectedEvidenceFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`Evidence directory contains symlink: ${fullPath}`);
    if (entry.isDirectory()) fail(`Evidence directory contains unexpected directory: ${fullPath}`);
    if (!entry.isFile()) fail(`Evidence directory contains unsupported entry type: ${fullPath}`);
    if (!REQUIRED_EVIDENCE_FILE_SET.has(entry.name)) {
      fail(`Evidence directory contains unexpected evidence file: ${entry.name}`);
    }
  }
}

function findArchiveEvidenceEntry(entries, name) {
  const matches = entries.filter((entry) => path.basename(entry.replace(/\\/g, '/')) === name);
  if (matches.length === 0) return '';
  if (matches.length > 1) fail(`Evidence archive contains multiple ${name} files`);
  return matches[0];
}

function readArchiveEntry(archive, entry) {
  return runTarBuffer(['-xOzf', archive, entry], `Reading ${entry} from evidence archive`);
}

function sha256Hex(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function emptyArchiveSha256Evidence() {
  return {
    present: false,
    verified: false,
    sidecar: null,
    archive: null,
    referencesArchive: false,
    expected: null,
    actual: null,
  };
}

function verifyArchiveSha256Sidecar(archive) {
  const sidecar = `${archive}.sha256`;
  const actual = sha256Hex(fs.readFileSync(archive));
  if (!fs.existsSync(sidecar)) {
    return {
      ...emptyArchiveSha256Evidence(),
      actual,
    };
  }
  const stat = fs.statSync(sidecar);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 4096) {
    fail(`Evidence archive SHA-256 sidecar is invalid: ${sidecar}`);
  }
  const body = fs.readFileSync(sidecar, 'utf8');
  const match = body.match(/\b[a-f0-9]{64}\b/i);
  if (!match) fail(`Evidence archive SHA-256 sidecar does not contain a digest: ${sidecar}`);
  const archiveName = path.basename(archive);
  if (!body.includes(archiveName)) {
    fail(`Evidence archive SHA-256 sidecar does not reference archive name: ${archiveName}`);
  }
  const expected = match[0].toLowerCase();
  if (actual !== expected) fail(`Evidence archive SHA-256 sidecar mismatch for ${archive}`);
  return {
    present: true,
    verified: true,
    sidecar: path.resolve(sidecar),
    archive: archiveName,
    referencesArchive: true,
    expected,
    actual,
  };
}

function assertNonEmptyFile(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    fail(`Evidence directory is missing ${label}`);
  }
  if (!stat.isFile() || stat.size <= 0) fail(`Evidence file is empty or invalid: ${label}`);
}

function requireEvidenceDirectoryFiles(root) {
  const files = new Map();
  for (const name of REQUIRED_EVIDENCE_FILES) {
    const file = findEvidenceFile(root, name);
    if (!file) fail(`Evidence directory is missing ${name}: ${root}`);
    assertNonEmptyFile(file, name);
    files.set(name, file);
  }
  return files;
}

function requireEvidenceArchiveEntries(archive, entries) {
  const files = new Map();
  for (const name of REQUIRED_EVIDENCE_FILES) {
    const entry = findArchiveEvidenceEntry(entries, name);
    if (!entry) fail(`Evidence archive is missing ${name}: ${archive}`);
    const body = readArchiveEntry(archive, entry);
    if (body.length === 0) fail(`Evidence archive file is empty: ${name}`);
    files.set(name, { entry, body });
  }
  return files;
}

function verifyManifestShape(manifest, label) {
  if (!isObject(manifest)) fail(`${label} must be an object`);
  if (manifest.schemaVersion !== 1) fail(`${label} schemaVersion must be 1`);
  if (typeof manifest.bundleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(manifest.bundleId)) {
    fail(`${label} bundleId is missing or invalid`);
  }
  if (manifest.hashAlgorithm !== 'sha256') fail(`${label} hashAlgorithm must be sha256`);
  if (!Array.isArray(manifest.files)) fail(`${label} files must be an array`);

  const expected = new Set(EVIDENCE_PAYLOAD_FILES);
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!isObject(entry)) fail(`${label} file entries must be objects`);
    if (typeof entry.path !== 'string' || !expected.has(entry.path)) {
      fail(`${label} contains unexpected file: ${entry.path || '<missing>'}`);
    }
    if (seen.has(entry.path)) fail(`${label} contains duplicate file: ${entry.path}`);
    seen.add(entry.path);
    if (typeof entry.size !== 'number' || !Number.isInteger(entry.size) || entry.size <= 0) {
      fail(`${label} file has invalid size: ${entry.path}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      fail(`${label} file has invalid sha256: ${entry.path}`);
    }
  }
  for (const name of expected) {
    if (!seen.has(name)) fail(`${label} is missing file: ${name}`);
  }
  return manifest.files;
}

function verifyDirectoryManifest(files) {
  const manifestFile = files.get(EVIDENCE_MANIFEST_FILE);
  const manifest = readJson(manifestFile);
  const entries = verifyManifestShape(manifest, EVIDENCE_MANIFEST_FILE);
  for (const entry of entries) {
    const file = files.get(entry.path);
    assertNonEmptyFile(file, entry.path);
    const body = fs.readFileSync(file);
    const size = body.length;
    const digest = sha256Hex(body);
    if (size !== entry.size) fail(`${EVIDENCE_MANIFEST_FILE} size mismatch for ${entry.path}`);
    if (digest !== entry.sha256) fail(`${EVIDENCE_MANIFEST_FILE} sha256 mismatch for ${entry.path}`);
  }
  return manifest;
}

function verifyArchiveManifest(files) {
  const manifestBody = files.get(EVIDENCE_MANIFEST_FILE).body;
  const manifest = parseJsonText(manifestBody, EVIDENCE_MANIFEST_FILE);
  const entries = verifyManifestShape(manifest, EVIDENCE_MANIFEST_FILE);
  for (const entry of entries) {
    const body = files.get(entry.path).body;
    const size = body.length;
    const digest = sha256Hex(body);
    if (size !== entry.size) fail(`${EVIDENCE_MANIFEST_FILE} size mismatch for ${entry.path}`);
    if (digest !== entry.sha256) fail(`${EVIDENCE_MANIFEST_FILE} sha256 mismatch for ${entry.path}`);
  }
  return manifest;
}

function readDirectoryEvidenceTexts(files) {
  const texts = new Map();
  for (const name of EVIDENCE_PAYLOAD_FILES) {
    texts.set(name, fs.readFileSync(files.get(name), 'utf8'));
  }
  return texts;
}

function readArchiveEvidenceTexts(files) {
  const texts = new Map();
  for (const name of EVIDENCE_PAYLOAD_FILES) {
    texts.set(name, files.get(name).body.toString('utf8'));
  }
  return texts;
}

function evidenceText(texts, name) {
  const body = texts instanceof Map ? texts.get(name) : '';
  if (typeof body !== 'string' || !body.trim()) fail(`Evidence support file is empty: ${name}`);
  return body;
}

function assertNoSensitiveText(label, body) {
  if (SECRET_ASSIGNMENT_PATTERN.test(body)) fail(`${label} must not expose secret-like assignment`);
  if (SECRET_URL_PATTERN.test(body)) fail(`${label} must not expose credential-bearing URL`);
  if (AUTH_HEADER_PATTERN.test(body)) fail(`${label} must not expose Authorization credentials`);
}

function assertNoSensitiveEvidenceTexts(texts) {
  for (const [name, body] of texts.entries()) {
    assertNoSensitiveText(name, body);
  }
}

function assertEvidenceIncludes(texts, name, needle) {
  if (!evidenceText(texts, name).includes(needle)) fail(`Evidence support file ${name} is missing ${needle}`);
}

function assertEvidenceLine(texts, name, value) {
  const pattern = new RegExp(`(^|\\n)${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`);
  if (!pattern.test(evidenceText(texts, name))) fail(`Evidence support file ${name} is missing line: ${value}`);
}

function verifyEvidenceSupportFiles(texts, manifest, report) {
  assertNoSensitiveEvidenceTexts(texts);
  if (report.context.evidenceBundleId !== manifest.bundleId) {
    fail(`Report evidenceBundleId does not match manifest bundleId: ${report.context.evidenceBundleId || '<missing>'}`);
  }
  assertEvidenceIncludes(texts, 'compose-ps.txt', '== compose ps ==');
  assertEvidenceIncludes(texts, 'compose-services.txt', '== compose services ==');
  assertEvidenceIncludes(texts, 'api-logs-tail.txt', '== api logs tail ==');
  assertEvidenceIncludes(texts, 'web-logs-tail.txt', '== web logs tail ==');
  assertEvidenceIncludes(texts, 'docker-ps.txt', '== docker ps ==');
  assertEvidenceIncludes(texts, 'docker-system-df.txt', '== docker system df ==');
  assertEvidenceIncludes(texts, 'host-resources.txt', '== host resources ==');
  assertEvidenceIncludes(texts, 'host-resources.txt', '== memory ==');
  assertEvidenceIncludes(texts, 'host-resources.txt', '== disk ==');
  assertEvidenceIncludes(texts, 'host-resources.txt', '== inodes ==');
  assertEvidenceIncludes(texts, 'network-listeners.txt', '== network listeners ==');
  assertEvidenceIncludes(texts, 'network-listeners.txt', 'Port:');
  assertEvidenceIncludes(texts, 'network-listeners.txt', '== listeners on port');
  assertEvidenceIncludes(texts, 'backup-inventory.txt', '== backup inventory ==');
  assertEvidenceIncludes(texts, 'backup-inventory.txt', 'Backup dir:');
  assertEvidenceIncludes(texts, 'backup-inventory.txt', '== recent backup records ==');
  assertEvidenceIncludes(texts, 'README.txt', '3DPartHub deployment evidence bundle');
  assertEvidenceIncludes(texts, 'README.txt', 'Env file:');
  assertEvidenceIncludes(texts, 'README.txt', '(not included)');
  assertEvidenceIncludes(texts, 'README.txt', `Evidence bundle ID: ${manifest.bundleId}`);
  assertEvidenceIncludes(texts, 'README.txt', 'API logs: api-logs-tail.txt');
  assertEvidenceIncludes(texts, 'README.txt', 'Web logs: web-logs-tail.txt');
  assertEvidenceIncludes(texts, 'README.txt', 'Host resources: host-resources.txt');
  assertEvidenceIncludes(texts, 'README.txt', 'Network listeners: network-listeners.txt');
  assertEvidenceIncludes(texts, 'README.txt', 'Backup inventory: backup-inventory.txt');
  assertEvidenceIncludes(texts, 'deployment-provenance.txt', `Evidence bundle ID: ${manifest.bundleId}`);
  assertEvidenceIncludes(texts, 'README.txt', 'npm run deploy:acceptance');
  assertEvidenceIncludes(texts, 'docker-system-df.txt', 'TYPE');

  for (const service of ['api', 'web', 'postgres', 'redis']) {
    assertEvidenceLine(texts, 'compose-services.txt', service);
    assertEvidenceIncludes(texts, 'compose-ps.txt', `3dparthub-${service}`);
    assertEvidenceIncludes(texts, 'docker-ps.txt', `3dparthub-${service}`);
  }
}

function resolveReportInput(input, options) {
  const resolvedInput = path.resolve(input);
  if (fs.existsSync(resolvedInput) && fs.statSync(resolvedInput).isDirectory()) {
    assertNoEnvFile(resolvedInput);
    assertOnlyExpectedEvidenceFiles(resolvedInput);
    const files = requireEvidenceDirectoryFiles(resolvedInput);
    const manifest = verifyDirectoryManifest(files);
    const reportFile = files.get('deploy-health-report.json');
    const textReport = files.get('deploy-health-report.txt');
    return {
      reportFile,
      textReport,
      provenanceText: fs.readFileSync(files.get('deployment-provenance.txt'), 'utf8'),
      cleanupDir: '',
      sourceKind: 'evidence-directory',
      manifestVerified: true,
      provenanceVerified: false,
      archiveSha256Verified: false,
      archiveSha256: emptyArchiveSha256Evidence(),
      evidenceTexts: readDirectoryEvidenceTexts(files),
      manifest,
    };
  }

  if (isEvidenceArchive(resolvedInput)) {
    if (!fs.existsSync(resolvedInput)) fail(`Evidence archive does not exist: ${resolvedInput}`);
    const archiveSha256 = verifyArchiveSha256Sidecar(resolvedInput);
    const listing = runTar(['-tzf', resolvedInput], 'Listing evidence archive')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
    assertSafeArchiveEntries(listing);
    assertSafeArchiveEntryTypes(listing, runTar(['-tvzf', resolvedInput], 'Inspecting evidence archive'));
    const files = requireEvidenceArchiveEntries(resolvedInput, listing);
    const manifest = verifyArchiveManifest(files);
    const cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), '3dparthub-evidence-'));
    try {
      const reportFile = path.join(cleanupDir, 'deploy-health-report.json');
      const textReport = path.join(cleanupDir, 'deploy-health-report.txt');
      fs.writeFileSync(reportFile, files.get('deploy-health-report.json').body);
      fs.writeFileSync(textReport, files.get('deploy-health-report.txt').body);
      return {
        reportFile,
        textReport,
        provenanceText: files.get('deployment-provenance.txt').body.toString('utf8'),
        cleanupDir,
        sourceKind: 'evidence-archive',
        manifestVerified: true,
        provenanceVerified: false,
        archiveSha256Verified: archiveSha256.verified,
        archiveSha256,
        evidenceTexts: readArchiveEvidenceTexts(files),
        manifest,
      };
    } catch (err) {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      throw err;
    }
  }

  return {
    reportFile: resolvedInput,
    textReport: options.requireText,
    provenanceText: '',
    cleanupDir: '',
    sourceKind: 'report',
    manifestVerified: false,
    provenanceVerified: false,
    archiveSha256Verified: false,
    archiveSha256: emptyArchiveSha256Evidence(),
    evidenceTexts: new Map(),
    manifest: null,
  };
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a non-negative number`);
  }
}

function checkMessages(report, status) {
  return report.checks
    .filter((check) => check.status === status)
    .map((check) => check.message)
    .filter(Boolean);
}

function formatCheckMessages(title, messages) {
  const lines = messages.slice(0, 12).map((message) => `- ${message}`);
  if (messages.length > lines.length) lines.push(`- ... ${messages.length - lines.length} more`);
  return `${title}\n${lines.join('\n')}`;
}

const REQUIRED_PASS_MESSAGES = [
  'Docker daemon 可访问',
  'Compose 配置语法有效',
  'Compose 服务键未重复',
  'Compose 持久化挂载正常: api uploads-data -> /app/uploads',
  'Compose 持久化挂载正常: api static-data -> /app/static',
  'Compose 持久化挂载正常: api ./server/static/backups -> /app/static/backups',
  'Compose 持久化挂载正常: postgres pgdata -> /var/lib/postgresql/data',
  'Compose 持久化挂载正常: redis redis-data -> /data',
  'Compose API 关键环境已声明',
  'Compose 镜像来源正常',
  'Compose Redis healthcheck 使用认证 ping',
  'Compose Web 端口映射正常',
  'Compose 端口暴露正常',
  'Compose 日志轮转已配置',
  'Compose 资源限制已声明',
  'Compose API 停止宽限期正常',
  'Compose 内部网络正常',
  '环境文件权限安全',
  '数据库密码 DB_PASSWORD',
  'Redis 密码 REDIS_PASSWORD',
  'JWT_SECRET 已设置',
  'ADMIN_PASS 已设置',
  'ALLOWED_ORIGINS',
  '3dparthub-api 正在运行',
  '运行镜像标签与 IMAGE_TAG 一致',
  '运行镜像来源正常',
  '容器挂载正常: api uploads-data -> /app/uploads',
  '容器挂载正常: api static-data -> /app/static',
  '容器挂载正常: api ./server/static/backups -> /app/static/backups',
  '容器挂载正常: web static-data -> /app/static:ro',
  '容器挂载正常: web uploads-data -> /app/uploads:ro',
  '容器挂载正常: postgres pgdata -> /var/lib/postgresql/data',
  '容器挂载正常: redis redis-data -> /data',
  '容器日志轮转正常',
  '容器重启策略正常',
  '运行 API 停止宽限期正常',
  '容器资源限制正常',
  '容器环境与 .env 一致: API DATABASE_URL 使用 DB_PASSWORD',
  '容器环境与 .env 一致: PostgreSQL POSTGRES_PASSWORD 使用 DB_PASSWORD',
  '容器环境与 .env 一致: API REDIS_URL 使用 REDIS_PASSWORD',
  '容器启动参数与 .env 一致: Redis requirepass 使用 REDIS_PASSWORD',
  '容器环境与 .env 一致: API JWT_SECRET',
  '备份签名密钥 BACKUP_SIGNING_SECRET 已设置',
  '备份加密密钥 BACKUP_ENCRYPTION_SECRET 已设置',
  '容器环境与 .env 一致: API BACKUP_SIGNING_SECRET',
  '容器环境与 .env 一致: API BACKUP_ENCRYPTION_SECRET',
  '容器环境与 .env 一致: API CORS 允许来源',
  'API 主进程非 root 运行',
  '健康接口正常',
  'API 安全响应头正常',
  '就绪接口正常',
  '存活接口正常',
  '管理健康接口访问控制正常',
  '运行版本可读取',
  'Web 首页入口正常',
  'Web 首页安全响应头正常',
  'Web 敏感路径未暴露',
  'Web 前端静态资源正常',
  'PostgreSQL 当前密码可登录',
  '数据库迁移状态正常',
  'Redis 密码可用',
  '宿主机端口',
  'Web 容器端口映射正常',
  '运行容器端口暴露正常',
  '部署目录磁盘空间正常',
  '部署目录 inode 正常',
  'Docker 数据目录磁盘空间正常',
  'Docker 数据目录 inode 正常',
  '资源配置适配当前内存档位',
  '宿主机备份目录可写',
  '备份目录磁盘空间正常',
  '备份目录 inode 正常',
  'API 数据卷容量正常',
  'API 容器运行目录可写',
  'API 最近日志未发现常见启动错误',
  'Web 最近日志未发现常见错误',
];

const ALLOW_WARNINGS_REQUIRED_ALIASES = new Map([
  ['Docker 数据目录磁盘空间正常', ['Docker 数据目录不存在或不可访问', 'Docker 数据目录磁盘空间无法验证']],
  ['Docker 数据目录 inode 正常', ['Docker 数据目录不存在或不可访问', 'Docker 数据目录 inode 无法验证']],
  ['资源配置适配当前内存档位', ['无法读取服务器总内存', '资源配置预算检查']],
  ['API 数据卷容量正常', ['API 数据卷容量偏低', 'API 数据卷容量无法验证']],
]);

function requiredMatchesForMessage(message) {
  return REQUIRED_PASS_MESSAGES.filter((required) => message.startsWith(required));
}

function requiredPassMatches(report, required) {
  return report.checks.filter((check) => check.status === 'pass' && check.message.startsWith(required));
}

function requiredNonPassMatches(report, required) {
  return report.checks.filter((check) => check.status !== 'pass' && check.message.startsWith(required));
}

function requiredWarningCovered(report, required) {
  const aliases = ALLOW_WARNINGS_REQUIRED_ALIASES.get(required) || [];
  return report.checks.some(
    (check) =>
      check.status === 'warn' &&
      (check.message.startsWith(required) || aliases.some((alias) => check.message.includes(alias))),
  );
}

function verifyTextReport(file, report) {
  if (!fs.existsSync(file)) fail(`Plain-text report does not exist: ${file}`);
  const body = fs.readFileSync(file, 'utf8');
  assertNoSensitiveText('deploy-health-report.txt', body);
  if (!body.includes('3DPartHub Docker 部署自检')) fail(`Plain-text report header is missing: ${file}`);
  if (!body.includes('通过:')) fail(`Plain-text report summary is missing: ${file}`);
  if (report) {
    const expectedSummary = `通过: ${report.summary.passes}，警告: ${report.summary.warnings}，失败: ${report.summary.failures}`;
    if (!body.includes(expectedSummary)) fail(`Plain-text report summary does not match JSON report: ${file}`);
    for (const [needle, label] of [
      [`Compose: ${report.context.composeFile}`, 'compose file'],
      [`环境文件: ${report.context.envFile}`, 'env file'],
    ]) {
      if (!body.includes(needle)) fail(`Plain-text report ${label} does not match JSON report: ${file}`);
    }
    if (report.context.reportFile && !body.includes(`报告文件: ${report.context.reportFile}`)) {
      fail(`Plain-text report file path does not match JSON report: ${file}`);
    }
    if (report.context.evidenceBundleId && !body.includes(`证据批次: ${report.context.evidenceBundleId}`)) {
      fail(`Plain-text report evidence bundle ID does not match JSON report: ${file}`);
    }
  }
}

function assertProvenanceContains(body, needle) {
  if (!body.includes(needle)) fail(`deployment-provenance.txt is missing ${needle}`);
}

function assertProvenanceContainerImage(body, container) {
  const line = body
    .split('\n')
    .find((item) => item.includes(container) && item.includes(' image=') && item.includes(' imageId='));
  if (!line) fail(`deployment-provenance.txt is missing image tracking for ${container}`);
  if (!/\bimage=\S+/.test(line)) fail(`deployment-provenance.txt is missing image for ${container}`);
  if (!/\bimageId=sha256:[a-f0-9]{12,}/i.test(line)) {
    fail(`deployment-provenance.txt is missing valid imageId for ${container}`);
  }
  if (!/\bstatus=\S+/.test(line)) fail(`deployment-provenance.txt is missing status for ${container}`);
  if (!/\bhealth=\S+/.test(line)) fail(`deployment-provenance.txt is missing health for ${container}`);
  if (!/\brestartPolicy=\S+/.test(line)) fail(`deployment-provenance.txt is missing restartPolicy for ${container}`);
  if (!/\brestartCount=\d+/.test(line)) fail(`deployment-provenance.txt is missing restartCount for ${container}`);
  if (!/\boom=(true|false)\b/i.test(line)) fail(`deployment-provenance.txt is missing oom state for ${container}`);
}

function verifyProvenanceText(body, report) {
  if (typeof body !== 'string' || !body.trim()) fail('deployment-provenance.txt is empty');
  if (Buffer.byteLength(body, 'utf8') > PROVENANCE_MAX_BYTES) fail('deployment-provenance.txt is too large');
  assertNoSensitiveText('deployment-provenance.txt', body);
  if (
    /(?:DB_PASSWORD|REDIS_PASSWORD|JWT_SECRET|ADMIN_PASS|BACKUP_SIGNING_SECRET|BACKUP_ENCRYPTION_SECRET)\s*=/i.test(
      body,
    )
  ) {
    fail('deployment-provenance.txt must not expose secret-like assignment');
  }

  for (const needle of [
    '3DPartHub deployment provenance',
    'Generated at:',
    `Directory: ${report.context.directory}`,
    `Compose file: ${report.context.composeFile}`,
    `Env file: ${report.context.envFile} (not included)`,
    'IMAGE_TAG:',
    'Package:',
    'Client package:',
    'Server package:',
    'Git commit:',
    'Git branch:',
    'Git dirty:',
    'Containers:',
  ]) {
    assertProvenanceContains(body, needle);
  }

  for (const container of ['3dparthub-api', '3dparthub-web', '3dparthub-postgres', '3dparthub-redis']) {
    assertProvenanceContainerImage(body, container);
  }

  return true;
}

function verifyReport(report, options) {
  if (!isObject(report)) fail('Report root must be an object');
  if (report.schemaVersion !== 1) fail('Report schemaVersion must be 1');
  if (report.tool !== '3DPartHub Docker 部署自检') fail('Unexpected report tool');
  if (!['passed', 'warning', 'failed', 'strict_failed'].includes(report.result))
    fail(`Invalid result: ${report.result}`);
  if (!isObject(report.summary)) fail('Missing summary');
  assertNumber(report.summary.passes, 'summary.passes');
  assertNumber(report.summary.warnings, 'summary.warnings');
  assertNumber(report.summary.failures, 'summary.failures');
  if (!isObject(report.context)) fail('Missing context');
  if (typeof report.context.healthUrl !== 'string' || !report.context.healthUrl.includes('/api/health')) {
    fail('context.healthUrl must point to /api/health');
  }
  if (typeof report.context.composeFile !== 'string' || !report.context.composeFile)
    fail('context.composeFile is missing');
  if (typeof report.context.envFile !== 'string' || !report.context.envFile) fail('context.envFile is missing');
  if (report.context.evidenceBundleId !== undefined && typeof report.context.evidenceBundleId !== 'string') {
    fail('context.evidenceBundleId must be a string when present');
  }
  if (typeof report.context.dockerReady !== 'boolean') fail('context.dockerReady must be boolean');
  if (!report.context.dockerReady) fail('Docker daemon was not ready in the report');
  if (!Array.isArray(report.checks) || report.checks.length === 0) fail('checks must be a non-empty array');

  let passes = 0;
  let warnings = 0;
  let failures = 0;
  for (const check of report.checks) {
    if (!isObject(check)) fail('Each check must be an object');
    if (!['pass', 'warn', 'fail'].includes(check.status)) fail(`Invalid check status: ${check.status}`);
    if (typeof check.message !== 'string' || !check.message.trim()) fail('Each check must have a message');
    if (check.status === 'pass') passes += 1;
    if (check.status === 'warn') warnings += 1;
    if (check.status === 'fail') failures += 1;
  }

  if (passes !== report.summary.passes) fail(`summary.passes mismatch: ${report.summary.passes} != ${passes}`);
  if (warnings !== report.summary.warnings)
    fail(`summary.warnings mismatch: ${report.summary.warnings} != ${warnings}`);
  if (failures !== report.summary.failures)
    fail(`summary.failures mismatch: ${report.summary.failures} != ${failures}`);
  if (report.summary.failures > 0 || report.result === 'failed' || report.result === 'strict_failed') {
    const failuresList = checkMessages(report, 'fail');
    fail(
      formatCheckMessages(
        'Deploy self-check failed:',
        failuresList.length ? failuresList : ['Report result is failed'],
      ),
    );
  }
  if (!options.allowWarnings && (report.summary.warnings > 0 || report.result === 'warning')) {
    const warningsList = checkMessages(report, 'warn');
    fail(
      formatCheckMessages(
        'Deploy self-check has warnings; rerun with --allow-warnings only for temporary acceptance:',
        warningsList.length ? warningsList : ['Report result is warning'],
      ),
    );
  }
  if (report.result === 'passed' && (report.summary.warnings > 0 || report.summary.failures > 0)) {
    fail('Passed report cannot contain warnings or failures');
  }

  for (const check of report.checks.filter((item) => item.status === 'pass')) {
    const matches = requiredMatchesForMessage(check.message);
    if (matches.length > 1) {
      fail(`Passing check message matches multiple required checks: ${matches.join(' | ')}`);
    }
  }
  for (const required of REQUIRED_PASS_MESSAGES) {
    const passMatches = requiredPassMatches(report, required);
    const nonPassMatches = requiredNonPassMatches(report, required);
    if (passMatches.length === 0) {
      if (options.allowWarnings && requiredWarningCovered(report, required)) continue;
      fail(`Missing required passing check: ${required}`);
    }
    if (passMatches.length > 1) fail(`Duplicate required passing check: ${required}`);
    if (
      nonPassMatches.length > 0 &&
      !(options.allowWarnings && nonPassMatches.every((check) => check.status === 'warn'))
    ) {
      fail(`Required check also appears as non-pass: ${required}`);
    }
    for (const check of report.checks.filter(
      (item) => item.message.includes(required) && !item.message.startsWith(required),
    )) {
      fail(`Required check appears away from message prefix: ${required}`);
    }
  }

  if (options.maxAgeHours !== null) {
    const generatedAt = parseGeneratedAt(report.generatedAt);
    if (!generatedAt) fail('generatedAt is missing or unparsable');
    const maxAgeMs = options.maxAgeHours * 60 * 60 * 1000;
    if (Date.now() - generatedAt > maxAgeMs) fail(`Report is older than ${options.maxAgeHours} hours`);
  }
}

function messagesByStatus(report, status) {
  return report.checks.filter((check) => check.status === status).map((check) => check.message);
}

function requiredCheckRows(report) {
  return REQUIRED_PASS_MESSAGES.map((required) => ({
    name: required,
    status: requiredPassMatches(report, required).length === 1 ? 'pass' : 'missing',
  }));
}

function numberFromLine(body, key) {
  const match = body.match(new RegExp(`(?:^|\\n)${key}=([0-9]+)(?:\\n|$)`));
  return match ? Number(match[1]) : null;
}

function stringFromLine(body, key) {
  const match = body.match(new RegExp(`(?:^|\\n)${key}:\\s*([^\\n]+)`));
  return match ? match[1].trim() : null;
}

function valueFromTokenLine(line, key) {
  const match = line?.match(new RegExp(`\\b${key}=([^\\s]+)`));
  return match ? match[1] : null;
}

function isOlderThanDays(value, days) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return Date.now() - time > days * 24 * 60 * 60 * 1000;
}

function hasValidTimestamp(value) {
  if (!value || value === 'unknown') return false;
  return Number.isFinite(Date.parse(value));
}

function parseBackupInventory(texts) {
  if (!(texts instanceof Map) || !texts.has('backup-inventory.txt')) {
    return {
      verified: false,
      backupDir: null,
      directoryExists: null,
      recordCount: 0,
      archivePresentCount: 0,
      manifestVersionCount: 0,
      archiveSha256Count: 0,
      archiveSignatureCount: 0,
      orphanArchiveCount: 0,
      workDirCount: null,
      restoreDrillExecuted: false,
      restoreDrillStatus: 'not_verified',
      restoreDrillCheckedAt: null,
      restoreDrillRestoredFromBackupId: null,
      restoreDrillTimestampValid: false,
      status: 'not_verified',
      riskLevel: 'unknown',
      summary: '未验证完整证据包',
      nextActions: ['回传完整生产证据包后再判断备份库存。'],
    };
  }

  const body = evidenceText(texts, 'backup-inventory.txt');
  const recordLines = body.match(/(?:^|\n)record id=[^\n]+/g) || [];
  const orphanLines = body.match(/(?:^|\n)archive=[^\n]+ metadata=missing[^\n]*/g) || [];
  const directoryExists = /(?:^|\n)directoryExists=yes(?:\n|$)/.test(body)
    ? true
    : /(?:^|\n)directoryExists=no(?:\n|$)/.test(body)
      ? false
      : null;
  const archivePresentCount = recordLines.filter((line) => line.includes('archive=present')).length;
  const manifestVersionCount = recordLines.filter((line) => /manifestVersion=(?!missing\b)\S+/.test(line)).length;
  const archiveSha256Count = recordLines.filter((line) => line.includes('archiveSha256=present')).length;
  const archiveSignatureCount = recordLines.filter((line) => line.includes('archiveSignature=present')).length;
  const workDirCount = numberFromLine(body, 'workDirs');
  const restoreDrillEvidenceLine = (body.match(/(?:^|\n)Restore drill evidence:[^\n]*/) || [])[0] || '';
  const restoreDrillStatus = valueFromTokenLine(restoreDrillEvidenceLine, 'status') || 'missing';
  const restoreDrillCheckedAt = valueFromTokenLine(restoreDrillEvidenceLine, 'checkedAt');
  const restoreDrillRestoredFromBackupId = valueFromTokenLine(restoreDrillEvidenceLine, 'restoredFromBackupId');
  const restoreDrillTimestampValid = hasValidTimestamp(restoreDrillCheckedAt);
  const restoreDrillExecuted = restoreDrillStatus === 'passed' && restoreDrillTimestampValid;
  const status =
    directoryExists === false ? 'directory_missing' : recordLines.length > 0 ? 'records_present' : 'no_records';
  const restoreDrillSummary = restoreDrillExecuted ? '，恢复演练已记录' : '';
  const summary =
    status === 'directory_missing'
      ? '备份目录不存在'
      : status === 'records_present'
        ? `${recordLines.length} 条记录，${archivePresentCount} 个归档存在，${manifestVersionCount} 条 manifest，${archiveSha256Count} 条哈希，${archiveSignatureCount} 条签名，孤儿归档 ${orphanLines.length} 个${restoreDrillSummary}`
        : '未发现备份记录';
  const nextActions = [];
  let riskLevel = 'low';
  if (status === 'directory_missing') {
    riskLevel = 'high';
    nextActions.push('确认 ./server/static/backups 宿主机目录和 Compose bind mount 是否存在。');
  } else if (status === 'no_records') {
    riskLevel = 'medium';
    nextActions.push('创建一次整站备份并执行备份校验，确认至少有一个可追溯备份记录。');
  }
  if (directoryExists === null) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('备份库存证据缺少 directoryExists 摘要，无法确认备份目录是否真实存在。');
  }
  if (recordLines.length > 0 && archivePresentCount < recordLines.length) {
    riskLevel = 'high';
    nextActions.push('存在备份记录但归档文件缺失，请重新创建备份或清理损坏记录。');
  }
  if (recordLines.length > 0 && manifestVersionCount < recordLines.length) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('存在缺少企业级 manifest 的旧备份，建议重新创建新版整站备份。');
  }
  if (recordLines.length > 0 && archiveSha256Count < recordLines.length) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('存在缺少归档 SHA-256 的备份，建议重新校验或重新创建备份。');
  }
  if (recordLines.length > 0 && archiveSignatureCount < recordLines.length) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('存在缺少签名的备份，建议确认 BACKUP_SIGNING_SECRET 并重新校验备份。');
  }
  if (orphanLines.length > 0) {
    nextActions.push('发现孤儿备份归档，请确认是否需要导入登记或清理。');
  }
  if (workDirCount === null) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('备份库存证据缺少 workDirs 摘要，无法确认是否残留备份临时工作目录。');
  }
  if (workDirCount && workDirCount > 0) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('发现备份临时工作目录，请确认是否有卡住的备份、恢复、导入或校验任务。');
  }
  if (restoreDrillStatus === 'passed' && !restoreDrillTimestampValid) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('备份恢复演练状态为 passed，但时间无效；请重新执行恢复演练并重新采集证据。');
  } else if (!restoreDrillExecuted) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('定期执行备份恢复演练；该证据只证明目录库存，不证明可恢复。');
  } else if (isOlderThanDays(restoreDrillCheckedAt, 30)) {
    if (riskLevel === 'low') riskLevel = 'medium';
    nextActions.push('最近备份恢复演练超过 30 天，建议在版本升级或大批量导入后重新演练。');
  }

  return {
    verified: true,
    backupDir: stringFromLine(body, 'Backup dir'),
    directoryExists,
    recordCount: recordLines.length,
    archivePresentCount,
    manifestVersionCount,
    archiveSha256Count,
    archiveSignatureCount,
    orphanArchiveCount: orphanLines.length,
    workDirCount,
    restoreDrillExecuted,
    restoreDrillStatus,
    restoreDrillCheckedAt,
    restoreDrillRestoredFromBackupId,
    restoreDrillTimestampValid,
    status,
    riskLevel,
    summary,
    nextActions,
  };
}

function buildAcceptanceSummaryModel(input, resolved, report) {
  const warnings = messagesByStatus(report, 'warn');
  const failures = messagesByStatus(report, 'fail');
  const backupInventory = parseBackupInventory(resolved.evidenceTexts);
  const generatedAt = new Date().toISOString();
  const passedWithoutWarnings =
    report.result === 'passed' && report.summary.warnings === 0 && report.summary.failures === 0;
  const completeEvidenceProvided = resolved.manifestVerified && resolved.provenanceVerified;
  const archiveSidecarRequirementSatisfied =
    resolved.sourceKind !== 'evidence-archive' || resolved.archiveSha256Verified;
  const backupInventoryReady =
    completeEvidenceProvided && backupInventory.verified && backupInventory.riskLevel === 'low';
  const finalConclusionBlockers = [];
  if (!passedWithoutWarnings) {
    finalConclusionBlockers.push('健康报告仍包含警告或失败项。');
  }
  if (!completeEvidenceProvided) {
    finalConclusionBlockers.push('未提供完整生产证据包，缺少 manifest、辅助证据或版本/镜像追踪验证。');
  }
  if (!archiveSidecarRequirementSatisfied) {
    finalConclusionBlockers.push('未验证同名 .tar.gz.sha256，无法确认归档传输后一致性。');
  }
  if (completeEvidenceProvided && !backupInventoryReady) {
    finalConclusionBlockers.push(
      `备份库存风险未关闭（当前风险：${backupInventory.riskLevel}），需要有效备份记录、归档完整性和最近备份恢复演练证据。`,
    );
  }
  const finalConclusionReady =
    passedWithoutWarnings && completeEvidenceProvided && archiveSidecarRequirementSatisfied && backupInventoryReady;
  const archiveShaLine =
    resolved.sourceKind === 'evidence-archive'
      ? resolved.archiveSha256Verified
        ? '同名 .tar.gz.sha256 已验证归档本身 SHA-256；'
        : '未发现同名 .tar.gz.sha256，已继续校验证据包内部 manifest；'
      : '';
  const evidenceLine = resolved.manifestVerified
    ? `${archiveShaLine}证据包完整性已通过 manifest.json 大小/SHA-256 校验，版本/镜像追踪内容已验证，并已拒绝 .env、敏感信息、额外文件、重复报告、符号链接、特殊文件和不安全路径。`
    : '当前仅验证 JSON/TXT 报告，未验证完整证据包的 manifest、Compose 状态、API/Web 日志、Docker/宿主机资源、网络监听、备份库存和版本/镜像追踪信息。';
  const completionLine =
    passedWithoutWarnings && finalConclusionReady
      ? 'Docker 部署自检、健康报告和生产证据闭环验收通过。'
      : passedWithoutWarnings
        ? 'Docker 部署自检与健康报告通过，但最终生产结论仍需补齐证据闭环风险项。'
        : '报告已在允许警告模式下通过，仍需处理或书面接受警告项后再作为生产发布依据。';
  const riskLines = [
    '该摘要只证明报告生成时间点的部署快照，生产重启、升级、恢复备份、修改 .env 或调整反代后需要重新采集证据。',
    '该检查覆盖 Docker/Compose、容器健康、重启策略、日志轮转、数据库密码、Redis、端口、健康接口、Web 入口、API 运行目录、磁盘/inode/内存、宿主机资源、网络监听、备份库存快照和 API/Web 日志，不替代定期备份恢复演练。',
    '证据包故意不包含 .env，采集端会脱敏常见密钥/连接串/Authorization，验收器也会拒绝明显敏感文本；密钥强度只能通过自检结果和警告项间接确认。',
  ];
  if (!resolved.manifestVerified) {
    riskLines.unshift(
      '未使用完整证据包时，无法证明 Compose 状态、API/Web 日志尾部、Docker/宿主机资源、网络监听、备份库存、版本/镜像追踪信息和证据文件哈希未被篡改。',
    );
  }
  if (resolved.sourceKind === 'evidence-archive' && !resolved.archiveSha256Verified) {
    riskLines.unshift('未验证同名 .tar.gz.sha256 时，无法证明证据包归档在传输后仍与服务器生成时完全一致。');
  }
  if (warnings.length > 0) {
    riskLines.unshift('当前报告仍包含警告项，生产发布前应逐项处理，或明确记录临时接受原因。');
  }
  if (backupInventory.verified && backupInventory.riskLevel !== 'low') {
    riskLines.unshift(`备份库存风险为 ${backupInventory.riskLevel}：${backupInventory.summary}。`);
  }

  return {
    schemaVersion: 1,
    tool: '3DPartHub 生产部署健康验收摘要',
    generatedAt,
    source: {
      input: path.resolve(input),
      kind: resolved.sourceKind,
      manifestVerified: resolved.manifestVerified,
      bundleId: resolved.manifest?.bundleId || null,
    },
    result: {
      status: report.result,
      completion: passedWithoutWarnings ? 'passed' : 'warning_accepted',
      passes: report.summary.passes,
      warnings: report.summary.warnings,
      failures: report.summary.failures,
    },
    productionEvidence: {
      requiredForFinalConclusion: true,
      mode: resolved.sourceKind,
      completeEvidenceProvided,
      reportOnlyFallback: !resolved.manifestVerified,
      archiveSidecarRequired: resolved.sourceKind === 'evidence-archive',
      archiveSidecarVerified: resolved.archiveSha256Verified,
      backupInventoryRequired: true,
      backupInventoryReady,
      backupInventoryRiskLevel: backupInventory.riskLevel,
      finalConclusionReady,
      finalConclusionBlockers,
    },
    reportGeneratedAt: report.generatedAt,
    context: report.context,
    requiredChecks: requiredCheckRows(report),
    backupInventory,
    warnings,
    failures,
    evidenceIntegrity: {
      manifestVerified: resolved.manifestVerified,
      envExcluded: resolved.manifestVerified,
      unsafePathsRejected: resolved.manifestVerified,
      symlinksRejected: resolved.manifestVerified,
      hashesVerified: resolved.manifestVerified,
      provenanceVerified: resolved.provenanceVerified,
      archiveSha256Verified: resolved.archiveSha256Verified,
      archiveSha256: resolved.archiveSha256,
    },
    narrative: {
      completion: completionLine,
      evidence: evidenceLine,
      remainingRisks: riskLines,
    },
  };
}

function writeAcceptanceSummary(file, model) {
  ensureParentDir(file);
  const backupRiskLabel = { high: '高', medium: '中', low: '低', unknown: '未知' }[model.backupInventory.riskLevel];
  const backupRestoreDrillLabel = model.backupInventory.restoreDrillExecuted
    ? `已执行${model.backupInventory.restoreDrillCheckedAt ? ` (${model.backupInventory.restoreDrillCheckedAt})` : ''}`
    : '未提供';
  const archiveShaStatus = (() => {
    if (model.source.kind === 'evidence-archive') {
      return model.evidenceIntegrity.archiveSha256Verified
        ? '已验证 .tar.gz.sha256'
        : '未提供 .tar.gz.sha256，已继续校验 manifest';
    }
    if (model.source.kind === 'evidence-directory') return '证据目录不适用';
    return '未验证完整证据包';
  })();

  const lines = [];
  lines.push('# 3DPartHub 生产部署健康验收摘要');
  lines.push('');
  lines.push(`生成时间: ${model.generatedAt}`);
  lines.push(`证据来源: ${markdownEscape(model.source.input)}`);
  lines.push(`证据类型: ${model.source.kind}`);
  if (model.source.bundleId) lines.push(`证据批次: ${markdownEscape(model.source.bundleId)}`);
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(model.narrative.completion);
  lines.push('');
  lines.push('| 项目 | 结果 |');
  lines.push('| --- | --- |');
  lines.push(`| 报告结果 | ${markdownEscape(model.result.status)} |`);
  lines.push(
    `| 生产证据闭环 | ${model.productionEvidence.finalConclusionReady ? '可作为最终生产结论' : '仍需完整生产证据'} |`,
  );
  lines.push(`| 生产验收模式 | ${markdownEscape(model.productionEvidence.mode)} |`);
  lines.push(`| 通过项 | ${model.result.passes} |`);
  lines.push(`| 警告项 | ${model.result.warnings} |`);
  lines.push(`| 失败项 | ${model.result.failures} |`);
  lines.push(`| 证据包完整性 | ${model.evidenceIntegrity.manifestVerified ? '已验证' : '未验证完整证据包'} |`);
  lines.push(`| 证据文件哈希 | ${model.evidenceIntegrity.hashesVerified ? '已验证' : '未验证完整证据包'} |`);
  lines.push(`| 归档 SHA-256 | ${archiveShaStatus} |`);
  lines.push(`| 版本/镜像追踪 | ${model.evidenceIntegrity.provenanceVerified ? '已验证' : '未验证'} |`);
  lines.push(`| 备份库存 | ${markdownEscape(model.backupInventory.summary)} |`);
  lines.push(`| 备份库存风险 | ${markdownEscape(backupRiskLabel || model.backupInventory.riskLevel)} |`);
  lines.push(`| 备份库存闭环 | ${model.productionEvidence.backupInventoryReady ? '已闭环' : '未闭环'} |`);
  lines.push(`| 备份恢复演练 | ${markdownEscape(backupRestoreDrillLabel)} |`);
  lines.push(
    `| .env/额外文件/路径/符号链接 | ${
      model.evidenceIntegrity.envExcluded &&
      model.evidenceIntegrity.unsafePathsRejected &&
      model.evidenceIntegrity.symlinksRejected
        ? '已拒绝危险内容'
        : '未验证完整证据包'
    } |`,
  );
  lines.push('');
  lines.push('## 环境快照');
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 报告生成时间 | ${markdownEscape(model.reportGeneratedAt)} |`);
  lines.push(`| 主机 | ${markdownEscape(model.context.host)} |`);
  lines.push(`| 系统 | ${markdownEscape(model.context.system)} |`);
  lines.push(`| 部署目录 | ${markdownEscape(model.context.directory)} |`);
  lines.push(`| Compose 文件 | ${markdownEscape(model.context.composeFile)} |`);
  lines.push(`| 环境文件 | ${markdownEscape(model.context.envFile)} |`);
  lines.push(`| Compose 类型 | ${markdownEscape(model.context.composeKind)} |`);
  lines.push(`| 端口 | ${markdownEscape(model.context.port)} |`);
  lines.push(`| 健康接口 | ${markdownEscape(model.context.healthUrl)} |`);
  if (model.backupInventory.verified) {
    lines.push(`| 备份目录 | ${markdownEscape(model.backupInventory.backupDir || 'unknown')} |`);
  }
  lines.push('');
  lines.push('## 必要检查');
  lines.push('');
  lines.push('| 检查 | 状态 |');
  lines.push('| --- | --- |');
  for (const row of model.requiredChecks) {
    lines.push(`| ${markdownEscape(row.name)} | ${row.status === 'pass' ? '通过' : '缺失'} |`);
  }
  lines.push('');
  lines.push('## 警告和失败');
  lines.push('');
  if (model.warnings.length === 0 && model.failures.length === 0) {
    lines.push('无警告项或失败项。');
  } else {
    for (const message of model.warnings) lines.push(`- 警告: ${message}`);
    for (const message of model.failures) lines.push(`- 失败: ${message}`);
  }
  lines.push('');
  lines.push('## 证据完整性');
  lines.push('');
  lines.push(model.narrative.evidence);
  if (model.evidenceIntegrity.archiveSha256?.present) {
    lines.push('');
    lines.push(`- 归档 SHA-256 摘要: \`${model.evidenceIntegrity.archiveSha256.actual}\``);
    lines.push(`- SHA-256 摘要文件: ${markdownEscape(model.evidenceIntegrity.archiveSha256.sidecar)}`);
  }
  if (model.backupInventory.nextActions?.length) {
    lines.push('');
    lines.push('## 备份库存建议');
    lines.push('');
    for (const action of model.backupInventory.nextActions) {
      lines.push(`- ${action}`);
    }
  }
  if (model.productionEvidence.finalConclusionBlockers?.length) {
    lines.push('');
    lines.push('## 生产闭环阻断项');
    lines.push('');
    for (const blocker of model.productionEvidence.finalConclusionBlockers) {
      lines.push(`- ${blocker}`);
    }
  }
  lines.push('');
  lines.push('## 剩余风险');
  lines.push('');
  for (const risk of model.narrative.remainingRisks) {
    lines.push(`- ${risk}`);
  }
  lines.push('');
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function writeAcceptanceJson(file, model) {
  ensureParentDir(file);
  fs.writeFileSync(file, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const options = {
    allowWarnings: false,
    maxAgeHours: null,
    requireText: '',
    requireFinalConclusion: false,
    summaryFile: '',
    summaryJsonFile: '',
  };
  let reportFile = '';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      usage();
      return;
    }
    if (arg === '--allow-warnings') {
      options.allowWarnings = true;
      continue;
    }
    if (arg === '--max-age-hours') {
      const raw = args[index + 1];
      index += 1;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) fail('--max-age-hours requires a positive number');
      options.maxAgeHours = value;
      continue;
    }
    if (arg === '--require-text') {
      options.requireText = args[index + 1] || '';
      index += 1;
      if (!options.requireText) fail('--require-text requires a file path');
      continue;
    }
    if (arg === '--require-final-conclusion') {
      options.requireFinalConclusion = true;
      continue;
    }
    if (arg === '--summary') {
      options.summaryFile = args[index + 1] || '';
      index += 1;
      if (!options.summaryFile) fail('--summary requires a file path');
      continue;
    }
    if (arg === '--summary-json') {
      options.summaryJsonFile = args[index + 1] || '';
      index += 1;
      if (!options.summaryJsonFile) fail('--summary-json requires a file path');
      continue;
    }
    if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    if (reportFile) fail(`Unexpected extra argument: ${arg}`);
    reportFile = arg;
  }

  if (!reportFile) {
    usage();
    process.exitCode = 2;
    return;
  }

  const resolved = resolveReportInput(reportFile, options);
  try {
    const report = readJson(resolved.reportFile);
    verifyReport(report, options);
    const textReport = options.requireText ? path.resolve(options.requireText) : resolved.textReport;
    if (textReport) verifyTextReport(textReport, report);
    if (resolved.manifestVerified) {
      verifyEvidenceSupportFiles(resolved.evidenceTexts, resolved.manifest, report);
      resolved.provenanceVerified = verifyProvenanceText(resolved.provenanceText, report);
    }
    if (options.summaryFile || options.summaryJsonFile) {
      const acceptanceModel = buildAcceptanceSummaryModel(reportFile, resolved, report);
      if (options.summaryFile) writeAcceptanceSummary(options.summaryFile, acceptanceModel);
      if (options.summaryJsonFile) writeAcceptanceJson(options.summaryJsonFile, acceptanceModel);
      if (options.requireFinalConclusion && !acceptanceModel.productionEvidence.finalConclusionReady) {
        fail(
          `Production evidence is not ready for a final production conclusion: ${acceptanceModel.productionEvidence.finalConclusionBlockers.join(
            ' ',
          )}`,
        );
      }
    } else if (options.requireFinalConclusion) {
      const acceptanceModel = buildAcceptanceSummaryModel(reportFile, resolved, report);
      if (!acceptanceModel.productionEvidence.finalConclusionReady) {
        fail(
          `Production evidence is not ready for a final production conclusion: ${acceptanceModel.productionEvidence.finalConclusionBlockers.join(
            ' ',
          )}`,
        );
      }
    }
    console.log(
      `Deploy health report verified: result=${report.result}, passes=${report.summary.passes}, warnings=${report.summary.warnings}, failures=${report.summary.failures}`,
    );
    if (options.summaryFile) console.log(`Deploy health acceptance summary written: ${options.summaryFile}`);
    if (options.summaryJsonFile)
      console.log(`Deploy health acceptance summary JSON written: ${options.summaryJsonFile}`);
  } finally {
    if (resolved.cleanupDir) fs.rmSync(resolved.cleanupDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
