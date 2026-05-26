#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function fail(message) {
  throw new Error(message);
}

function assertIncludes(file, needle, reason) {
  const body = readText(file);
  if (!body.includes(needle)) {
    fail(`${file} is missing ${JSON.stringify(needle)}${reason ? ` (${reason})` : ''}`);
  }
}

function assertScript(name, expected) {
  const scripts = readJson('package.json').scripts || {};
  if (scripts[name] !== expected) {
    fail(`package.json script ${name} must be ${JSON.stringify(expected)}, got ${JSON.stringify(scripts[name])}`);
  }
}

function verifyPackageScripts() {
  assertScript('backup:e2e', 'npm --prefix server run backup:e2e:dev');
  assertScript('deploy:check', 'sh scripts/deploy-health-check.sh');
  assertScript('deploy:evidence', 'sh scripts/collect-deploy-evidence.sh');
  assertScript('deploy:report:verify', 'node scripts/verify-deploy-health-report.mjs');
  assertScript('deploy:acceptance', 'sh scripts/verify-production-deploy-evidence.sh');
  assertScript('deploy:check:test', 'sh scripts/test-deploy-health-check.sh');
  assertScript('deploy:wiring:verify', 'node scripts/verify-deploy-wiring.mjs');
  assertScript('verify:deploy', 'sh scripts/verify-deploy-tools.sh');
  assertScript('verify:enterprise', 'node scripts/verify-enterprise-acceptance.mjs');
  assertScript('verify:local', 'bash scripts/verify-local.sh');
  const serverScripts = readJson('server/package.json').scripts || {};
  if (serverScripts['backup:e2e'] !== 'node dist/scripts/backup-e2e-check.js') {
    fail(
      `server/package.json script backup:e2e must be "node dist/scripts/backup-e2e-check.js", got ${JSON.stringify(
        serverScripts['backup:e2e'],
      )}`,
    );
  }
  if (serverScripts['backup:e2e:dev'] !== 'tsx src/scripts/backup-e2e-check.ts') {
    fail(
      `server/package.json script backup:e2e:dev must be "tsx src/scripts/backup-e2e-check.ts", got ${JSON.stringify(
        serverScripts['backup:e2e:dev'],
      )}`,
    );
  }
}

function verifyDeployVerifierWiring() {
  const verifier = readText('scripts/verify-deploy-tools.sh');
  const required = [
    'bash -n install.sh',
    'bash -n deploy.sh',
    'sh -n scripts/deploy-health-check.sh',
    'sh -n scripts/collect-deploy-evidence.sh',
    'sh -n scripts/verify-production-deploy-evidence.sh',
    'node --check scripts/verify-deploy-health-report.mjs',
    'node --check scripts/verify-deploy-wiring.mjs',
    'node --check scripts/verify-enterprise-acceptance.mjs',
    'npm run deploy:check -- --help',
    'npm run deploy:evidence -- --help',
    'npm run deploy:report:verify -- --help',
    'npm run deploy:acceptance -- --help',
    'npm run verify:enterprise -- --help',
    'Enterprise acceptance failure summary',
    'verify-deploy-wiring.mjs',
    'npm run deploy:check:test',
  ];
  for (const needle of required) {
    if (!verifier.includes(needle)) fail(`scripts/verify-deploy-tools.sh does not verify: ${needle}`);
  }
}

function verifyDeployScriptEvidenceWiring() {
  assertIncludes('deploy.sh', 'collect-deploy-evidence.sh', 'deploy script must collect failed deployment evidence');
  assertIncludes(
    'deploy.sh',
    '服务启动失败。${NC}"\n  print_diagnostics\n  collect_deploy_evidence_after_failure',
    'deploy script must collect evidence when docker compose up fails',
  );
  assertIncludes(
    'deploy.sh',
    '健康检查未通过。${NC}"\n  print_diagnostics\n  collect_deploy_evidence_after_failure',
    'deploy script must collect evidence when initial health check fails',
  );
  assertIncludes('deploy.sh', '证据摘要:', 'deploy failure output must show SHA-256 sidecar path');
  assertIncludes(
    'deploy.sh',
    '证据包和同名 .sha256',
    'deploy failure output must ask users to return archive and sidecar together',
  );
  assertIncludes(
    'deploy.sh',
    'deploy-evidence-*.tar.gz.sha256',
    'deploy success instructions must mention evidence sidecar',
  );
}

function verifyProductionAcceptanceWiring() {
  assertIncludes(
    'scripts/verify-production-deploy-evidence.sh',
    '--require-final-conclusion',
    'production acceptance must enforce final conclusion readiness by default',
  );
  assertIncludes(
    'scripts/verify-production-deploy-evidence.sh',
    'productionEvidence.finalConclusionReady=true',
    'production acceptance help must explain final conclusion readiness',
  );
}

function verifyEnterpriseAcceptanceWiring() {
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'productionEvidenceState',
    'enterprise acceptance summary must scan production evidence closure state',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'DEFAULT_DEPLOY_ACCEPTANCE_JSON',
    'enterprise acceptance summary must look for production acceptance JSON',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'finalConclusionReady',
    'enterprise acceptance summary must expose final conclusion readiness',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    '生产证据闭环状态',
    'enterprise acceptance Markdown must show production evidence closure state',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'productionEvidenceRequired',
    'enterprise acceptance JSON must mark production evidence as required',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'runRequiredStep',
    'enterprise acceptance must stop on the first failed required gate',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    "buildSummary(steps, options, 'failed'",
    'enterprise acceptance must overwrite stale passed summaries with failed summaries',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    '本地企业级验收未通过',
    'enterprise acceptance failure summary must warn that the run is not release evidence',
  );
  assertIncludes(
    'scripts/verify-enterprise-acceptance.mjs',
    'failedStep',
    'enterprise acceptance JSON must capture the failed step',
  );
}

function verifyLocalVerificationWiring() {
  assertIncludes(
    'scripts/verify-local.sh',
    'npm run backup:e2e -- --help',
    'local verification must smoke-test the production backup restore drill entrypoint after server build',
  );
}

