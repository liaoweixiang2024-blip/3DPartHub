/**
 * Inline SVG illustrations for selection parameter values.
 *
 * Each key is a parameter name, value is a Map from option text → JSX.
 * Components receive `className` for sizing.
 */

import React from 'react';

type Illus = Record<string, React.FC<{ className?: string }>>;

/* ── 接头形态 / 管件形态 ── */

const straight: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="12" x2="44" y2="12" />
    <circle cx="8" cy="12" r="3" />
    <circle cx="40" cy="12" r="3" />
  </svg>
);

const elbow: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 36 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <path d="M8 8 L8 24 Q8 28 12 28 L28 28" />
    <circle cx="8" cy="10" r="3" />
    <circle cx="26" cy="28" r="3" />
  </svg>
);

const tee: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="12" x2="44" y2="12" />
    <line x1="24" y1="12" x2="24" y2="32" />
    <circle cx="8" cy="12" r="3" />
    <circle cx="40" cy="12" r="3" />
    <circle cx="24" cy="30" r="3" />
  </svg>
);

const cross: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 40"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="20" x2="36" y2="20" />
    <line x1="20" y1="4" x2="20" y2="36" />
    <circle cx="8" cy="20" r="2.5" />
    <circle cx="32" cy="20" r="2.5" />
    <circle cx="20" cy="8" r="2.5" />
    <circle cx="20" cy="32" r="2.5" />
  </svg>
);

const yShape: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="18" x2="18" y2="18" />
    <line x1="18" y1="18" x2="32" y2="6" />
    <line x1="18" y1="18" x2="32" y2="30" />
    <circle cx="8" cy="18" r="2.5" />
    <circle cx="30" cy="8" r="2.5" />
    <circle cx="30" cy="28" r="2.5" />
  </svg>
);

const reducing: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="12" x2="18" y2="12" />
    <path d="M18 6 L30 6 L30 18 L18 18 Z" />
    <line x1="30" y1="9" x2="44" y2="9" />
    <line x1="30" y1="15" x2="44" y2="15" />
    <circle cx="8" cy="12" r="3" />
  </svg>
);

const plug: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 36 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="12" x2="22" y2="12" />
    <rect x="22" y="6" width="10" height="12" rx="2" />
  </svg>
);

const branch: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 32"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="16" x2="44" y2="16" />
    <line x1="24" y1="16" x2="24" y2="4" />
    <circle cx="8" cy="16" r="2.5" />
    <circle cx="40" cy="16" r="2.5" />
    <circle cx="24" cy="6" r="2.5" />
  </svg>
);

const union: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 28"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="14" x2="18" y2="14" />
    <rect x="18" y="6" width="12" height="16" rx="3" />
    <line x1="30" y1="14" x2="44" y2="14" />
    <circle cx="8" cy="14" r="2.5" />
    <circle cx="40" cy="14" r="2.5" />
  </svg>
);

const nipple: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 32 20"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="10" x2="8" y2="10" />
    <rect x="8" y="4" width="16" height="12" rx="1" />
    <line x1="24" y1="10" x2="30" y2="10" />
  </svg>
);

const hoseBarb: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="4" y1="12" x2="18" y2="12" />
    <path d="M18 6 L36 6 L36 18 L18 18 Z" />
    <line x1="36" y1="8" x2="44" y2="8" />
    <line x1="36" y1="16" x2="44" y2="16" />
    <circle cx="8" cy="12" r="2.5" />
  </svg>
);

/* ── 阀门类型 ── */

const ballValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="22" x2="14" y2="22" />
    <circle cx="20" cy="22" r="7" />
    <line x1="26" y1="22" x2="38" y2="22" />
    <line x1="20" y1="15" x2="20" y2="6" />
    <line x1="16" y1="6" x2="24" y2="6" />
  </svg>
);

const butterflyValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="22" x2="14" y2="22" />
    <circle cx="20" cy="22" r="7" />
    <line x1="26" y1="22" x2="38" y2="22" />
    <line x1="20" y1="15" x2="20" y2="6" />
    <path d="M17 12 L20 6 L23 12" />
  </svg>
);

const needleValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="22" x2="14" y2="22" />
    <polygon points="14,18 26,18 26,26 14,26" />
    <line x1="26" y1="22" x2="38" y2="22" />
    <line x1="20" y1="18" x2="20" y2="6" />
    <circle cx="20" cy="5" r="2.5" />
  </svg>
);

const gateValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="22" x2="14" y2="22" />
    <rect x="14" y="16" width="12" height="12" rx="1" />
    <line x1="26" y1="22" x2="38" y2="22" />
    <line x1="20" y1="16" x2="20" y2="6" />
    <rect x="16" y="4" width="8" height="3" rx="1" />
  </svg>
);

const checkValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 28"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="14" x2="14" y2="14" />
    <path d="M14 8 L26 8 L26 20 L14 20 Z" />
    <line x1="26" y1="14" x2="38" y2="14" />
    <line x1="18" y1="10" x2="18" y2="18" />
  </svg>
);

const safetyValve: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 40 36"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="24" x2="12" y2="24" />
    <rect x="12" y="18" width="12" height="12" rx="2" />
    <line x1="24" y1="24" x2="34" y2="24" />
    <path d="M18 18 L18 10 L22 14" />
  </svg>
);

/* ── 公头/母头 ── */

const maleEnd: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 28 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="12" x2="10" y2="12" />
    <rect x="10" y="7" width="16" height="10" rx="1" />
    <circle cx="18" cy="12" r="2" />
  </svg>
);

const femaleEnd: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 28 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="2" y1="12" x2="10" y2="12" />
    <path d="M10 6 L26 6 L26 18 L10 18 Z" />
    <circle cx="18" cy="12" r="2" />
  </svg>
);

/* ── 枪体类型 ── */

const waterGun: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 44 28"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <rect x="4" y="8" width="22" height="12" rx="3" />
    <line x1="26" y1="14" x2="40" y2="14" />
    <path d="M36 10 L40 14 L36 18" />
    <line x1="12" y1="20" x2="12" y2="26" />
  </svg>
);

const airGun: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 44 28"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <rect x="4" y="8" width="20" height="12" rx="3" />
    <line x1="24" y1="14" x2="38" y2="14" />
    <path d="M34 10 L38 14 L34 18" />
    <line x1="10" y1="20" x2="10" y2="26" />
  </svg>
);

/* ── 手柄形式 ── */

const leverHandle: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 32 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <circle cx="12" cy="16" r="4" />
    <line x1="16" y1="14" x2="28" y2="6" />
  </svg>
);

const butterflyHandle: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 32 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <circle cx="16" cy="16" r="3" />
    <line x1="6" y1="12" x2="26" y2="12" />
  </svg>
);

const wheelHandle: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 28 28"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <circle cx="14" cy="14" r="8" />
    <line x1="14" y1="6" x2="14" y2="22" />
    <line x1="6" y1="14" x2="22" y2="14" />
  </svg>
);

/* ── 主映射表 ── */

export const paramIllustrations: Illus = {
  // ─── 接头形态 / 管件形态 ───
  直通: straight,
  直通接头: straight,
  弯头: elbow,
  弯接头: elbow,
  L型: elbow,
  三通: tee,
  三通接头: tee,
  T型: tee,
  T型接头: tee,
  十字: cross,
  十字接头: cross,
  四通: cross,
  Y型: yShape,
  Y型接头: yShape,
  Y型三通: yShape,
  异径: reducing,
  异径接头: reducing,
  变径: reducing,
  大小头: reducing,
  堵头: plug,
  管塞: plug,
  螺塞: plug,
  内塞: plug,
  分支: branch,
  分支接头: branch,
  由壬: union,
  对接: union,
  接管: union,
  螺母: nipple,
  六角螺母: nipple,
  宝塔: hoseBarb,
  宝塔接头: hoseBarb,
  倒刺: hoseBarb,
  穿板: straight,
  旋转: elbow,
  快速: straight,

  // ─── 阀门类型 ───
  球阀: ballValve,
  蝶阀: butterflyValve,
  针阀: needleValve,
  闸阀: gateValve,
  止回阀: checkValve,
  单向阀: checkValve,
  安全阀: safetyValve,
  减压阀: safetyValve,
  排气阀: safetyValve,
  角阀: elbow,
  电磁阀: butterflyValve,
  比例阀: needleValve,

  // ─── 公头/母头 ───
  公头: maleEnd,
  母头: femaleEnd,
  'A型(内螺纹)': femaleEnd,
  'B型(外螺纹)': maleEnd,

  // ─── 枪体 ───
  水枪: waterGun,
  气枪: airGun,
  标准型: waterGun,

  // ─── 手柄形式 ───
  手柄: leverHandle,
  扳把: leverHandle,
  蝶形: butterflyHandle,
  手轮: wheelHandle,
  T型手柄: leverHandle,
};

/**
 * Which parameter names should display illustrations.
 * Add a field here to opt-in; values not in paramIllustrations fall back to text-only.
 */
export const illustratedParams = new Set<string>([]);

/**
 * Get illustration component for a parameter value.
 * Returns null if no illustration exists.
 */
export function getIllustration(value: string): React.FC<{ className?: string }> | null {
  return paramIllustrations[value] ?? null;
}
