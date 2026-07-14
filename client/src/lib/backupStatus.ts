// 备份保护状态的展示逻辑（纯函数，零 React / hooks 依赖）。
//
// 抽自 ../pages/SettingsPage.tsx：把备份体检（health / policyCheck）映射成状态
// 徽标、图标、配色，以及保护卡片 / 建议文案。状态归一、worst 合并、卡片构建
// 都集中在这里，组件层只负责渲染。数据类型来自 ../api/settings。

import type { BackupHealth, BackupPolicyCheck, BackupScope } from '../api/settings';

export const BACKUP_SCOPE_OPTIONS: Array<{ value: BackupScope; label: string; desc: string; icon: string }> = [
  { value: 'full', label: '整站备份', desc: '数据库与全部资源', icon: 'database' },
  { value: 'models', label: '模型库', desc: '模型产品与 3D 文件', icon: 'view_in_ar' },
  { value: 'selection', label: '选型', desc: '选型分类、产品与素材', icon: 'tune' },
  { value: 'product_wall', label: '产品图库', desc: '图库分类、图片与状态', icon: 'photo_library' },
  { value: 'config', label: '系统配置', desc: '站点设置、模型分类与品牌资产', icon: 'settings' },
];

export function getBackupScopeLabel(scope?: BackupScope, fallback?: string): string {
  if (fallback) return fallback;
  return BACKUP_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || '整站备份';
}

export function formatStatNumber(value: unknown): string {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

export function formatOptionalStatNumber(value: unknown, fallback = '待刷新'): string {
  if (value === undefined || value === null) return fallback;
  return formatStatNumber(value);
}

export type BackupProtectionStatus = 'ok' | 'warning' | 'error' | 'muted';

export interface BackupProtectionCard {
  key: string;
  icon: string;
  label: string;
  value: string;
  detail: string;
  status: BackupProtectionStatus;
}

export function toBackupProtectionStatus(
  status?: BackupPolicyCheck['status'] | BackupHealth['status'],
): BackupProtectionStatus {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'error';
  if (status === 'warning' || status === 'disabled' || status === 'empty') return 'warning';
  return 'muted';
}

function getWorstBackupStatus(statuses: BackupProtectionStatus[]): BackupProtectionStatus {
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('ok')) return 'ok';
  return 'muted';
}

export function getBackupStatusIcon(status: BackupProtectionStatus): string {
  if (status === 'ok') return 'check_circle';
  if (status === 'error') return 'error';
  if (status === 'warning') return 'warning';
  return 'info';
}

export function getBackupStatusText(status: BackupProtectionStatus): string {
  if (status === 'ok') return '正常';
  if (status === 'error') return '异常';
  if (status === 'warning') return '需关注';
  return '待检查';
}

export function getBackupStatusClasses(status: BackupProtectionStatus): string {
  if (status === 'ok') return 'bg-green-500/10 text-green-600 border-green-500/20';
  if (status === 'error') return 'bg-error/10 text-error border-error/20';
  if (status === 'warning') return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
  return 'bg-surface-container-high/70 text-on-surface-variant border-outline-variant/15';
}

export function getBackupStatusIconClass(status: BackupProtectionStatus): string {
  if (status === 'ok') return 'text-green-500';
  if (status === 'error') return 'text-error';
  if (status === 'warning') return 'text-yellow-500';
  return 'text-on-surface-variant';
}

export function getBackupRiskStatus(report?: BackupPolicyCheck['report']): BackupProtectionStatus {
  if (report?.riskLevel === 'high') return 'error';
  if (report?.riskLevel === 'medium') return 'warning';
  if (report?.riskLevel === 'low') return 'ok';
  return 'muted';
}

export function getBackupRiskLabel(report?: BackupPolicyCheck['report']): string {
  if (report?.riskLevel === 'high') return '高风险';
  if (report?.riskLevel === 'medium') return '中风险';
  if (report?.riskLevel === 'low') return '低风险';
  return '待检查';
}

function findBackupPolicyCheck(policyCheck: BackupPolicyCheck | null, key: string) {
  return policyCheck?.checks.find((check) => check.key === key);
}

function getBackupPolicyChecks(
  policyCheck: BackupPolicyCheck | null,
  predicate: (label: string, key: string) => boolean,
) {
  return policyCheck?.checks.filter((check) => predicate(check.label, check.key)) || [];
}