function verifyDeployHealthSecurityHeaderWiring() {
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_security_headers',
    'deploy health check must verify API/Web security response headers',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'security headers warning report',
    'deploy health tests must cover missing security response headers',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'API 安全响应头正常',
    'deploy report verifier must require API security response header checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Web 首页安全响应头正常',
    'deploy report verifier must require Web homepage security response header checks',
  );
}

function verifyDeployHealthSecurityConfigWiring() {
  for (const needle of [
    '数据库密码 DB_PASSWORD',
    'Redis 密码 REDIS_PASSWORD',
    'JWT_SECRET',
    'ADMIN_PASS',
    'ALLOWED_ORIGINS',
    'Compose API 关键环境已声明',
  ]) {
    assertIncludes(
      'scripts/verify-deploy-health-report.mjs',
      needle,
      'deploy report verifier must require core production secret and origin checks',
    );
  }
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'Missing required passing check: ALLOWED_ORIGINS',
    'deploy health tests must reject reports missing core origin checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_duplicate_service_keys',
    'deploy health check must reject duplicate Compose service keys',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose 服务键未重复',
    'deploy report verifier must require duplicate Compose key checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose duplicate key failure report',
    'deploy health tests must cover duplicate Compose service keys',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_api_environment',
    'deploy health check must verify Compose api.environment declarations',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_image_sources',
    'deploy health check must verify Compose image sources',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose 镜像来源正常',
    'deploy report verifier must require Compose image source checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_runtime_image_sources',
    'deploy health check must verify runtime API/Web image sources',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '运行镜像来源正常',
    'deploy report verifier must require runtime API/Web image source checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose api env failure report',
    'deploy health tests must cover missing Compose API environment declarations',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose image source failure report',
    'deploy health tests must cover wrong Compose image sources',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime image source failure report',
    'deploy health tests must cover wrong runtime API/Web image sources',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_resource_controls',
    'deploy health check must verify Compose resource controls',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_api_stop_grace_period',
    'deploy health check must verify Compose API stop grace period',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_runtime_api_stop_timeout',
    'deploy health check must verify runtime API stop timeout',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_internal_network',
    'deploy health check must verify Compose internal network bindings',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_compose_private_service_ports',
    'deploy health check must reject private service host port exposure in Compose',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose 资源限制已声明',
    'deploy report verifier must require Compose resource control checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose API 停止宽限期正常',
    'deploy report verifier must require Compose API stop grace checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '运行 API 停止宽限期正常',
    'deploy report verifier must require runtime API stop timeout checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose 内部网络正常',
    'deploy report verifier must require Compose internal network checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose 端口暴露正常',
    'deploy report verifier must require Compose private port exposure checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_runtime_container_resource_limits',
    'deploy health check must verify runtime container resource limits',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_docker_data_root',
    'deploy health check must verify Docker data-root disk and inode state',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '容器资源限制正常',
    'deploy report verifier must require runtime container resource limit checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Docker 数据目录磁盘空间正常',
    'deploy report verifier must require Docker data-root disk checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Docker 数据目录 inode 正常',
    'deploy report verifier must require Docker data-root inode checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose resource controls failure report',
    'deploy health tests must cover missing Compose resource controls',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose api stop grace failure report',
    'deploy health tests must cover missing Compose API stop grace period',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime api stop timeout failure report',
    'deploy health tests must cover short runtime API stop timeout',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose internal network failure report',
    'deploy health tests must cover missing Compose internal network bindings',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose private port exposure failure report',
    'deploy health tests must cover private service port exposure in Compose',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime resource limits failure report',
    'deploy health tests must cover missing runtime container resource limits',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime resource limits mismatch report',
    'deploy health tests must cover runtime container resource limit mismatches',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'docker data root disk failure report',
    'deploy health tests must cover Docker data-root disk failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'ALLOWED_ORIGINS',
    'deployment checklist must document production origin checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose API 关键环境',
    'deployment checklist must document Compose API environment checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 服务键',
    'deployment checklist must document duplicate Compose service key checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 镜像来源',
    'deployment checklist must document Compose image source checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '运行镜像来源',
    'deployment checklist must document runtime image source checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 资源限制',
    'deployment checklist must document Compose resource control checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '停止宽限期',
    'deployment checklist must document API stop grace and stop timeout checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 内部网络',
    'deployment checklist must document Compose internal network checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 端口暴露',
    'deployment checklist must document Compose private port exposure checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '容器资源限制',
    'deployment checklist must document runtime container resource limit checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Docker 数据目录',
    'deployment checklist must document Docker data-root disk and inode checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_api_data_volume_capacity',
    'deploy health check must verify API data volume disk and inode capacity',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_backup_restore_drill_evidence',
    'deploy health check must surface backup restore drill evidence state',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'API 数据卷容量正常',
    'deploy report verifier must require API data volume capacity checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_api_process_user',
    'deploy health check must verify the API main process user',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'API 主进程非 root 运行',
    'deploy report verifier must require API main process non-root checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'api process root failure report',
    'deploy health tests must cover API main process root failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'API 主进程',
    'deployment checklist must document API main process user checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API 主进程',
    'enterprise status must document API main process user checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'api data volume capacity failure report',
    'deploy health tests must cover API data volume capacity failures',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'restore drill missing warning report',
    'deploy health tests must cover missing backup restore drill evidence warnings',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'API 数据卷容量',
    'deployment checklist must document API data volume disk and inode checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '备份恢复演练证据缺失',
    'deployment checklist must document missing backup restore drill evidence warnings',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '数据库密码 DB_PASSWORD',
    'deployment checklist must document database password checks',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_prisma_migration_status',
    'deploy health check must verify Prisma migration status',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '数据库迁移状态正常',
    'deploy report verifier must require Prisma migration status checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'prisma migration failure report',
    'deploy health tests must cover Prisma migration status failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '数据库迁移状态',
    'deployment checklist must document Prisma migration status checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'ALLOWED_ORIGINS',
    'enterprise status must document production origin checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API 数据卷容量',
    'enterprise status must document API data volume capacity checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '备份恢复演练证据',
    'enterprise status must document backup restore drill evidence health checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '数据库迁移状态',
    'enterprise status must document Prisma migration status checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose API 关键环境',
    'enterprise status must document Compose API environment declaration checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 服务键',
    'enterprise status must document duplicate Compose service key checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 镜像来源',
    'enterprise status must document Compose image source checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '运行镜像来源',
    'enterprise status must document runtime image source checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 资源限制',
    'enterprise status must document Compose resource control checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '停止宽限期',
    'enterprise status must document API stop grace and stop timeout checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 内部网络',
    'enterprise status must document Compose internal network checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 端口暴露',
    'enterprise status must document Compose private port exposure checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '容器资源限制',
    'enterprise status must document runtime container resource limit checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Docker 数据目录',
    'enterprise status must document Docker data-root disk and inode checks',
  );
}

