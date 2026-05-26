#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SUMMARY = 'local-enterprise-acceptance.md';
const DEFAULT_SUMMARY_JSON = 'local-enterprise-acceptance.json';
const DEFAULT_DEPLOY_ACCEPTANCE_JSON = 'deploy-health-acceptance.json';

const PRETTIER_TARGETS = [
  'README.md',
  'deploy/README.md',
  'docs/README.md',
  'docs/运行环境规范.md',
  'docs/部署健康验收清单.md',
  'docs/企业级改进验收状态.md',
  'docs/代码维护规范.md',
  'scripts/verify-deploy-health-report.mjs',
  'scripts/verify-deploy-wiring.mjs',
  'scripts/verify-enterprise-acceptance.mjs',
  '.github/workflows/docker-build.yml',
  '.github/workflows/ci.yml',
  '.github/pull_request_template.md',
  'package.json',
];

function usage() {
  console.log(`3DPartHub enterprise local acceptance

Usage:
  node scripts/verify-enterprise-acceptance.mjs
  node scripts/verify-enterprise-acceptance.mjs --summary local-enterprise-acceptance.md --summary-json local-enterprise-acceptance.json

Options:
  --summary FILE       Write a Markdown local acceptance summary, default ${DEFAULT_SUMMARY}
  --summary-json FILE  Write a JSON local acceptance summary, default ${DEFAULT_SUMMARY_JSON}
  --no-summary         Do not write the Markdown summary.
  --no-summary-json    Do not write the JSON summary.
  -h, --help           Show this help.`);
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    summaryFile: DEFAULT_SUMMARY,
    summaryJsonFile: DEFAULT_SUMMARY_JSON,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--summary') {
      options.summaryFile = argv[index + 1] || '';
      index += 1;
      if (!options.summaryFile) fail('--summary requires a file path');
      continue;
    }
    if (arg === '--summary-json') {
      options.summaryJsonFile = argv[index + 1] || '';
      index += 1;
      if (!options.summaryJsonFile) fail('--summary-json requires a file path');
      continue;
    }
    if (arg === '--no-summary') {
      options.summaryFile = '';
      continue;
    }
    if (arg === '--no-summary-json') {
      options.summaryJsonFile = '';
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }
  return options;
}

function runText(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) return '';
  return (result.stdout || '').trim();
}

function stepFailureMessage(step) {
  if (!step) return 'Unknown enterprise acceptance failure';
  if (step.error) return `${step.label} failed: ${step.error}`;
  if (step.status === 'failed') return `${step.label} failed with exit code ${step.exitCode}`;
  return `${step.label} did not complete successfully`;
}

function createStepFailure(step) {
  const error = new Error(stepFailureMessage(step));
  error.step = step;
  return error;
}