export function buildBackupProtectionCards(
  health: BackupHealth,
  policyCheck: BackupPolicyCheck | null,
): BackupProtectionCard[] {
  const latestCheck = findBackupPolicyCheck(policyCheck, 'latest_backup');
  const latestStatus = latestCheck
    ? toBackupProtectionStatus(latestCheck.status)
    : health.latestBackup
      ? 'ok'
      : 'warning';
  const latestTime = health.latestBackup
    ? new Date(health.latestBackup.createdAt).toLocaleString('zh-CN')
    : '暂无恢复点';

  const scheduleCheck = findBackupPolicyCheck(policyCheck, 'schedule');
  const autoStatus = scheduleCheck
    ? toBackupProtectionStatus(scheduleCheck.status)
    : health.enabled
      ? health.lastAutoStatus === 'error'
        ? 'error'
        : 'ok'
      : 'warning';

  const mirrorChecks = getBackupPolicyChecks(
    policyCheck,
    (label, key) => key === 'mirror' || key === 'mirror_dir' || label.includes('外部镜像'),
  );
  const mirrorStatus = health.mirrorEnabled
    ? getWorstBackupStatus(
        mirrorChecks.length
          ? mirrorChecks.map((check) => toBackupProtectionStatus(check.status))
          : [health.lastMirrorStatus === 'error' ? 'error' : health.mirrorDir ? 'ok' : 'warning'],
      )
    : 'warning';

  const encryptionCheck = findBackupPolicyCheck(policyCheck, 'encryption');
  const encryptionStatus = encryptionCheck
    ? toBackupProtectionStatus(encryptionCheck.status)
    : health.encryption?.enabled
      ? 'ok'
      : 'warning';

  return [
    {
      key: 'recovery',
      icon: 'restore',
      label: '恢复点',
      value: health.latestBackup ? `${health.backupCount} 份` : '未创建',
      detail: latestCheck?.message || `${latestTime} / ${health.totalSizeText}`,
      status: latestStatus,
    },
    {
      key: 'schedule',
      icon: 'schedule',
      label: '自动化',
      value: health.enabled ? `每日 ${health.scheduleTime}` : '手动',
      detail: scheduleCheck?.message || health.lastAutoMessage || '用于避免长期忘记创建备份',
      status: autoStatus,
    },
    {
      key: 'mirror',
      icon: 'cloud',
      label: '异地副本',
      value: health.mirrorEnabled ? '已开启' : '未开启',
      detail:
        mirrorChecks.find((check) => check.status !== 'ok')?.message ||
        health.lastMirrorMessage ||
        health.mirrorDir ||
        '建议镜像到 NAS 或独立磁盘',
      status: mirrorStatus,
    },
    {
      key: 'encryption',
      icon: 'lock',
      label: '加密',
      value: health.encryption?.enabled ? '已开启' : '未开启',
      detail:
        encryptionCheck?.message ||
        (health.encryption?.enabled
          ? `${health.encryption.algorithm}，备份包落盘前加密`
          : `建议配置 ${health.encryption?.recommendedEnvName || 'BACKUP_ENCRYPTION_SECRET'}`),
      status: encryptionStatus,
    },
  ];
}

function formatBackupPolicyAdvice(check: BackupPolicyCheck['checks'][number]): string {
  if (check.key === 'schedule') return '开启每日自动备份，避免只依赖人工操作。';
  if (check.key === 'retention') return '保留至少 3 份备份，方便回退到更早时间点。';
  if (check.key === 'mirror') return '配置外部镜像目录，最好指向 NAS 或独立磁盘。';
  if (check.key === 'mirror_dir') return '修正外部镜像目录，不能为空，也不能指向当前备份目录。';
  if (check.key === 'latest_backup') return '重新创建并校验一次备份，确认当前版本可恢复。';
  if (check.key === 'encryption') return '配置 BACKUP_ENCRYPTION_SECRET，让备份包在磁盘上保持加密。';
  if (check.label.includes('磁盘空间')) return `${check.label}不足或不可确认，建议清理空间或换到更大磁盘。`;
  if (check.label.includes('可写')) return `${check.label}失败，请检查目录权限。`;
  return `${check.label}：${check.message}`;
}

export function buildBackupAdviceItems(health: BackupHealth, policyCheck: BackupPolicyCheck | null): string[] {
  if (policyCheck?.report?.nextActions?.length) {
    return policyCheck.report.nextActions.slice(0, 5);
  }

  if (policyCheck) {
    const issues = policyCheck.checks.filter((check) => check.status !== 'ok');
    if (issues.length === 0) {
      return ['体检通过：目录权限、磁盘空间、最近备份校验、自动策略和外部副本都处于可用状态。'];
    }
    return issues.map(formatBackupPolicyAdvice).slice(0, 5);
  }

  const advice: string[] = [];
  if (!health.latestBackup) advice.push('先创建一次整站备份，建立可恢复的基线。');
  if (!health.enabled) advice.push('确认手动备份稳定后，开启每日自动备份。');
  if (health.retentionCount < 3) advice.push('保留份数建议至少设置为 3 份。');
  if (!health.mirrorEnabled) advice.push('配置外部镜像目录，把副本同步到 NAS 或独立磁盘。');
  if (!health.encryption?.enabled) advice.push('配置 BACKUP_ENCRYPTION_SECRET，避免备份包明文落盘。');
  if (advice.length === 0) advice.push('基础保障看起来正常；点击策略体检可进一步校验目录、空间和备份包完整性。');
  return advice.slice(0, 5);
}