function verifyDeployHealthEndpointWiring() {
  assertIncludes(
    'scripts/deploy-health-check.sh',
    '/api/health/live',
    'deploy health check must verify API liveness endpoint',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '存活接口正常',
    'deploy report verifier must require API liveness checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'live endpoint failure report',
    'deploy health tests must cover API liveness failures',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_runtime_version_endpoint',
    'deploy health check must verify the runtime version endpoint',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_admin_health_endpoint_access_control',
    'deploy health check must verify admin health endpoint access control',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '运行版本可读取',
    'deploy report verifier must require runtime version endpoint checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '管理健康接口访问控制正常',
    'deploy report verifier must require admin health access control checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime version failure report',
    'deploy health tests must cover runtime version endpoint failures',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'admin health access failure report',
    'deploy health tests must cover public admin health endpoint failures',
  );
  assertIncludes('docs/部署健康验收清单.md', '存活接口', 'deployment checklist must document liveness checks');
  assertIncludes('docs/部署健康验收清单.md', '运行版本', 'deployment checklist must document runtime version checks');
  assertIncludes(
    'docs/部署健康验收清单.md',
    '管理健康接口',
    'deployment checklist must document admin health access control checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '/api/health/live',
    'enterprise status must document liveness endpoint coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '/api/settings/version',
    'enterprise status must document runtime version endpoint coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '/api/health/deep',
    'enterprise status must document admin health endpoint access control coverage',
  );
}

function verifyDeployHealthPortWiring() {
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_port_listener',
    'deploy health check must verify host port listener state',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_runtime_private_port_bindings',
    'deploy health check must reject runtime private service host port exposure',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    'check_sensitive_web_paths',
    'deploy health check must verify sensitive backup/upload paths are not directly exposed',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    '/_protected_static/',
    'deploy health check must verify protected static X-Accel paths are not directly exposed',
  );
  assertIncludes(
    'scripts/deploy-health-check.sh',
    '/_protected_uploads/',
    'deploy health check must verify protected uploads X-Accel paths are not directly exposed',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '宿主机端口',
    'deploy report verifier must require host port listener checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Web 容器端口映射正常',
    'deploy report verifier must require Web container port binding checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '运行容器端口暴露正常',
    'deploy report verifier must require runtime private port exposure checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Web 敏感路径未暴露',
    'deploy report verifier must require sensitive web path exposure checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Compose Web 端口映射正常',
    'deploy report verifier must require Compose Web port mapping checks',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'API CORS 允许来源',
    'deploy report verifier must require runtime API CORS origin consistency checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'port listener warning report',
    'deploy health tests must cover host port listener warnings',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'web port binding failure report',
    'deploy health tests must cover Web container port binding failures',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'runtime private port exposure failure report',
    'deploy health tests must cover runtime private service port exposure',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'sensitive web path exposure failure report',
    'deploy health tests must cover sensitive backup/upload path exposure',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    '/_protected_static/',
    'deploy health tests must cover protected static X-Accel exposure failures',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    '/_protected_uploads/',
    'deploy health tests must cover protected uploads X-Accel exposure failures',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'compose web port failure report',
    'deploy health tests must cover Compose Web port mapping failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '宿主机端口监听',
    'deployment checklist must require host port listener checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Web 容器端口映射',
    'deployment checklist must require Web container port binding checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '运行容器端口暴露',
    'deployment checklist must require runtime private service port exposure checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Web 敏感路径',
    'deployment checklist must require sensitive backup/upload path exposure checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'X-Accel',
    'deployment checklist must document protected X-Accel path exposure checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose Web 端口映射',
    'deployment checklist must require Compose Web port mapping checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '端口 3780 当前有 nginx 监听',
    'deployment checklist must explain nginx/BT port listener conflicts',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '宝塔/nginx 占用',
    'enterprise status must document nginx/BT port listener risk coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Web 容器端口映射异常',
    'enterprise status must document Web container port binding risk coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '运行容器端口暴露异常',
    'enterprise status must document runtime private service port exposure coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Web 敏感路径',
    'enterprise status must document sensitive backup/upload path exposure coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'X-Accel',
    'enterprise status must document protected X-Accel path exposure coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose Web 端口映射异常',
    'enterprise status must document Compose Web port mapping risk coverage',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API CORS 允许来源',
    'enterprise status must document runtime API CORS origin consistency coverage',
  );
}

function verifyDeployHealthLogWiring() {
  assertIncludes('scripts/deploy-health-check.sh', 'scan_web_logs', 'deploy health check must scan Web container logs');
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'Web 最近日志未发现常见错误',
    'deploy report verifier must require Web log scan checks',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'web log error report',
    'deploy health tests must cover Web log failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'API/Web 日志扫描',
    'deployment checklist must require API/Web log scan checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API/Web 最近日志',
    'enterprise status must document API/Web log scan coverage',
  );
}

