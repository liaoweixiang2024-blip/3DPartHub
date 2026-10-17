// 备份保护状态的展示逻辑（纯函数，零 React / hooks 依赖）。
//
// 抽自 ../pages/SettingsPage.tsx：把备份体检（health / policyCheck）映射成状态
// 徽标、图标、配色，以及保护卡片 / 建议文案。状态归一、worst 合并、卡片构建
// 都集中在这里，组件层只负责渲染。数据类型来自 ../api/settings。

import type { BackupHealth, BackupPolicyCheck, BackupScope } from '../api/settings';
import { i18n } from '../i18n';

// label / desc 存 i18n 键（backupLib 命名空间），渲染处再 t()；getBackupScopeLabel 返回已翻译文案。
export const BACKUP_SCOPE_OPTIONS: Array<{ value: BackupScope; label: string; desc: string; icon: string }> = [
  { value: 'full', label: 'backupLib.scopeFull', desc: 'backupLib.scopeFullDesc', icon: 'database' },
  { value: 'models', label: 'backupLib.scopeModels', desc: 'backupLib.scopeModelsDesc', icon: 'view_in_ar' },
  { value: 'selection', label: 'backupLib.scopeSelection', desc: 'backupLib.scopeSelectionDesc', icon: 'tune' },
  {
    value: 'product_wall',
    label: 'backupLib.scopeProductWall',
    desc: 'backupLib.scopeProductWallDesc',
    icon: 'photo_library',
  },
  { value: 'config', label: 'backupLib.scopeConfig', desc: 'backupLib.scopeConfigDesc', icon: 'settings' },
  { value: 'users', label: 'backupLib.scopeUsers', desc: 'backupLib.scopeUsersDesc', icon: 'group' },
  { value: 'tickets', label: 'backupLib.scopeTickets', desc: 'backupLib.scopeTicketsDesc', icon: 'support_agent' },
  {
    value: 'inquiries',
    label: 'backupLib.scopeInquiries',
    desc: 'backupLib.scopeInquiriesDesc',
    icon: 'request_quote',
  },
  { value: 'audit', label: 'backupLib.scopeAudit', desc: 'backupLib.scopeAuditDesc', icon: 'receipt_long' },
];

export function getBackupScopeLabel(scope?: BackupScope, fallback?: string): string {
  if (fallback) return fallback;
  const labelKey = BACKUP_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || 'backupLib.scopeFull';
  return i18n.t(labelKey);
}

export function formatStatNumber(value: unknown): string {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0';
}