function runStep(label, command, args, extraEnv = {}) {
  console.log(`\n==> ${label}`);
  const startedAt = new Date().toISOString();
  const envPrefix = Object.entries(extraEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const step = {
    label,
    command: `${envPrefix ? `${envPrefix} ` : ''}${[command, ...args].join(' ')}`,
    startedAt,
    finishedAt: '',
    status: 'running',
  };
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  step.finishedAt = new Date().toISOString();
  if (result.error) {
    step.status = 'failed';
    step.error = result.error.message;
    step.exitCode = null;
    return step;
  }
  if (result.status !== 0) {
    step.status = 'failed';
    step.exitCode = result.status;
    step.signal = result.signal || null;
    return step;
  }
  step.status = 'passed';
  step.exitCode = 0;
  return step;
}

function runRequiredStep(steps, label, command, args, extraEnv = {}) {
  const step = runStep(label, command, args, extraEnv);
  steps.push(step);
  if (step.status !== 'passed') throw createStepFailure(step);
  return step;
}

function ensureParentDir(file) {
  fs.mkdirSync(path.dirname(path.resolve(ROOT_DIR, file)), { recursive: true });
}

function gitInfo() {
  const dirtyResult = spawnSync('git', ['diff', '--quiet', '--ignore-submodules', '--'], { cwd: ROOT_DIR });
  return {
    commit: runText('git', ['rev-parse', 'HEAD']) || 'unavailable',
    branch: runText('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unavailable',
    dirty: dirtyResult.error ? 'unavailable' : dirtyResult.status === 0 ? 'false' : 'true',
  };
}

function relativePath(file) {
  if (!file) return '';
  return path.relative(ROOT_DIR, file) || path.basename(file);
}

function newestFile(pattern) {
  const candidates = fs
    .readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const file = path.join(ROOT_DIR, entry.name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0]?.file || '';
}

function readJsonIfPresent(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function productionEvidenceState() {
  const acceptanceJsonFile = path.join(ROOT_DIR, DEFAULT_DEPLOY_ACCEPTANCE_JSON);
  const acceptanceJson = readJsonIfPresent(acceptanceJsonFile);
  const latestArchive = newestFile(/^deploy-evidence-\d{8}-\d{6}\.tar\.gz$/);
  const latestFailedArchive = newestFile(/^deploy-evidence-failed-\d{8}-\d{6}\.tar\.gz$/);
  const latestArchiveSidecar = latestArchive ? `${latestArchive}.sha256` : '';
  const latestFailedArchiveSidecar = latestFailedArchive ? `${latestFailedArchive}.sha256` : '';
  const finalConclusionReady = acceptanceJson?.productionEvidence?.finalConclusionReady === true;
  const summaryExists = fs.existsSync(acceptanceJsonFile);
  const summaryReadable = Boolean(acceptanceJson);

  const status = finalConclusionReady
    ? 'complete'
    : summaryExists && !summaryReadable
      ? 'invalid_acceptance_summary'
      : summaryReadable
        ? 'incomplete_acceptance_summary'
        : latestArchive
          ? 'evidence_collected_without_acceptance'
          : latestFailedArchive
            ? 'failed_evidence_collected'
            : 'missing';
  const nextAction =
    status === 'complete'
      ? '生产验收摘要已标记 finalConclusionReady=true；生产重启、升级或恢复后仍需重新采集。'
      : status === 'invalid_acceptance_summary'
        ? `重新生成 ${DEFAULT_DEPLOY_ACCEPTANCE_JSON}，当前文件无法解析为有效 JSON。`
        : status === 'incomplete_acceptance_summary'
          ? '重新回传完整生产证据包和同名 .sha256，并执行 npm run deploy:acceptance。'
          : status === 'evidence_collected_without_acceptance'
            ? '已发现证据包，请确认同名 .sha256 存在后执行 npm run deploy:acceptance。'
            : status === 'failed_evidence_collected'
              ? '已发现失败证据包，请先按自检报告修复生产部署，再重新采集证据。'
              : '在生产服务器执行 sh scripts/collect-deploy-evidence.sh，并回传 deploy-evidence-*.tar.gz 与同名 .sha256。';

  return {
    required: true,
    status,
    finalConclusionReady,
    acceptanceSummary: {
      path: DEFAULT_DEPLOY_ACCEPTANCE_JSON,
      exists: summaryExists,
      readable: summaryReadable,
      result: acceptanceJson?.result?.status || '',
      bundleId: acceptanceJson?.source?.bundleId || null,
      generatedAt: acceptanceJson?.generatedAt || '',
    },
    latestEvidenceArchive: {
      path: relativePath(latestArchive),
      sidecarPath: relativePath(latestArchiveSidecar),
      sidecarExists: Boolean(latestArchiveSidecar && fs.existsSync(latestArchiveSidecar)),
    },
    latestFailedEvidenceArchive: {
      path: relativePath(latestFailedArchive),
      sidecarPath: relativePath(latestFailedArchiveSidecar),
      sidecarExists: Boolean(latestFailedArchiveSidecar && fs.existsSync(latestFailedArchiveSidecar)),
    },
    nextAction,
  };
}

function buildSummary(steps, options, result = 'passed', failure = null) {
  const productionEvidence = productionEvidenceState();
  const remainingRisks = [
    '本地验收只证明代码、构建、部署工具回归和服务端单测通过，不能替代真实生产服务器证据包。',
    '生产重启、升级、恢复备份、修改 .env、调整反代或迁移数据后需要重新采集生产证据。',
  ];
  if (result !== 'passed') {
    remainingRisks.unshift('本地企业级验收未通过，不能使用本次摘要作为发布前通过证据。');
  }
  if (!productionEvidence.finalConclusionReady) {
    remainingRisks.splice(1, 0, '生产部署健康结论仍必须基于 deploy-evidence-*.tar.gz 运行 npm run deploy:acceptance。');
  }
  const failedStep = failure?.step || steps.find((step) => step.status !== 'passed') || null;
  return {
    schemaVersion: 1,
    tool: '3DPartHub 企业级本地验收摘要',
    generatedAt: new Date().toISOString(),
    result,
    failure: failure
      ? {
          message: failure.message,
          failedStep: failedStep?.label || '',
        }
      : null,
    failedStep,
    productionEvidenceRequired: true,
    productionEvidence,
    environment: {
      node: runText('node', ['--version']) || 'unavailable',
      npm: runText('npm', ['--version']) || 'unavailable',
      git: gitInfo(),
    },
    steps,
    artifacts: {
      markdown: options.summaryFile || '',
      json: options.summaryJsonFile || '',
    },
    remainingRisks,
  };
}

function writeMarkdown(file, summary) {
  ensureParentDir(file);
  const lines = [];
  lines.push('# 3DPartHub 企业级本地验收摘要');
  lines.push('');
  lines.push(`生成时间: ${summary.generatedAt}`);
  lines.push(`结论: ${summary.result}`);
  if (summary.failure) {
    lines.push(`失败原因: ${summary.failure.message}`);
  }
  lines.push('');
  lines.push('## 环境');
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| Node | ${summary.environment.node} |`);
  lines.push(`| npm | ${summary.environment.npm} |`);
  lines.push(`| Git commit | ${summary.environment.git.commit} |`);
  lines.push(`| Git branch | ${summary.environment.git.branch} |`);
  lines.push(`| Git dirty | ${summary.environment.git.dirty} |`);
  lines.push('');
  lines.push('## 生产证据闭环状态');
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 状态 | ${summary.productionEvidence.status} |`);
  lines.push(`| finalConclusionReady | ${summary.productionEvidence.finalConclusionReady ? 'true' : 'false'} |`);
  lines.push(
    `| 验收摘要 | ${summary.productionEvidence.acceptanceSummary.exists ? summary.productionEvidence.acceptanceSummary.path : '未发现'} |`,
  );
  lines.push(`| 验收摘要可读 | ${summary.productionEvidence.acceptanceSummary.readable ? 'true' : 'false'} |`);
  lines.push(`| 证据批次 | ${summary.productionEvidence.acceptanceSummary.bundleId || ''} |`);
  lines.push(`| 最新证据包 | ${summary.productionEvidence.latestEvidenceArchive.path || '未发现'} |`);
  lines.push(
    `| 最新证据包摘要 | ${summary.productionEvidence.latestEvidenceArchive.sidecarExists ? summary.productionEvidence.latestEvidenceArchive.sidecarPath : '未发现'} |`,
  );
  lines.push(`| 失败证据包 | ${summary.productionEvidence.latestFailedEvidenceArchive.path || '未发现'} |`);
  lines.push(`| 下一步 | ${summary.productionEvidence.nextAction} |`);
  lines.push('');
  lines.push('## 已执行检查');
  lines.push('');
  lines.push('| 检查 | 命令 | 状态 |');
  lines.push('| --- | --- | --- |');
  for (const step of summary.steps) {
    const status =
      step.status === 'failed' ? `${step.status} (${step.exitCode ?? step.error ?? 'unknown'})` : step.status;
    lines.push(`| ${step.label} | \`${step.command}\` | ${status} |`);
  }
  lines.push('');
  lines.push('## 剩余风险');
  lines.push('');
  for (const risk of summary.remainingRisks) {
    lines.push(`- ${risk}`);
  }
  lines.push('');
  fs.writeFileSync(path.resolve(ROOT_DIR, file), `${lines.join('\n')}\n`, 'utf8');
}

function writeJson(file, summary) {
  ensureParentDir(file);
  fs.writeFileSync(path.resolve(ROOT_DIR, file), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const steps = [];
  try {
    runRequiredStep(steps, 'Prettier format check', 'npx', ['prettier', '--check', ...PRETTIER_TARGETS]);
    runRequiredStep(steps, 'Local verification with server tests', 'npm', ['run', 'verify:local'], {
      RUN_SERVER_TESTS: '1',
    });
    runRequiredStep(steps, 'Git whitespace check', 'git', ['diff', '--check']);
  } catch (err) {
    const failure = err instanceof Error ? err : new Error(String(err));
    const summary = buildSummary(steps, options, 'failed', failure);
    if (options.summaryFile) writeMarkdown(options.summaryFile, summary);
    if (options.summaryJsonFile) writeJson(options.summaryJsonFile, summary);
    if (options.summaryFile)
      console.error(`\nEnterprise local acceptance failure summary written: ${options.summaryFile}`);
    if (options.summaryJsonFile)
      console.error(`Enterprise local acceptance failure JSON written: ${options.summaryJsonFile}`);
    throw failure;
  }

  const summary = buildSummary(steps, options, 'passed');
  if (options.summaryFile) writeMarkdown(options.summaryFile, summary);
  if (options.summaryJsonFile) writeJson(options.summaryJsonFile, summary);
  if (options.summaryFile) console.log(`\nEnterprise local acceptance summary written: ${options.summaryFile}`);
  if (options.summaryJsonFile) console.log(`Enterprise local acceptance JSON written: ${options.summaryJsonFile}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