function verifyCiWiring() {
  assertIncludes('.github/workflows/ci.yml', 'npm run verify:deploy', 'CI must run deployment tooling regression');
  assertIncludes(
    '.github/workflows/docker-build.yml',
    'npm run verify:deploy',
    'Docker image release must run deployment tooling regression',
  );
  assertIncludes(
    '.github/workflows/docker-build.yml',
    'deploy-tools-verify',
    'Docker image release must keep a named deployment verification job',
  );
}

function verifyEvidenceIgnored() {
  const gitignore = readText('.gitignore');
  for (const pattern of [
    'deploy-evidence-*/',
    'deploy-evidence-failed-*/',
    'deploy-evidence-*.sha256',
    'deploy-evidence-failed-*.sha256',
    'deploy-health-report.txt',
    'deploy-health-report.json',
    'deploy-health-acceptance.md',
    'deploy-health-acceptance.json',
    'local-enterprise-acceptance.md',
    'local-enterprise-acceptance.json',
  ]) {
    if (!gitignore.includes(pattern)) fail(`.gitignore must ignore deployment evidence pattern: ${pattern}`);
  }
}

function serviceBlock(composeText, service) {
  const lines = composeText.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) fail(`docker-compose.yml must declare service ${service}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [^ ].*:/.test(line)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function countServiceKey(block, key) {
  return block.split(/\r?\n/).filter((line) => line === `    ${key}:`).length;
}

function verifyProductionComposePolicies() {
  const compose = readText('docker-compose.yml');
  if (!compose.includes('x-logging:') || !compose.includes('max-size') || !compose.includes('max-file')) {
    fail('docker-compose.yml must define default logging rotation with max-size and max-file');
  }
  if (!compose.includes('\nnetworks:\n  internal:')) {
    fail('docker-compose.yml must declare top-level networks.internal');
  }
  for (const service of ['api', 'web', 'postgres', 'redis']) {
    const block = serviceBlock(compose, service);
    if (!block.includes('healthcheck:')) {
      fail(`docker-compose.yml service ${service} must declare healthcheck`);
    }
    if (!block.includes('restart: unless-stopped')) {
      fail(`docker-compose.yml service ${service} must set restart: unless-stopped`);
    }
    if (!block.includes('logging:')) {
      fail(`docker-compose.yml service ${service} must set logging rotation`);
    }
    if (!block.includes('mem_limit:') || !block.includes('cpus:')) {
      fail(`docker-compose.yml service ${service} must set mem_limit and cpus`);
    }
    if (!block.includes('networks:') || !block.includes('internal')) {
      fail(`docker-compose.yml service ${service} must bind to the internal network`);
    }
    if (service === 'web') {
      if (!block.includes('ports:')) {
        fail('docker-compose.yml service web must publish the configured web port');
      }
    } else if (block.includes('\n    ports:')) {
      fail(`docker-compose.yml service ${service} must not publish host ports`);
    }
    for (const key of [
      'image',
      'container_name',
      'mem_limit',
      'cpus',
      'deploy',
      'environment',
      'depends_on',
      'volumes',
      'healthcheck',
      'restart',
      'logging',
      'networks',
      'ports',
      'command',
    ]) {
      const count = countServiceKey(block, key);
      if (count > 1) {
        fail(`docker-compose.yml service ${service} contains duplicate key ${key}`);
      }
    }
  }

  const mountChecks = [
    ['api', 'uploads-data:/app/uploads'],
    ['api', 'static-data:/app/static'],
    ['api', './server/static/backups:/app/static/backups'],
    ['web', 'static-data:/app/static:ro'],
    ['web', 'uploads-data:/app/uploads:ro'],
    ['postgres', 'pgdata:/var/lib/postgresql/data'],
    ['redis', 'redis-data:/data'],
  ];
  for (const [service, mount] of mountChecks) {
    const block = serviceBlock(compose, service);
    if (!block.includes(mount)) {
      fail(`docker-compose.yml service ${service} must keep persistent mount ${mount}`);
    }
  }
  const apiBlock = serviceBlock(compose, 'api');
  if (!apiBlock.includes('ghcr.io/liaoweixiang2024-blip/3dparthub-api:${IMAGE_TAG:-latest}')) {
    fail('docker-compose.yml service api must use the 3dparthub-api image with IMAGE_TAG fallback');
  }
  const webBlock = serviceBlock(compose, 'web');
  if (!webBlock.includes('ghcr.io/liaoweixiang2024-blip/3dparthub-web:${IMAGE_TAG:-latest}')) {
    fail('docker-compose.yml service web must use the 3dparthub-web image with IMAGE_TAG fallback');
  }
  for (const envName of [
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'BACKUP_SIGNING_SECRET',
    'BACKUP_ENCRYPTION_SECRET',
    'ALLOWED_ORIGINS',
  ]) {
    if (!apiBlock.includes(`${envName}:`)) {
      fail(`docker-compose.yml service api must pass ${envName} into the container`);
    }
  }
  const redisBlock = serviceBlock(compose, 'redis');
  for (const needle of ['REDISCLI_AUTH=', 'redis-cli ping']) {
    if (!redisBlock.includes(needle)) {
      fail(`docker-compose.yml service redis healthcheck must use authenticated redis-cli ping (${needle})`);
    }
  }
  for (const volume of ['pgdata:', 'uploads-data:', 'static-data:', 'redis-data:']) {
    if (!compose.includes(`\n  ${volume}`)) {
      fail(`docker-compose.yml must declare named volume ${volume}`);
    }
  }
}

function verifyWebNginxSensitivePathPolicy() {
  assertIncludes(
    'client/nginx.conf',
    'static/(backups|_backup_db|_safety_snapshots|html-previews|originals|ticket-attachments|inquiry-attachments|drawings|batch|\\.restore_[^/]*)',
    'web nginx config must block sensitive static subdirectories',
  );
  assertIncludes('client/nginx.conf', 'location /uploads/', 'web nginx config must declare uploads location');
  assertIncludes('client/nginx.conf', 'return 404;', 'web nginx config must deny direct sensitive file access');
  assertIncludes(
    'client/nginx.conf',
    'location /_protected_uploads/',
    'web nginx config must keep uploads behind protected X-Accel redirects',
  );
  assertIncludes(
    'client/nginx.conf',
    'location /_protected_static/',
    'web nginx config must keep protected static files behind X-Accel redirects',
  );
}

function verifyDocs() {
  const docs = ['README.md', 'deploy/README.md', 'docs/运行环境规范.md', 'docs/部署健康验收清单.md'];
  const required = [
    'deploy-health-check.sh',
    'collect-deploy-evidence.sh',
    'npm run verify:deploy',
    'npm run deploy:acceptance',
    'deploy-health-acceptance.json',
    '版本/镜像追踪',
    '.tar.gz.sha256',
  ];
  for (const file of docs) {
    for (const needle of required) {
      assertIncludes(file, needle, 'deployment health acceptance docs must stay complete');
    }
  }
  assertIncludes('docs/部署健康验收清单.md', '真实生产服务器', 'acceptance must require real production evidence');
  assertIncludes(
    'docs/部署健康验收清单.md',
    '企业级改进验收状态',
    'deployment checklist must link to enterprise status',
  );
  assertIncludes('docs/部署健康验收清单.md', '--allow-report-only', 'report-only fallback must be explicit');
  assertIncludes(
    'docs/部署健康验收清单.md',
    '--require-text deploy-health-report.txt',
    'report-only fallback must require text report',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '--allow-missing-sidecar',
    'missing archive sidecar fallback must be explicit',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'does not reference archive name',
    'deployment checklist must document archive sidecar filename binding failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '摘要文件名必须指向当前 `.tar.gz`',
    'deployment checklist must document archive sidecar filename binding',
  );
  assertIncludes('docs/部署健康验收清单.md', '当前剩余风险', 'remaining risks must be documented');
  assertIncludes(
    'docs/部署健康验收清单.md',
    'productionEvidence.finalConclusionReady=true',
    'deployment checklist must document final conclusion exit-code gate',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '固定白名单文件',
    'deployment checklist must document evidence file allowlist',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '不能只是空壳文件',
    'deployment checklist must document support evidence shape checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '证据批次 ID',
    'deployment checklist must document evidence bundle ID checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'deploy-health-report.json',
    'deployment checklist must include health report in bundle ID checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'imageId=sha256:',
    'deployment checklist must document container image ID checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '未配置 healthcheck',
    'deployment checklist must document missing healthcheck warnings',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'restart: unless-stopped',
    'deployment checklist must document restart policy checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '重启策略',
    'deployment checklist must document runtime restart policy checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'restartPolicy=',
    'deployment checklist must document provenance restart policy evidence',
  );
  assertIncludes('docs/部署健康验收清单.md', '日志轮转', 'deployment checklist must document log rotation checks');
  assertIncludes(
    'docs/部署健康验收清单.md',
    'max-size',
    'deployment checklist must document log rotation max-size checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'max-file',
    'deployment checklist must document log rotation max-file checks',
  );
  assertIncludes('docs/部署健康验收清单.md', 'OOMKilled', 'deployment checklist must document OOMKilled checks');
  assertIncludes(
    'docs/部署健康验收清单.md',
    'restartCount=',
    'deployment checklist must document restartCount evidence',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '环境文件权限过宽',
    'deployment checklist must document env file permission warnings',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '运行镜像标签与 IMAGE_TAG 不一致',
    'deployment checklist must document image tag mismatch warnings',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Compose 持久化挂载',
    'deployment checklist must document persistent mount checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'REDISCLI_AUTH',
    'deployment checklist must document authenticated Redis healthcheck',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '资源配置超过当前内存档位',
    'deployment checklist must document resource budget failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '位于 pass 信息开头',
    'deployment checklist must document required check anti-forgery rules',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'TXT 中的 Compose 文件',
    'deployment checklist must document JSON/TXT report binding',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'API/Web 日志',
    'deployment checklist must document API and web log evidence',
  );
  assertIncludes('docs/部署健康验收清单.md', '宿主机资源', 'deployment checklist must document host resource evidence');
  assertIncludes(
    'docs/部署健康验收清单.md',
    '网络监听',
    'deployment checklist must document network listener evidence',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '备份库存',
    'deployment checklist must document backup inventory evidence',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'backupInventory',
    'deployment checklist must document backup inventory summary',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'riskLevel',
    'deployment checklist must document backup inventory risk level',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'nextActions',
    'deployment checklist must document backup inventory next actions',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Web 首页入口',
    'deployment checklist must document web homepage entry checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'API/Web 安全响应头',
    'deployment checklist must document API/Web security response header checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Web 前端静态资源',
    'deployment checklist must document web frontend asset checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '容器挂载缺失或读写状态异常',
    'deployment checklist must document runtime container mount checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '容器环境与 .env 不一致',
    'deployment checklist must document runtime container env checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '宿主机备份目录不可写',
    'deployment checklist must document host backup directory write failures',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '敏感信息脱敏',
    'deployment checklist must document evidence redaction checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '服务启动失败、初始健康检查未通过或部署自检失败',
    'deployment checklist must document failed evidence collection for startup failures',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 启动失败、初始健康检查失败或部署自检失败',
    'enterprise status must document failed evidence collection for early startup failures',
  );
  assertIncludes(
    'README.md',
    '服务启动失败、初始健康检查未通过或自检失败',
    'README must document failed evidence collection for early startup failures',
  );
  assertIncludes(
    'deploy/README.md',
    '服务启动失败、初始健康检查未通过或自检失败',
    'deployment README must document failed evidence collection for early startup failures',
  );
  assertIncludes('docs/部署健康验收清单.md', '备份目录磁盘', 'deployment checklist must document backup disk checks');
  assertIncludes('docs/部署健康验收清单.md', 'inode', 'deployment checklist must document inode checks');
  assertIncludes(
    'docs/部署健康验收清单.md',
    '备份签名密钥 BACKUP_SIGNING_SECRET',
    'deployment checklist must document backup signing secret checks',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '备份加密密钥 BACKUP_ENCRYPTION_SECRET',
    'deployment checklist must document backup encryption secret checks',
  );
  assertIncludes(
    'README.md',
    'productionEvidence.finalConclusionReady=true',
    'README must document final conclusion exit-code gate',
  );
  assertIncludes('README.md', '固定白名单文件', 'README must document evidence file allowlist');
  assertIncludes('README.md', '辅助证据内容必须符合预期结构', 'README must document support evidence checks');
  assertIncludes('README.md', '证据批次 ID 必须一致', 'README must document evidence bundle ID checks');
  assertIncludes(
    'README.md',
    '主健康报告 `deploy-health-report.json`',
    'README must include health report in bundle ID checks',
  );
  assertIncludes('README.md', 'imageId=sha256:', 'README must document container image ID checks');
  assertIncludes('README.md', '未配置 healthcheck', 'README must document missing healthcheck warnings');
  assertIncludes('README.md', 'restart: unless-stopped', 'README must document restart policy checks');
  assertIncludes('README.md', '重启策略', 'README must document runtime restart policy checks');
  assertIncludes('README.md', 'restartPolicy=', 'README must document provenance restart policy evidence');
  assertIncludes('README.md', '日志轮转', 'README must document log rotation checks');
  assertIncludes('README.md', 'OOMKilled', 'README must document OOMKilled checks');
  assertIncludes('README.md', 'restartCount=', 'README must document restartCount evidence');
  assertIncludes('README.md', '文件权限', 'README must document env file permission checks');
  assertIncludes('README.md', 'IMAGE_TAG', 'README must document image tag checks');
  assertIncludes('README.md', 'Compose 持久化挂载', 'README must document persistent mount checks');
  assertIncludes('README.md', 'Compose 内部网络', 'README must document Compose internal network checks');
  assertIncludes('README.md', 'REDISCLI_AUTH', 'README must document authenticated Redis healthcheck');
  assertIncludes('README.md', '资源配置预算', 'README must document resource budget checks');
  assertIncludes('README.md', 'Web 首页入口', 'README must document web homepage entry checks');
  assertIncludes('README.md', 'API/Web 安全响应头', 'README must document API/Web security response header checks');
  assertIncludes('README.md', 'Web 前端静态资源', 'README must document web frontend asset checks');
  assertIncludes('README.md', '实际容器挂载', 'README must document runtime container mount checks');
  assertIncludes('README.md', '运行容器关键环境', 'README must document runtime container env checks');
  assertIncludes('README.md', '宿主机备份目录可写', 'README must document host backup directory write checks');
  assertIncludes('README.md', '敏感信息脱敏', 'README must document evidence redaction checks');
  assertIncludes('README.md', '备份目录磁盘', 'README must document backup disk checks');
  assertIncludes('README.md', 'Docker 数据目录', 'README must document Docker data-root disk and inode checks');
  assertIncludes('README.md', 'inode', 'README must document inode checks');
  assertIncludes('README.md', 'API/Web 日志', 'README must document API and web log evidence');
  assertIncludes('README.md', '宿主机资源', 'README must document host resource evidence');
  assertIncludes('README.md', '网络监听', 'README must document network listener evidence');
  assertIncludes('README.md', '备份库存', 'README must document backup inventory evidence');
  assertIncludes('README.md', 'BACKUP_SIGNING_SECRET', 'README must document backup signing secret');
  assertIncludes('README.md', 'BACKUP_ENCRYPTION_SECRET', 'README must document backup encryption secret');
  assertIncludes(
    'README.md',
    '摘要内容引用当前 `.tar.gz` 文件名',
    'README must document archive sidecar filename binding',
  );
  assertIncludes(
    'deploy/README.md',
    'productionEvidence.finalConclusionReady=true',
    'deployment README must document final conclusion exit-code gate',
  );
  assertIncludes('deploy/README.md', '固定白名单文件', 'deployment README must document evidence file allowlist');
  assertIncludes(
    'deploy/README.md',
    '辅助证据内容必须符合预期结构',
    'deployment README must document support evidence checks',
  );
  assertIncludes(
    'deploy/README.md',
    '证据批次 ID 必须一致',
    'deployment README must document evidence bundle ID checks',
  );
  assertIncludes(
    'deploy/README.md',
    '主健康报告 `deploy-health-report.json`',
    'deployment README must include health report in bundle ID checks',
  );
  assertIncludes('deploy/README.md', 'imageId=sha256:', 'deployment README must document container image ID checks');
  assertIncludes(
    'deploy/README.md',
    '未配置 healthcheck',
    'deployment README must document missing healthcheck warnings',
  );
  assertIncludes(
    'deploy/README.md',
    'restart: unless-stopped',
    'deployment README must document restart policy checks',
  );
  assertIncludes('deploy/README.md', '重启策略', 'deployment README must document runtime restart policy checks');
  assertIncludes(
    'deploy/README.md',
    'restartPolicy=',
    'deployment README must document provenance restart policy evidence',
  );
  assertIncludes('deploy/README.md', '日志轮转', 'deployment README must document log rotation checks');
  assertIncludes('deploy/README.md', '敏感信息脱敏', 'deployment README must document evidence redaction checks');
  assertIncludes('deploy/README.md', 'OOMKilled', 'deployment README must document OOMKilled checks');
  assertIncludes('deploy/README.md', 'API/Web 日志', 'deployment README must document API and web log evidence');
  assertIncludes('deploy/README.md', '宿主机资源', 'deployment README must document host resource evidence');
  assertIncludes('deploy/README.md', '网络监听', 'deployment README must document network listener evidence');
  assertIncludes('deploy/README.md', '备份库存', 'deployment README must document backup inventory evidence');
  assertIncludes('deploy/README.md', 'restartCount=', 'deployment README must document restartCount evidence');
  assertIncludes('deploy/README.md', '文件权限', 'deployment README must document env file permission checks');
  assertIncludes('deploy/README.md', 'IMAGE_TAG', 'deployment README must document image tag checks');
  assertIncludes('deploy/README.md', 'Compose 持久化挂载', 'deployment README must document persistent mount checks');
  assertIncludes(
    'deploy/README.md',
    'Compose 内部网络',
    'deployment README must document Compose internal network checks',
  );
  assertIncludes(
    'deploy/README.md',
    'REDISCLI_AUTH',
    'deployment README must document authenticated Redis healthcheck',
  );
  assertIncludes('deploy/README.md', '资源配置预算', 'deployment README must document resource budget checks');
  assertIncludes('deploy/README.md', 'Web 首页入口', 'deployment README must document web homepage entry checks');
  assertIncludes(
    'deploy/README.md',
    'API/Web 安全响应头',
    'deployment README must document API/Web security response header checks',
  );
  assertIncludes('deploy/README.md', 'Web 前端静态资源', 'deployment README must document web frontend asset checks');
  assertIncludes('deploy/README.md', '实际容器挂载', 'deployment README must document runtime container mount checks');
  assertIncludes(
    'deploy/README.md',
    '运行容器关键环境',
    'deployment README must document runtime container env checks',
  );
  assertIncludes(
    'deploy/README.md',
    '备份签名/加密密钥',
    'deployment README must document backup signing/encryption secret checks',
  );
  assertIncludes(
    'deploy/README.md',
    '宿主机备份目录可写',
    'deployment README must document host backup directory write checks',
  );
  assertIncludes('deploy/README.md', '备份目录磁盘', 'deployment README must document backup disk checks');
  assertIncludes(
    'deploy/README.md',
    'Docker 数据目录',
    'deployment README must document Docker data-root disk and inode checks',
  );
  assertIncludes('deploy/README.md', 'inode', 'deployment README must document inode checks');
  assertIncludes(
    'deploy/README.md',
    '摘要内容引用当前 `.tar.gz` 文件名',
    'deployment README must document archive sidecar filename binding',
  );
  assertIncludes('docs/README.md', '企业级改进验收状态', 'docs index must include enterprise status');
  assertIncludes('docs/README.md', '生产部署健康验收清单', 'docs index must include deployment checklist');
  assertIncludes('docs/代码维护规范.md', '企业级改进验收状态', 'maintenance docs must require status updates');
  assertIncludes(
    '.github/pull_request_template.md',
    'npm run verify:enterprise',
    'PR template must include enterprise acceptance verification',
  );
  assertIncludes('docs/企业级改进验收状态.md', '当前结论', 'enterprise status must summarize current state');
  assertIncludes('docs/企业级改进验收状态.md', '本地验证记录', 'enterprise status must list local evidence');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'npm run verify:enterprise',
    'enterprise status must document local acceptance command',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'local-enterprise-acceptance.json',
    'enterprise status must document local acceptance artifact',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '生产证据闭环状态',
    'enterprise status must document production evidence closure section',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'productionEvidence',
    'enterprise status must document local production evidence state field',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'finalConclusionReady=true',
    'enterprise status must document final conclusion readiness in local summary',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'productionEvidence.backupInventoryReady=true',
    'enterprise status must document backup inventory readiness for final production conclusion',
  );
  assertIncludes('docs/企业级改进验收状态.md', '生产验收步骤', 'enterprise status must explain production acceptance');
  assertIncludes('docs/企业级改进验收状态.md', '剩余风险', 'enterprise status must keep remaining risks visible');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'deployment-provenance.txt',
    'enterprise status must document provenance evidence',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '拒绝密钥赋值',
    'enterprise status must document provenance secret checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '真实生产证据',
    'enterprise status must not claim production completion without evidence',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '固定白名单文件',
    'enterprise status must document evidence file allowlist',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '空壳辅助证据',
    'enterprise status must document support evidence shape checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '证据批次 ID',
    'enterprise status must document evidence bundle ID checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'deploy-health-report.json',
    'enterprise status must include health report in bundle ID checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'imageId=sha256:',
    'enterprise status must document container image ID checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '缺少 healthcheck',
    'enterprise status must document missing healthcheck warnings',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'restart: unless-stopped',
    'enterprise status must document restart policy checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '重启策略',
    'enterprise status must document runtime restart policy checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'restartPolicy=',
    'enterprise status must document provenance restart policy evidence',
  );
  assertIncludes('docs/企业级改进验收状态.md', '日志轮转', 'enterprise status must document log rotation checks');
  assertIncludes('docs/企业级改进验收状态.md', 'max-size', 'enterprise status must document log max-size checks');
  assertIncludes('docs/企业级改进验收状态.md', 'max-file', 'enterprise status must document log max-file checks');
  assertIncludes('docs/企业级改进验收状态.md', 'OOMKilled', 'enterprise status must document OOMKilled checks');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'restartCount=',
    'enterprise status must document restartCount evidence',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '文件权限是否安全',
    'enterprise status must document env file permission checks',
  );
  assertIncludes('docs/企业级改进验收状态.md', 'IMAGE_TAG', 'enterprise status must document image tag checks');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Compose 持久化挂载',
    'enterprise status must document persistent mount checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'REDISCLI_AUTH',
    'enterprise status must document authenticated Redis healthcheck',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '资源配置是否适配当前服务器内存档位',
    'enterprise status must document resource budget checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '健康报告必要检查必须一项一条且位于 pass 信息开头',
    'enterprise status must document required check anti-forgery rules',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'JSON/TXT 健康报告一起验收',
    'enterprise status must document JSON/TXT report binding',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Web 首页入口',
    'enterprise status must document web homepage entry checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API/Web 安全响应头',
    'enterprise status must document API/Web security response header checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Web 前端静态资源',
    'enterprise status must document web frontend asset checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Docker Mounts',
    'enterprise status must document runtime container mount checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '关键环境是否与 `.env` 一致',
    'enterprise status must document runtime container env checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '宿主机备份目录',
    'enterprise status must document host backup directory write checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '敏感信息脱敏',
    'enterprise status must document evidence redaction checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'API/Web 日志尾部',
    'enterprise status must document API and web log evidence',
  );
  assertIncludes('docs/企业级改进验收状态.md', '宿主机资源', 'enterprise status must document host resource evidence');
  assertIncludes('docs/企业级改进验收状态.md', '网络监听', 'enterprise status must document network listener evidence');
  assertIncludes('docs/企业级改进验收状态.md', '备份库存', 'enterprise status must document backup inventory evidence');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'backupInventory',
    'enterprise status must document backup inventory summary',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'riskLevel',
    'enterprise status must document backup inventory risk level',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'nextActions',
    'enterprise status must document backup inventory next actions',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'restoreDrillExecuted',
    'enterprise status must document backup restore drill evidence field',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'Restore drill evidence',
    'enterprise status must document restore drill evidence collection',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'docker compose exec api npm run backup:e2e',
    'deployment checklist must document production backup restore drill command',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'Restore drill evidence: status=passed',
    'deployment checklist must document restore drill evidence marker',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'productionEvidence.backupInventoryReady=true',
    'deployment checklist must document backup inventory readiness for final production conclusion',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'backupInventory.riskLevel=low',
    'deployment checklist must require low backup inventory risk for final production conclusion',
  );
  assertIncludes(
    'README.md',
    'docker compose exec api npm run backup:e2e',
    'README must document backup restore drill command',
  );
  assertIncludes(
    'README.md',
    'productionEvidence.backupInventoryReady=true',
    'README must document backup inventory readiness for final production conclusion',
  );
  assertIncludes(
    'deploy/README.md',
    'Restore drill evidence: status=passed',
    'deployment README must document restore drill evidence marker',
  );
  assertIncludes(
    'deploy/README.md',
    'productionEvidence.backupInventoryReady=true',
    'deployment README must document backup inventory readiness for final production conclusion',
  );
  assertIncludes(
    'scripts/collect-deploy-evidence.sh',
    '.restore-drills/latest.json',
    'evidence collector must read latest backup restore drill evidence',
  );
  assertIncludes(
    'scripts/collect-deploy-evidence.sh',
    'list_backup_files',
    'evidence collector must use path-safe backup inventory traversal',
  );
  assertIncludes(
    'scripts/collect-deploy-evidence.sh',
    'ls -dt',
    'evidence collector must keep recent backup inventory sorted by mtime',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'evidence collector whitespace backup report',
    'deploy health regression must cover whitespace in backup evidence filenames',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'sorted by mtime descending',
    'deploy health regression must verify backup evidence mtime ordering',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '发现备份临时工作目录',
    'deploy acceptance must surface backup work directory risk',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '备份库存证据缺少 directoryExists 摘要',
    'deploy acceptance must block final conclusion when backup directory summary is missing',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    '备份库存证据缺少 workDirs 摘要',
    'deploy acceptance must block final conclusion when backup work directory summary is missing',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'Expected backup work directory to raise medium backup risk',
    'deploy health regression must block final conclusion when backup work directories remain',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'Expected missing backup inventory field to raise medium risk',
    'deploy health regression must block missing backup inventory summary fields',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '最近修改时间',
    'deployment checklist must document mtime-sorted backup inventory evidence',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    '.work',
    'deployment checklist must document backup work directory blockers',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'directoryExists',
    'deployment checklist must document required backup directory summary field',
  );
  assertIncludes(
    'docs/部署健康验收清单.md',
    'workDirs',
    'deployment checklist must document required backup work directory summary field',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '最近修改时间',
    'enterprise status must document mtime-sorted backup inventory evidence',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '临时工作目录',
    'enterprise status must document backup work directory blockers',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'directoryExists',
    'enterprise status must document required backup directory summary field',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'workDirs',
    'enterprise status must document required backup work directory summary field',
  );
  assertIncludes(
    'server/src/scripts/backup-e2e-check.ts',
    'config().staticDir',
    'backup restore drill must use configured static directory',
  );
  assertIncludes(
    'server/src/scripts/backup-e2e-check.ts',
    'config().uploadDir',
    'backup restore drill must use configured upload directory',
  );
  assertIncludes(
    'server/Dockerfile',
    '/app/dist ./dist',
    'runtime image must include compiled backup restore drill script',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'restoreDrillExecuted',
    'deploy acceptance summary must expose restore drill status',
  );
  assertIncludes(
    'scripts/verify-deploy-health-report.mjs',
    'backupInventoryReady',
    'deploy acceptance summary must gate final conclusion on backup inventory readiness',
  );
  assertIncludes(
    'scripts/test-deploy-health-check.sh',
    'Expected production acceptance to reject final conclusion without restore drill evidence',
    'deploy health regression must cover missing restore drill evidence',
  );
  assertIncludes('docs/企业级改进验收状态.md', '备份目录磁盘', 'enterprise status must document backup disk checks');
  assertIncludes('docs/企业级改进验收状态.md', 'inode', 'enterprise status must document inode checks');
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'BACKUP_SIGNING_SECRET',
    'enterprise status must document backup signing secret checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    'BACKUP_ENCRYPTION_SECRET',
    'enterprise status must document backup encryption secret checks',
  );
  assertIncludes(
    'docs/企业级改进验收状态.md',
    '摘要内容引用当前 `.tar.gz` 文件名',
    'enterprise status must document archive sidecar filename binding',
  );
}

verifyPackageScripts();
verifyDeployVerifierWiring();
verifyDeployScriptEvidenceWiring();
verifyProductionAcceptanceWiring();
verifyEnterpriseAcceptanceWiring();
verifyLocalVerificationWiring();
verifyDeployHealthSecurityHeaderWiring();
verifyDeployHealthSecurityConfigWiring();
verifyDeployHealthEndpointWiring();
verifyDeployHealthPortWiring();
verifyDeployHealthLogWiring();
verifyCiWiring();
verifyEvidenceIgnored();
verifyProductionComposePolicies();
verifyWebNginxSensitivePathPolicy();
verifyDocs();

console.log('Deploy wiring verification passed.');