export function formatOptionalStatNumber(value: unknown, fallback = 'backupLib.statPendingRefresh'): string {
  if (value === undefined || value === null) return i18n.t(fallback);
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
  /** 未开启/有风险时提示如何操作；配置了 targetTab 则渲染成跳转按钮（设置页子区块名） */
  action?: { text: string; targetTab?: string };
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
  if (status === 'ok') return i18n.t('backupLib.statusOk');
  if (status === 'error') return i18n.t('backupLib.statusError');
  if (status === 'warning') return i18n.t('backupLib.statusWarning');
  return i18n.t('backupLib.statusMuted');
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
  if (report?.riskLevel === 'high') return i18n.t('backupLib.riskHigh');
  if (report?.riskLevel === 'medium') return i18n.t('backupLib.riskMedium');
  if (report?.riskLevel === 'low') return i18n.t('backupLib.riskLow');
  return i18n.t('backupLib.statusMuted');
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
    : i18n.t('backupLib.noRecoveryPoint');

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
      label: i18n.t('backupLib.cardRecovery'),
      value: health.latestBackup
        ? i18n.t('backupLib.unitCopies', { count: health.backupCount })
        : i18n.t('backupLib.notCreated'),
      detail: health.latestBackup
        ? i18n.t('backupLib.recoveryDetailLatest', { time: latestTime, size: health.totalSizeText })
        : i18n.t('backupLib.recoveryDetailEmpty'),
      status: latestStatus,
      action: health.latestBackup
        ? undefined
        : { text: i18n.t('backupLib.actionCreateBackup'), targetTab: '__scroll_create__' },
    },
    {
      key: 'schedule',
      icon: 'schedule',
      label: i18n.t('backupLib.cardAutomation'),
      value: health.enabled
        ? i18n.t('backupLib.scheduleDailyAt', { time: health.scheduleTime })
        : i18n.t('backupLib.manualMode'),
      detail: health.enabled
        ? scheduleCheck?.message ||
          health.lastAutoMessage ||
          i18n.t('backupLib.scheduleDetailAuto', { time: health.scheduleTime })
        : i18n.t('backupLib.scheduleDetailManual'),
      status: autoStatus,
      action: health.enabled
        ? undefined
        : { text: i18n.t('backupLib.actionEnableAutoBackup'), targetTab: 'adminSettings.tabOpsMaintenance' },
    },
    {
      key: 'mirror',
      icon: 'cloud',
      label: i18n.t('backupLib.cardMirror'),
      value: health.mirrorEnabled ? i18n.t('backupLib.enabledOn') : i18n.t('backupLib.enabledOff'),
      detail: health.mirrorEnabled
        ? mirrorChecks.find((check) => check.status !== 'ok')?.message ||
          health.lastMirrorMessage ||
          health.mirrorDir ||
          i18n.t('backupLib.mirrorDetailDefault')
        : i18n.t('backupLib.mirrorDetailOff'),
      status: mirrorStatus,
      action: health.mirrorEnabled
        ? undefined
        : { text: i18n.t('backupLib.actionConfigureMirror'), targetTab: 'adminSettings.tabOpsMaintenance' },
    },
    {
      key: 'encryption',
      icon: 'lock',
      label: i18n.t('backupLib.cardEncryption'),
      value: health.encryption?.enabled ? i18n.t('backupLib.enabledOn') : i18n.t('backupLib.enabledOff'),
      detail: health.encryption?.enabled
        ? i18n.t('backupLib.encryptionDetailOn', { algorithm: health.encryption.algorithm })
        : i18n.t('backupLib.encryptionDetailOff', {
            envName: health.encryption?.recommendedEnvName || 'BACKUP_ENCRYPTION_SECRET',
          }),
      status: encryptionStatus,
    },
  ];
}

function formatBackupPolicyAdvice(check: BackupPolicyCheck['checks'][number]): string {
  if (check.key === 'schedule') return i18n.t('backupLib.adviceSchedule');
  if (check.key === 'retention') return i18n.t('backupLib.adviceRetention');
  if (check.key === 'mirror') return i18n.t('backupLib.adviceMirror');
  if (check.key === 'mirror_dir') return i18n.t('backupLib.adviceMirrorDir');
  if (check.key === 'latest_backup') return i18n.t('backupLib.adviceLatestBackup');
  if (check.key === 'encryption') return i18n.t('backupLib.adviceEncryption');
  if (check.key === 'download_channel') return i18n.t('backupLib.adviceDownloadChannel');
  if (check.label.includes('磁盘空间')) return i18n.t('backupLib.adviceDiskSpace', { label: check.label });
  if (check.label.includes('可写')) return i18n.t('backupLib.adviceWritable', { label: check.label });
  return `${check.label}：${check.message}`;
}

export function buildBackupAdviceItems(health: BackupHealth, policyCheck: BackupPolicyCheck | null): string[] {
  if (policyCheck?.report?.nextActions?.length) {
    return policyCheck.report.nextActions.slice(0, 5);
  }

  if (policyCheck) {
    const issues = policyCheck.checks.filter((check) => check.status !== 'ok');
    if (issues.length === 0) {
      return [i18n.t('backupLib.adviceAllPassed')];
    }
    return issues.map(formatBackupPolicyAdvice).slice(0, 5);
  }

  const advice: string[] = [];
  if (!health.latestBackup) advice.push(i18n.t('backupLib.adviceCreateFirst'));
  if (!health.enabled) advice.push(i18n.t('backupLib.adviceEnableAuto'));
  if (health.retentionCount < 3) advice.push(i18n.t('backupLib.adviceKeepThree'));
  if (!health.mirrorEnabled) advice.push(i18n.t('backupLib.adviceMirrorCopy'));
  if (!health.encryption?.enabled) advice.push(i18n.t('backupLib.adviceEncryptSecret'));
  if (advice.length === 0) advice.push(i18n.t('backupLib.adviceBaselineOk'));
  return advice.slice(0, 5);
}
