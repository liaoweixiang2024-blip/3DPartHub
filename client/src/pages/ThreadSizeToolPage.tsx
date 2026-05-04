import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import Icon from '../components/shared/Icon';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import { useAuthStore } from '../stores/useAuthStore';
import { useToast } from '../components/shared/Toast';
import { threadSizeApi, type ThreadSizeEntry } from '../api/threadSize';

type ThreadFamily = 'metric' | 'metricH' | 'metricA' | 'metricC' | 'metricD' | 'g' | 'r' | 'npt' | 'jic';
type ToolTab = 'thread' | 'pipe' | 'hose' | 'fitting';
type DataTab = ToolTab;

interface ThreadSpec {
  family: ThreadFamily;
  familyLabel: string;
  size: string;
  majorMm: number;
  pitchMm?: number;
  tpi?: number;
  seal: string;
  note: string;
}

interface PipeSpec {
  dn: string;
  inch: string;
  odMm: number;
  commonUse: string;
}

interface HoseSpec {
  kind?: '液压油管' | '气管';
  dash: string;
  nominalInch: string;
  innerMm: number;
  outerRangeMm: string;
  pressureMpa: string;
  jic: string;
  commonUse: string;
}

interface FittingSpec {
  code: string;
  category: string;
  form: '直咀' | '弯咀' | '45°';
  threadType: string;
  threadCodes: string;
  threadSpecs: string;
  insertCodes: string;
  hoseSizes: string;
  seal: string;
  remark: string;
}

interface AdminDataRow {
  id: string;
  tab: DataTab;
  family?: ThreadFamily;
  hoseKind?: 'hydraulic' | 'air';
  primary: string;
  secondary: string;
  meta: string;
  note: string;
  data?: unknown;
  sortOrder?: number;
  enabled?: boolean;
  dbEntry?: ThreadSizeEntry;
}

interface MeasurementQuery {
  hasMeasurement: boolean;
  outer?: number;
  inner?: number;
  pitchMm?: number;
  tpi?: number;
  pitchLabel?: string;
  family?: 'all' | ThreadFamily;
}

export const CATEGORY_FILTERS: Array<{
  key: string;
  label: string;
  apply: () => { tab: ToolTab; family?: 'all' | ThreadFamily; hoseKind?: 'all' | 'hydraulic' | 'air' };
}> = [
  { key: 'thread:all', label: '全部螺纹', apply: () => ({ tab: 'thread', family: 'all', hoseKind: 'all' }) },
  { key: 'thread:metric', label: 'M 公制螺纹', apply: () => ({ tab: 'thread', family: 'metric', hoseKind: 'all' }) },
  { key: 'thread:g', label: 'G 管螺纹', apply: () => ({ tab: 'thread', family: 'g', hoseKind: 'all' }) },
  { key: 'thread:r', label: 'R/PT 锥管', apply: () => ({ tab: 'thread', family: 'r', hoseKind: 'all' }) },
  { key: 'thread:npt', label: 'NPT 美制锥管', apply: () => ({ tab: 'thread', family: 'npt', hoseKind: 'all' }) },
  { key: 'thread:jic', label: 'JIC 美制接头', apply: () => ({ tab: 'thread', family: 'jic', hoseKind: 'all' }) },
  { key: 'pipe', label: '管径 / DN', apply: () => ({ tab: 'pipe', family: 'all', hoseKind: 'all' }) },
  { key: 'hose:hydraulic', label: '液压油管', apply: () => ({ tab: 'hose', family: 'all', hoseKind: 'hydraulic' }) },
  { key: 'hose:air', label: '气动管路', apply: () => ({ tab: 'hose', family: 'all', hoseKind: 'air' }) },
  { key: 'fitting', label: '扣压接头', apply: () => ({ tab: 'fitting', family: 'all', hoseKind: 'all' }) },
];

function includesAdminQuery(row: AdminDataRow, query: string) {
  if (!query.trim()) return true;
  const text = `${row.primary}${row.secondary}${row.meta}${row.note}`.toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

function categoryIcon(key: string) {
  if (key.startsWith('thread')) return 'hexagon';
  if (key === 'pipe') return 'pipeline';
  if (key.startsWith('hose')) return 'cat_hydraulic_hose';
  return 'cat_crimp_fitting';
}

function matchesAdminFilter(row: AdminDataRow, key: string) {
  const filter = CATEGORY_FILTERS.find((item) => item.key === key)?.apply();
  if (!filter) return true;
  if (row.tab !== filter.tab) return false;
  if (filter.family && filter.family !== 'all' && row.family !== filter.family) return false;
  if (filter.hoseKind && filter.hoseKind !== 'all' && row.hoseKind !== filter.hoseKind) return false;
  return true;
}

function entryToAdminRow(entry: ThreadSizeEntry): AdminDataRow {
  return {
    id: entry.id,
    tab: entry.kind as DataTab,
    family: entry.family as ThreadFamily | undefined,
    hoseKind: entry.hoseKind as 'hydraulic' | 'air' | undefined,
    primary: entry.primary,
    secondary: entry.secondary,
    meta: entry.meta,
    note: entry.note,
    data: entry.data,
    sortOrder: entry.sortOrder,
    enabled: entry.enabled,
    dbEntry: entry,
  };
}

function entryData<T>(entry: ThreadSizeEntry): T | null {
  return entry.data && typeof entry.data === 'object' ? (entry.data as T) : null;
}

function firstNumber(value: string) {
  const matched = value.match(/\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function entryToThreadSpec(entry: ThreadSizeEntry): ThreadSpec {
  const data = entryData<ThreadSpec>(entry);
  if (data?.size && typeof data.majorMm === 'number') return data;
  return {
    family: (entry.family as ThreadFamily) || 'metric',
    familyLabel: entry.secondary || entry.family || '螺纹',
    size: entry.primary,
    majorMm: firstNumber(entry.meta),
    seal: entry.meta || '待确认',
    note: entry.note,
  };
}

function entryToPipeSpec(entry: ThreadSizeEntry): PipeSpec {
  const data = entryData<PipeSpec>(entry);
  if (data?.dn && typeof data.odMm === 'number') return data;
  return {
    dn: entry.primary,
    inch: entry.secondary.replace(/"/g, ''),
    odMm: firstNumber(entry.meta),
    commonUse: entry.note,
  };
}

function entryToHoseSpec(entry: ThreadSizeEntry): HoseSpec {
  const data = entryData<HoseSpec>(entry);
  if (data?.dash && typeof data.innerMm === 'number') return data;
  return {
    kind: entry.hoseKind === 'air' ? '气管' : '液压油管',
    dash: entry.primary,
    nominalInch: entry.secondary,
    innerMm: firstNumber(entry.meta),
    outerRangeMm: '',
    pressureMpa: entry.meta,
    jic: '',
    commonUse: entry.note,
  };
}

function entryToFittingSpec(entry: ThreadSizeEntry): FittingSpec {
  const data = entryData<FittingSpec>(entry);
  if (data?.code) return data;
  return {
    code: entry.primary,
    category: entry.secondary,
    form: '直咀',
    threadType: entry.meta,
    threadCodes: '',
    threadSpecs: '',
    insertCodes: '',
    hoseSizes: '',
    seal: '',
    remark: entry.note,
  };
}

const TABLE_SCROLL =
  'min-h-0 flex-1 max-w-full overflow-auto border-y border-outline-variant/10 overscroll-contain [-webkit-overflow-scrolling:touch] md:border-x';
const TABLE_BASE =
  'min-w-full border-separate border-spacing-0 text-left text-[13px] md:text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-outline-variant/8 [&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-outline-variant/10';
const TABLE_HEAD = 'text-on-surface';
const TABLE_CARD = 'flex h-full min-h-0 flex-col overflow-hidden bg-transparent';
const TABLE_TH =
  'sticky top-0 z-20 bg-surface-container-low px-4 py-3 text-xs font-bold tracking-wide text-on-surface shadow-[0_1px_0_rgba(0,0,0,0.08)] md:text-[13px]';
const TABLE_FIRST_TH =
  'sticky left-0 top-0 z-30 bg-surface-container-low px-4 py-3 text-xs font-bold tracking-wide text-on-surface shadow-[1px_0_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.08)] md:text-[13px]';
const TABLE_FIRST_TD = 'sticky left-0 z-10 bg-surface px-4 py-3 font-semibold shadow-[1px_0_0_rgba(0,0,0,0.05)]';
const TABLE_TD = 'px-4 py-3';
const TABLE_LONG_TH = `${TABLE_TH} min-w-72`;
const TABLE_LONG_TD = `${TABLE_TD} min-w-72 max-w-[420px] leading-6 text-on-surface-variant [white-space:normal]`;
const TABLE_HEADER = 'flex items-center justify-between gap-3 bg-transparent px-1 pb-3 pt-1 md:px-0';

const PRIORITY_TERMS: Record<ToolTab, string[]> = {
  thread: ['G1/4', 'G1/2', 'R1/4', 'R1/2', 'NPT1/4', 'JIC-06', 'JIC-08', 'M16', 'M20', 'M12'],
  pipe: ['DN15', 'DN20', 'DN25', 'DN32', 'DN40', 'DN50', 'DN10', 'DN8'],
  hose: ['-04', '-06', '-08', '-10', '-12', '-03', '-16'],
  fitting: ['26711', '26791', '26741', '20711', '20411', '20611', '29611', '22611'],
};

const COMMON_PIPE_NAME_ALIASES: Record<string, string[]> = {
  一分: ['g1/8', 'r1/8', 'rc1/8', 'pt1/8', 'zg1/8', 'npt1/8', 'dn6'],
  '1分': ['g1/8', 'r1/8', 'rc1/8', 'pt1/8', 'zg1/8', 'npt1/8', 'dn6'],
  二分: ['g1/4', 'r1/4', 'rc1/4', 'pt1/4', 'zg1/4', 'npt1/4', 'dn8'],
  '2分': ['g1/4', 'r1/4', 'rc1/4', 'pt1/4', 'zg1/4', 'npt1/4', 'dn8'],
  三分: ['g3/8', 'r3/8', 'rc3/8', 'pt3/8', 'zg3/8', 'npt3/8', 'dn10'],
  '3分': ['g3/8', 'r3/8', 'rc3/8', 'pt3/8', 'zg3/8', 'npt3/8', 'dn10'],
  四分: ['g1/2', 'r1/2', 'rc1/2', 'pt1/2', 'zg1/2', 'npt1/2', 'dn15'],
  半寸: ['g1/2', 'r1/2', 'rc1/2', 'pt1/2', 'zg1/2', 'npt1/2', 'dn15'],
  '4分': ['g1/2', 'r1/2', 'rc1/2', 'pt1/2', 'zg1/2', 'npt1/2', 'dn15'],
  六分: ['g3/4', 'r3/4', 'rc3/4', 'pt3/4', 'zg3/4', 'npt3/4', 'dn20'],
  '6分': ['g3/4', 'r3/4', 'rc3/4', 'pt3/4', 'zg3/4', 'npt3/4', 'dn20'],
  '1寸': ['g1', 'r1', 'rc1', 'pt1', 'zg1', 'npt1', 'dn25'],
  一寸: ['g1', 'r1', 'rc1', 'pt1', 'zg1', 'npt1', 'dn25'],
  一吋: ['g1', 'r1', 'rc1', 'pt1', 'zg1', 'npt1', 'dn25'],
  '1.2寸': ['g1-1/4', 'r1-1/4', 'rc1-1/4', 'pt1-1/4', 'zg1-1/4', 'npt1-1/4', 'dn32'],
  一寸二: ['g1-1/4', 'r1-1/4', 'rc1-1/4', 'pt1-1/4', 'zg1-1/4', 'npt1-1/4', 'dn32'],
  '1.5寸': ['g1-1/2', 'r1-1/2', 'rc1-1/2', 'pt1-1/2', 'zg1-1/2', 'npt1-1/2', 'dn40'],
  一寸半: ['g1-1/2', 'r1-1/2', 'rc1-1/2', 'pt1-1/2', 'zg1-1/2', 'npt1-1/2', 'dn40'],
  '2寸': ['g2', 'r2', 'rc2', 'pt2', 'zg2', 'npt2', 'dn50'],
  两寸: ['g2', 'r2', 'rc2', 'pt2', 'zg2', 'npt2', 'dn50'],
  二寸: ['g2', 'r2', 'rc2', 'pt2', 'zg2', 'npt2', 'dn50'],
  '3寸': ['g3', 'r3', 'rc3', 'pt3', 'zg3', 'npt3', 'dn80'],
  三寸: ['g3', 'r3', 'rc3', 'pt3', 'zg3', 'npt3', 'dn80'],
  '4寸': ['g4', 'r4', 'rc4', 'pt4', 'zg4', 'npt4', 'dn100'],
  四寸: ['g4', 'r4', 'rc4', 'pt4', 'zg4', 'npt4', 'dn100'],
  '5寸': ['g5', 'r5', 'rc5', 'pt5', 'zg5', 'npt5', 'dn125'],
  五寸: ['g5', 'r5', 'rc5', 'pt5', 'zg5', 'npt5', 'dn125'],
  '6寸': ['g6', 'r6', 'rc6', 'pt6', 'zg6', 'npt6', 'dn150'],
  六寸: ['g6', 'r6', 'rc6', 'pt6', 'zg6', 'npt6', 'dn150'],
  '8寸': ['dn200'],
  八寸: ['dn200'],
  '10寸': ['dn250'],
  十寸: ['dn250'],
  '12寸': ['dn300'],
  十二寸: ['dn300'],
};

function commonPipeNameAliases(value: string) {
  const q = normalizeText(value);
  if (!q) return undefined;
  const compact = q.replace(/(?:管螺纹|螺纹|管径|外牙|内牙|接口|接头|管|牙)+$/g, '');
  if (COMMON_PIPE_NAME_ALIASES[compact]) return COMMON_PIPE_NAME_ALIASES[compact];

  const matchedName = Object.keys(COMMON_PIPE_NAME_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((name) => q.includes(name));
  return matchedName ? COMMON_PIPE_NAME_ALIASES[matchedName] : undefined;
}

function threadPitchText(spec: ThreadSpec) {
  if (spec.pitchMm) return `${spec.pitchMm} mm`;
  return `${spec.tpi} 牙/英寸`;
}

function pitchToMm(spec: ThreadSpec) {
  return spec.pitchMm || (spec.tpi ? 25.4 / spec.tpi : 0);
}

function isMetricThreadFamily(family: ThreadFamily) {
  return (
    family === 'metric' || family === 'metricH' || family === 'metricA' || family === 'metricC' || family === 'metricD'
  );
}

function threadInnerReference(spec: ThreadSpec) {
  const commonTapDrills: Record<string, string> = {
    'M5×0.8': '4.2 mm',
    'M6×1': '5.0 mm',
    'M8×1.25': '6.8 mm',
    'M10×1': '9.0 mm',
    'M12×1.5': '10.5 mm',
    'M14×1.5': '12.5 mm',
    'M16×1.5': '14.5 mm',
    'M18×1.5': '16.5 mm',
    'M20×1.5': '18.5 mm',
    'M22×1.5': '20.5 mm',
    'M24×1.5': '22.5 mm',
    'M27×2': '25.0 mm',
    'M30×2': '28.0 mm',
  };
  if (isMetricThreadFamily(spec.family))
    return commonTapDrills[spec.size] || `${(spec.majorMm - pitchToMm(spec)).toFixed(1)} mm`;

  const pitch = pitchToMm(spec);
  if (!pitch) return '-';
  const minor = threadInnerValue(spec);
  if (!minor) return '-';
  if (spec.family === 'r' || spec.family === 'npt') return `${minor.toFixed(2)} mm（基准位置）`;
  if (spec.family === 'jic') return `${minor.toFixed(2)} mm（UN/UNF 参考小径）`;
  return `${minor.toFixed(2)} mm`;
}

function threadInnerValue(spec: ThreadSpec) {
  const pitch = pitchToMm(spec);
  if (!pitch) return null;
  if (isMetricThreadFamily(spec.family)) return spec.majorMm - pitch;
  if (spec.family === 'g' || spec.family === 'r') return spec.majorMm - pitch * 1.28;
  if (spec.family === 'npt') return spec.majorMm - pitch * 1.3;
  if (spec.family === 'jic') return spec.majorMm - pitch * 1.08;
  return spec.majorMm - pitch * 1.2;
}

function threadAngleText(spec: ThreadSpec) {
  if (spec.family === 'g' || spec.family === 'r') return '55°';
  return '60°';
}

function threadTaperText(spec: ThreadSpec) {
  if (spec.family === 'metricH') return '直牙，H型密封';
  if (spec.family === 'metricA') return '直牙，A型密封';
  if (spec.family === 'metricC') return '直牙，C型密封';
  if (spec.family === 'metricD') return '直牙，D型密封';
  if (spec.family === 'r') return '1:16 锥管';
  if (spec.family === 'npt') return '1:16 锥管';
  if (spec.family === 'jic') return '直牙，37°锥面';
  return '直牙';
}

function measurementFamilyFromText(value: string): 'all' | ThreadFamily {
  const normalized = normalizeText(value);
  if (/(h型|公制h|metric-h)/i.test(value)) return 'metricH';
  if (/(a型|公制a|metric-a)/i.test(value)) return 'metricA';
  if (/(c型|公制c|metric-c)/i.test(value)) return 'metricC';
  if (/(d型|公制d|metric-d)/i.test(value)) return 'metricD';
  if (/(jic|37°|37度|unf|un\b)/i.test(value)) return 'jic';
  if (/(npt|美制锥|美标锥|60°锥|60度锥)/i.test(value)) return 'npt';
  if (/(^|[^a-z])(?:r|rc|pt|zg)\d|英制锥|日制锥|55°锥|55度锥/i.test(normalized)) return 'r';
  if (/(^|[^a-z])g\d|bsp|bspp|管螺纹|英制直|55°|55度/i.test(normalized)) return 'g';
  if (/(^|[^a-z])m\d|公制|metric/i.test(normalized)) return 'metric';
  return 'all';
}

function parseMeasurementQuery(value: string): MeasurementQuery {
  const text = value.trim();
  if (!text) return { hasMeasurement: false };

  const normalized = normalizeText(text);
  const quickMeasurementWord =
    /(外螺纹|外牙|公螺纹|公牙|外径|大径|内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|钻孔|攻牙|小径|牙距|螺距|牙\/英寸|牙每英寸|每英寸|毫米|mm|tpi|\bod\b|\bid\b|牙数|牙)/i.test(
      text,
    );
  if (/^\d+(?:-\d+)?\/\d+$/.test(normalized) && !quickMeasurementWord) return { hasMeasurement: false };
  if (/^(?:m|g|r|rc|pt|zg|npt|jic)[\d-]/.test(normalized) && !quickMeasurementWord) return { hasMeasurement: false };
  if ((commonPipeNameAliases(text) || /^dn\d+/i.test(normalized) || /[寸分]/.test(text)) && !quickMeasurementWord)
    return { hasMeasurement: false };
  const hasInnerIntent = /(内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|钻孔|攻牙|小径|\bid\b)/i.test(text);
  const hasOuterIntent = /(外螺纹|外牙|公螺纹|公牙|外径|大径|\bod\b)/i.test(text);
  const hasPitchIntent = /(牙距|螺距|pitch|牙\/英寸|牙每英寸|每英寸|tpi|牙数|牙\b)/i.test(text);
  const hasMeasurementWord =
    /(外螺纹|外牙|公螺纹|公牙|外径|大径|内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|钻孔|攻牙|小径|牙距|螺距|牙\/英寸|牙每英寸|每英寸|毫米|mm|tpi|\bod\b|\bid\b|牙数|牙)/i.test(
      text,
    );
  const looksLikeMeasurementOnly =
    /^[\s\d.,，;；:/\\+\-毫米牙距螺距外径大径内径底孔小径内孔孔径钻孔攻牙牙英寸mtpiodid]+$/i.test(normalized);
  const numberMatches = [...text.matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter((num) => Number.isFinite(num) && num > 0);

  if (!numberMatches.length || (!hasMeasurementWord && !looksLikeMeasurementOnly)) {
    return { hasMeasurement: false };
  }

  const outerMatch = text.match(/(?:外螺纹|外牙|公螺纹|公牙|外径|大径|\bod\b)\s*[:：=]?\s*(\d+(?:\.\d+)?)/i);
  const innerMatch = text.match(
    /(?:内螺纹|内牙|母螺纹|母牙|内孔|孔径|内径|底孔|钻孔|攻牙|小径|\bid\b)\s*[:：=]?\s*(\d+(?:\.\d+)?)/i,
  );
  const tpiMatch = text.match(
    /(?:tpi|牙数|牙\/英寸|牙每英寸|每英寸)\s*[:：=]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:牙\/英寸|牙每英寸|每英寸|tpi|牙\b)/i,
  );
  const pitchMatch = text.match(/(?:牙距|螺距|pitch)\s*[:：=]?\s*(\d+(?:\.\d+)?)(?!\s*(?:牙|tpi))/i);

  let outer = outerMatch ? Number(outerMatch[1]) : undefined;
  let inner = innerMatch ? Number(innerMatch[1]) : undefined;
  let pitchMm = pitchMatch ? Number(pitchMatch[1]) : undefined;
  let tpi: number | undefined;
  let pitchLabel = pitchMm ? `${pitchMm} mm` : '';

  if (tpiMatch) {
    tpi = Number(tpiMatch[1] || tpiMatch[2]);
    pitchMm = 25.4 / tpi;
    pitchLabel = `${tpi} 牙/英寸`;
  }

  const used = new Set<number>();
  if (outer !== undefined) used.add(outer);
  if (inner !== undefined) used.add(inner);
  if (pitchMatch) used.add(Number(pitchMatch[1]));
  if (tpiMatch) used.add(Number(tpiMatch[1] || tpiMatch[2]));
  const freeNumbers = numberMatches.filter((num) => !used.has(num));

  if (hasPitchIntent && !hasInnerIntent && !hasOuterIntent) {
    const pitchValue = freeNumbers.shift();
    if (pitchMm === undefined && pitchValue !== undefined) {
      if (pitchValue >= 4) {
        tpi = pitchValue;
        pitchMm = 25.4 / pitchValue;
        pitchLabel = `${pitchValue} 牙/英寸`;
      } else {
        pitchMm = pitchValue;
        pitchLabel = `${pitchValue} mm`;
      }
    }
  } else if (hasInnerIntent && !hasOuterIntent) {
    if (inner === undefined && freeNumbers.length) inner = freeNumbers.shift();
    if (outer === undefined && freeNumbers.length >= 2) outer = freeNumbers.shift();
  } else {
    if (outer === undefined && freeNumbers.length) outer = freeNumbers.shift();
    if (inner === undefined && freeNumbers.length >= 2) inner = freeNumbers.shift();
  }
  if (pitchMm === undefined && freeNumbers.length) {
    const pitchValue = freeNumbers.shift();
    if (pitchValue !== undefined) {
      if (pitchValue >= 4) {
        tpi = pitchValue;
        pitchMm = 25.4 / pitchValue;
        pitchLabel = `${pitchValue} 牙/英寸`;
      } else {
        pitchMm = pitchValue;
        pitchLabel = `${pitchValue} mm`;
      }
    }
  }

  const hasMeasurement = outer !== undefined || inner !== undefined || pitchMm !== undefined;
  return { hasMeasurement, outer, inner, pitchMm, tpi, pitchLabel, family: measurementFamilyFromText(text) };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[×＊*]/g, 'x')
    .replace(/[，。；：、]/g, '')
    .replace(/\s+/g, '');
}

function normalizeMetricPitchZero(value: string) {
  return value.replace(/(m\d+x\d+)\.0(?=$|[^\d])/g, '$1');
}

function queryAliases(value: string) {
  const q = normalizeText(value);
  const aliases = new Set([q]);
  if (!q) return [];

  aliases.add(normalizeMetricPitchZero(q));
  aliases.add(q.replace(/^dash/, '-'));
  aliases.add(q.replace(/^dash0?/, '-0'));
  aliases.add(q.replace(/^jic0?/, 'jic-0'));
  aliases.add(q.replace(/^dn/, 'dn'));
  if (/^\d+(?:-\d+)?\/\d+$/.test(q)) {
    aliases.add(`g${q}`);
    aliases.add(`r${q}`);
    aliases.add(`rc${q}`);
    aliases.add(`pt${q}`);
    aliases.add(`zg${q}`);
    aliases.add(`npt${q}`);
  }

  const hydraulicMetricTypeMatch = q.match(/^m(\d+)([hacd])型$/);
  if (hydraulicMetricTypeMatch) {
    aliases.add(`m${hydraulicMetricTypeMatch[1]}`);
    aliases.add(`${hydraulicMetricTypeMatch[2]}型`);
  }

  commonPipeNameAliases(value)?.forEach((alias) => aliases.add(alias));

  const dashMatch = q.match(/^(?:dash|-)?0?(\d{1,2})号?$/);
  if (dashMatch) aliases.add(`-${dashMatch[1].padStart(2, '0')}`);

  const tubeSizeMatch = q.match(/(?:φ|直径)?(\d+(?:\.\d+)?)mm?(?:气管|pu管|管)?|(?:气管|pu管)(\d+(?:\.\d+)?)/);
  const tubeSize = tubeSizeMatch?.[1] || tubeSizeMatch?.[2];
  if (tubeSize) {
    aliases.add(`φ${tubeSize}`);
    aliases.add(`${tubeSize}mm`);
    aliases.add(tubeSize);
  }

  return [...aliases].filter(Boolean);
}

function includesAnyAlias(text: string, aliases: string[]) {
  const normalized = normalizeText(text);
  return aliases.some((alias) => normalized.includes(alias));
}

function threadSizeTokens(spec: ThreadSpec) {
  const tokens = spec.size.includes(' / ')
    ? spec.size
        .split(/\s+\/\s+/)
        .map(normalizeText)
        .filter(Boolean)
    : [normalizeText(spec.size)];
  return [...new Set(tokens.flatMap((token) => [token, normalizeMetricPitchZero(token)]))];
}

function matchScore(text: string, query: string) {
  const aliases = queryAliases(query);
  const q = aliases[0] || '';
  if (!q) return 0;
  const normalized = normalizeText(text);
  if (aliases.some((alias) => normalized === alias)) return -400;
  if (aliases.some((alias) => normalized.startsWith(alias))) return -300;
  if (aliases.some((alias) => normalized.includes(alias))) return -200;
  return 0;
}

function priorityScore(text: string, tab: ToolTab) {
  const normalized = normalizeText(text);
  const index = PRIORITY_TERMS[tab].findIndex((term) => normalized.includes(normalizeText(term)));
  return index === -1 ? 1000 : index;
}

function rankedItems<T>(
  items: T[],
  query: string,
  tab: ToolTab,
  getText: (item: T) => string,
  tieBreaker?: (a: T, b: T) => number,
) {
  const q = normalizeText(query);
  return [...items].sort((a, b) => {
    if (!q && tieBreaker) return tieBreaker(a, b);
    const aText = getText(a);
    const bText = getText(b);
    return (
      matchScore(aText, q) - matchScore(bText, q) ||
      tieBreaker?.(a, b) ||
      priorityScore(aText, tab) - priorityScore(bText, tab) ||
      0
    );
  });
}

function compareThreadSizeAsc(a: ThreadSpec, b: ThreadSpec) {
  return (
    a.majorMm - b.majorMm || pitchToMm(a) - pitchToMm(b) || a.familyLabel.localeCompare(b.familyLabel, 'zh-Hans-CN')
  );
}

function comparePipeSizeAsc(a: PipeSpec, b: PipeSpec) {
  return a.odMm - b.odMm;
}

function compareHoseSizeAsc(a: HoseSpec, b: HoseSpec) {
  return a.innerMm - b.innerMm || a.dash.localeCompare(b.dash, 'zh-Hans-CN');
}

function compareFittingCodeAsc(a: FittingSpec, b: FittingSpec) {
  return Number(a.code) - Number(b.code) || a.form.localeCompare(b.form, 'zh-Hans-CN');
}

function detectToolTab(value: string, fallback: ToolTab): ToolTab {
  const q = normalizeText(value);
  const aliases = queryAliases(value);
  if (!q) return fallback;
  if (
    /^\d{5}(?:-\d{2}){0,2}$/.test(q) ||
    q.includes('扣压') ||
    q.includes('插芯') ||
    q.includes('直咀') ||
    q.includes('弯咀') ||
    q.includes('美制c型') ||
    q.includes('公制c型') ||
    q.includes('公制d型') ||
    q.includes('公制h型')
  )
    return 'fitting';
  if (commonPipeNameAliases(value) || q.includes('几分') || q.includes('几寸')) return 'thread';
  if (q.startsWith('dn') || q.includes('管径')) return 'pipe';
  if (
    aliases.some((alias) => /^-\d+/.test(alias) || alias.startsWith('φ')) ||
    q.includes('油管') ||
    q.includes('气管') ||
    q.includes('管路') ||
    q.includes('pu管') ||
    q.includes('液压软管') ||
    q.includes('dash')
  )
    return 'hose';
  if (/^\d+(?:-\d+)?\/\d+$/.test(q)) return 'thread';
  if (
    aliases.some((alias) => /^(g|r|rc|pt|zg|npt|jic|m)\d/.test(alias)) ||
    q.includes('h型') ||
    q.includes('a型') ||
    q.includes('c型') ||
    q.includes('d型') ||
    q.includes('unf') ||
    q.includes('螺纹')
  )
    return 'thread';
  if (parseMeasurementQuery(value).hasMeasurement) return 'thread';
  return fallback;
}

function familyFromQuery(value: string): 'all' | ThreadFamily {
  if (commonPipeNameAliases(value)) return 'all';
  const q = normalizeText(value);
  if (q.includes('h型')) return 'metricH';
  if (q.includes('a型')) return 'metricA';
  if (q.includes('c型')) return 'metricC';
  if (q.includes('d型')) return 'metricD';
  const aliases = queryAliases(value);
  if (aliases.some((alias) => alias.startsWith('g'))) return 'g';
  if (
    aliases.some(
      (alias) => alias.startsWith('r') || alias.startsWith('rc') || alias.startsWith('pt') || alias.startsWith('zg'),
    )
  )
    return 'r';
  if (aliases.some((alias) => alias.startsWith('npt'))) return 'npt';
  if (aliases.some((alias) => alias.startsWith('jic'))) return 'jic';
  if (aliases.some((alias) => alias.startsWith('m'))) return 'metric';
  return 'all';
}

export default function ThreadSizeToolPage() {
  useDocumentTitle('规格速查');
  const { toast } = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [activeTab, setActiveTab] = useState<ToolTab>('thread');
  const [family, setFamily] = useState<'all' | ThreadFamily>('all');
  const [hoseKind, setHoseKind] = useState<'all' | 'hydraulic' | 'air'>('all');
  const [query, setQuery] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementCategory, setManagementCategory] = useState('thread:all');
  const [managementQuery, setManagementQuery] = useState('');
  const [editingEntry, setEditingEntry] = useState<ThreadSizeEntry | 'new' | null>(null);
  const [entryDraft, setEntryDraft] = useState({
    kind: 'thread' as DataTab,
    family: 'metric',
    hoseKind: '',
    primary: '',
    secondary: '',
    meta: '',
    note: '',
    dataText: '{}',
    sortOrder: 0,
    enabled: true,
  });
  const {
    data: publicData,
    error: publicError,
    isLoading: publicLoading,
    mutate: mutatePublicData,
  } = useSWR('thread-size-public', () => threadSizeApi.listPublic());
  const { data: managementData, mutate: mutateManagementData } = useSWR(
    isAdmin && managementOpen ? 'thread-size-admin' : null,
    () => threadSizeApi.listAdmin(),
  );
  const measurementQuery = useMemo(() => parseMeasurementQuery(query), [query]);
  const detectedTab = detectToolTab(query, activeTab);
  const visibleTab = query.trim() ? detectedTab : activeTab;
  const dbEntries = useMemo(() => publicData?.items || [], [publicData?.items]);
  const adminEntries = useMemo(() => managementData?.items || dbEntries, [dbEntries, managementData?.items]);
  const threadItems = useMemo(
    () => dbEntries.filter((item) => item.kind === 'thread').map(entryToThreadSpec),
    [dbEntries],
  );
  const pipeItems = useMemo(() => dbEntries.filter((item) => item.kind === 'pipe').map(entryToPipeSpec), [dbEntries]);
  const hoseItems = useMemo(() => dbEntries.filter((item) => item.kind === 'hose').map(entryToHoseSpec), [dbEntries]);
  const fittingItems = useMemo(
    () => dbEntries.filter((item) => item.kind === 'fitting').map(entryToFittingSpec),
    [dbEntries],
  );
  const hasTechnicalData =
    threadItems.length > 0 || pipeItems.length > 0 || hoseItems.length > 0 || fittingItems.length > 0;
  const adminRows = useMemo<AdminDataRow[]>(() => {
    return adminEntries.map(entryToAdminRow);
  }, [adminEntries]);
  const adminCounts = useMemo(
    () =>
      CATEGORY_FILTERS.reduce<Record<string, number>>((acc, tab) => {
        acc[tab.key] = adminRows.filter((row) => matchesAdminFilter(row, tab.key)).length;
        return acc;
      }, {}),
    [adminRows],
  );
  const visibleAdminRows = useMemo(
    () =>
      adminRows.filter(
        (row) => matchesAdminFilter(row, managementCategory) && includesAdminQuery(row, managementQuery),
      ),
    [adminRows, managementCategory, managementQuery],
  );
  const refreshThreadSizeData = async () => {
    await Promise.all([mutatePublicData(), mutateManagementData()]);
  };
  const openEntryEditor = (entry?: ThreadSizeEntry) => {
    if (entry) {
      setEditingEntry(entry);
      setEntryDraft({
        kind: entry.kind,
        family: entry.family || '',
        hoseKind: entry.hoseKind || '',
        primary: entry.primary,
        secondary: entry.secondary,
        meta: entry.meta,
        note: entry.note,
        dataText: JSON.stringify(entry.data || {}, null, 2),
        sortOrder: entry.sortOrder || 0,
        enabled: entry.enabled,
      });
      return;
    }
    const applied = CATEGORY_FILTERS.find((item) => item.key === managementCategory)?.apply();
    setEditingEntry('new');
    setEntryDraft({
      kind: applied?.tab || 'thread',
      family: applied?.family && applied.family !== 'all' ? applied.family : '',
      hoseKind: applied?.hoseKind && applied.hoseKind !== 'all' ? applied.hoseKind : '',
      primary: '',
      secondary: '',
      meta: '',
      note: '',
      dataText: '{}',
      sortOrder: adminRows.length + 1,
      enabled: true,
    });
  };
  const saveEntryDraft = async () => {
    try {
      const parsedData = entryDraft.dataText.trim() ? JSON.parse(entryDraft.dataText) : {};
      const payload = {
        kind: entryDraft.kind,
        family: entryDraft.family || null,
        hoseKind: entryDraft.hoseKind || null,
        primary: entryDraft.primary,
        secondary: entryDraft.secondary,
        meta: entryDraft.meta,
        note: entryDraft.note,
        data: parsedData,
        sortOrder: entryDraft.sortOrder,
        enabled: entryDraft.enabled,
      };
      if (editingEntry === 'new') await threadSizeApi.create(payload);
      else if (editingEntry) await threadSizeApi.update(editingEntry.id, payload);
      toast('规格数据已保存', 'success');
      setEditingEntry(null);
      await refreshThreadSizeData();
    } catch (err) {
      toast(err instanceof SyntaxError ? '结构化 JSON 格式不正确' : '保存失败', 'error');
    }
  };
  const deleteEntry = async (entry: ThreadSizeEntry) => {
    if (!window.confirm(`确定删除「${entry.primary}」吗？`)) return;
    try {
      await threadSizeApi.remove(entry.id);
      toast('规格数据已删除', 'success');
      await refreshThreadSizeData();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const filteredThreads = useMemo(() => {
    const aliases = measurementQuery.hasMeasurement ? [] : queryAliases(query);
    const commonNameAliases = commonPipeNameAliases(query)?.filter((alias) => !alias.startsWith('dn'));
    const items = threadItems.filter((item) => {
      const queryFamily = familyFromQuery(query);
      const activeFamily = query.trim() ? queryFamily : family;
      if (activeFamily !== 'all' && item.family !== activeFamily) return false;
      if (commonNameAliases?.length) return commonNameAliases.some((alias) => threadSizeTokens(item).includes(alias));
      if (!aliases.length) return true;
      return includesAnyAlias(
        `${item.familyLabel}${item.size}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`,
        aliases,
      );
    });
    if (commonNameAliases?.length) {
      return [...items].sort((a, b) => {
        const aIndex = Math.min(
          ...threadSizeTokens(a)
            .map((token) => commonNameAliases.indexOf(token))
            .filter((index) => index >= 0),
        );
        const bIndex = Math.min(
          ...threadSizeTokens(b)
            .map((token) => commonNameAliases.indexOf(token))
            .filter((index) => index >= 0),
        );
        return aIndex - bIndex || compareThreadSizeAsc(a, b);
      });
    }
    return rankedItems(
      items,
      query,
      'thread',
      (item) =>
        `${item.size}${item.familyLabel}${item.seal}${item.note}${threadAngleText(item)}${threadTaperText(item)}`,
      compareThreadSizeAsc,
    );
  }, [family, measurementQuery.hasMeasurement, query, threadItems]);

  const matchedThreads = useMemo(() => {
    const measuredDiameter = measurementQuery.outer || 0;
    const measuredInnerDiameter = measurementQuery.inner || 0;
    const measuredPitchMm = measurementQuery.pitchMm || null;
    const hasOuter = !!measurementQuery.outer;
    const hasInner = !!measurementQuery.inner;
    const hasPitch = !!measurementQuery.pitchMm;
    if (!hasOuter && !hasInner && !hasPitch) return [];
    const activeFamily =
      measurementQuery.family && measurementQuery.family !== 'all' ? measurementQuery.family : family;

    return threadItems
      .filter((item) => activeFamily === 'all' || item.family === activeFamily)
      .map((item) => {
        const diameterDiff = hasOuter ? Math.abs(item.majorMm - measuredDiameter) : 0;
        const innerValue = threadInnerValue(item);
        const innerDiff = hasInner && innerValue ? Math.abs(innerValue - measuredInnerDiameter) : 0;
        const itemPitch = pitchToMm(item);
        const pitchDiff = measuredPitchMm && itemPitch ? Math.abs(itemPitch - measuredPitchMm) : 0;
        const missingInnerPenalty = hasInner && !innerValue ? 20 : 0;
        const missingPitchPenalty = hasPitch && !itemPitch ? 20 : 0;
        const score = diameterDiff * 1.8 + innerDiff * 1.5 + pitchDiff * 6 + missingInnerPenalty + missingPitchPenalty;
        return { item, diameterDiff, innerDiff, pitchDiff, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);
  }, [
    family,
    measurementQuery.family,
    measurementQuery.inner,
    measurementQuery.outer,
    measurementQuery.pitchMm,
    threadItems,
  ]);

  const filteredPipes = useMemo(() => {
    const aliases = queryAliases(query);
    const items = aliases.length
      ? pipeItems.filter((item) => includesAnyAlias(`${item.dn}${item.inch}${item.odMm}${item.commonUse}`, aliases))
      : pipeItems;
    return rankedItems(
      items,
      query,
      'pipe',
      (item) => `${item.dn}${item.inch}${item.odMm}${item.commonUse}`,
      comparePipeSizeAsc,
    );
  }, [pipeItems, query]);

  const filteredHoses = useMemo(() => {
    const aliases = queryAliases(query);
    const scopedHoses =
      !query.trim() && hoseKind !== 'all'
        ? hoseItems.filter((item) => (hoseKind === 'air' ? item.kind === '气管' : item.kind !== '气管'))
        : hoseItems;
    const items = aliases.length
      ? scopedHoses.filter((item) =>
          includesAnyAlias(
            `${item.kind || '液压油管'}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`,
            aliases,
          ),
        )
      : scopedHoses;
    return rankedItems(
      items,
      query,
      'hose',
      (item) =>
        `${item.kind || '液压油管'}${item.dash}${item.nominalInch}${item.innerMm}${item.outerRangeMm}${item.pressureMpa}${item.jic}${item.commonUse}`,
      compareHoseSizeAsc,
    );
  }, [hoseItems, hoseKind, query]);

  const filteredFittings = useMemo(() => {
    const aliases = queryAliases(query);
    const fittingSeriesCode = normalizeText(query).match(/^(\d{5})(?:-\d{2}){0,2}$/)?.[1];
    const items = aliases.length
      ? fittingItems.filter((item) => {
          if (fittingSeriesCode) return item.code === fittingSeriesCode;
          return includesAnyAlias(
            `${item.code}${item.category}${item.form}${item.threadType}${item.threadCodes}${item.threadSpecs}${item.insertCodes}${item.hoseSizes}${item.seal}${item.remark}`,
            aliases,
          );
        })
      : fittingItems;
    return rankedItems(
      items,
      query,
      'fitting',
      (item) =>
        `${item.code}${item.category}${item.form}${item.threadType}${item.threadCodes}${item.threadSpecs}${item.insertCodes}${item.hoseSizes}${item.seal}${item.remark}`,
      compareFittingCodeAsc,
    );
  }, [fittingItems, query]);

  const displayedThreads = filteredThreads;
  const visibleTechnicalCount =
    visibleTab === 'thread'
      ? displayedThreads.length
      : visibleTab === 'pipe'
        ? filteredPipes.length
        : visibleTab === 'hose'
          ? filteredHoses.length
          : filteredFittings.length;
  const showMeasurementResults = !showGuide && visibleTab === 'thread' && measurementQuery.hasMeasurement;
  const showTechnicalResults = !showGuide && !showMeasurementResults && visibleTechnicalCount > 0;
  const showDataError = !showGuide && !showMeasurementResults && Boolean(publicError);
  const showDatabaseEmpty =
    !showGuide && !showMeasurementResults && !publicError && !publicLoading && !hasTechnicalData;
  const showNoResults =
    !showGuide &&
    !showMeasurementResults &&
    hasTechnicalData &&
    query.trim().length >= 2 &&
    visibleTechnicalCount === 0;
  const fillMainSearch = (value: string) => {
    setQuery(value);
    setShowGuide(false);
  };
  const clearSearch = () => {
    setQuery('');
    setShowGuide(true);
  };
  const categoryKey = showGuide
    ? 'guide'
    : visibleTab === 'thread'
      ? `thread:${query.trim() ? familyFromQuery(query) : family}`
      : visibleTab === 'pipe'
        ? 'pipe'
        : visibleTab === 'fitting'
          ? 'fitting'
          : `hose:${hoseKind}`;
  const selectedCategoryKey =
    categoryKey === 'guide'
      ? 'guide'
      : CATEGORY_FILTERS.some((item) => item.key === categoryKey)
        ? categoryKey
        : visibleTab === 'thread'
          ? 'thread:all'
          : categoryKey;
  const handleCategoryClick = (key: string) => {
    if (key === 'guide') {
      setQuery('');
      setShowGuide(true);
      return;
    }
    const next = CATEGORY_FILTERS.find((item) => item.key === key)?.apply();
    if (!next) return;
    if (key === selectedCategoryKey && !query.trim()) return;
    setQuery('');
    setShowGuide(false);
    setActiveTab(next.tab);
    if (next.family) setFamily(next.family);
    if (next.hoseKind) setHoseKind(next.hoseKind);
  };
  const applyResultAsSearch = (value: string) => {
    setQuery(value);
    setShowGuide(false);
  };

  return (
    <AdminPageShell mobileMainClassName="overflow-hidden" mobileContentClassName="h-full min-h-0 !pb-[4.5rem]">
      <AdminManagementPage
        title="螺纹与管路速查"
        description="规格、俗称、测量值直接搜索"
        actions={
          isAdmin ? (
            <button
              type="button"
              onClick={() => setManagementOpen(true)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-xs font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="edit" size={14} />
              管理数据
            </button>
          ) : null
        }
        toolbar={
          <div className="grid min-w-0 items-center gap-3 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]">
            <label className="relative block w-full">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
              />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowGuide(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') clearSearch();
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="搜索规格、俗称、测量值..."
                className="h-10 w-full rounded-lg border border-outline-variant/25 bg-surface-container-lowest pl-9 pr-14 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary-container/60"
              />
              {query && (
                <button
                  onClick={clearSearch}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                >
                  清空
                </button>
              )}
            </label>
            <div className="min-w-0">
              <ResponsiveSectionTabs
                tabs={[{ key: 'guide', label: '使用指南' }, ...CATEGORY_FILTERS].map((item) => ({
                  value: item.key,
                  label: item.label,
                  icon:
                    item.key === 'guide'
                      ? 'search'
                      : item.key.startsWith('thread')
                        ? 'hexagon'
                        : item.key === 'pipe'
                          ? 'pipeline'
                          : item.key.startsWith('hose')
                            ? 'cat_hydraulic_hose'
                            : 'cat_crimp_fitting',
                }))}
                value={selectedCategoryKey}
                onChange={handleCategoryClick}
                mobileTitle="当前分类"
              />
            </div>
          </div>
        }
        contentClassName="overflow-hidden"
      >
        <AdminContentPanel
          scroll
          className="h-full flex min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent"
        >
          {/* ── Results ── */}
          <div
            key={`${showGuide ? 'guide' : visibleTab}:${showMeasurementResults ? 'measurement' : showDataError ? 'error' : showDatabaseEmpty ? 'database-empty' : showNoResults ? 'empty' : 'results'}`}
            className="admin-tab-panel min-h-0 flex-1 overflow-hidden"
          >
            {showGuide && (
              <section className="h-full overflow-y-auto overflow-x-hidden md:overflow-hidden">
                <div className="grid min-h-full gap-2 md:h-full md:min-h-0 md:grid-rows-[auto_minmax(0,1fr)] md:gap-3">
                  <div className="rounded-xl border border-outline-variant/12 bg-surface-container-low p-3 md:p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-container/70">
                      Quick Lookup
                    </p>
                    <h2 className="mt-1.5 text-xl font-black tracking-tight text-on-surface md:text-2xl">
                      先输入，再确认
                    </h2>
                    <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-on-surface-variant md:text-sm md:leading-6">
                      规格、俗称、DN、油管
                      Dash、接头编号和实测值都可以直接搜。点击下面示例会自动填入搜索框，适合现场快速反查。
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5 md:gap-2">
                      {['G1/2', '4分', 'DN25', 'M16×1.5', '-06'].map((item) => (
                        <button
                          key={item}
                          onClick={() => fillMainSearch(item)}
                          className="rounded-md border border-outline-variant/12 bg-surface px-2 py-1.5 text-[11px] font-semibold text-on-surface-variant transition-colors hover:border-primary-container/25 hover:bg-primary-container/8 hover:text-primary-container active:scale-95 md:px-3 md:text-xs"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid min-h-0 grid-cols-1 gap-1.5 min-[390px]:grid-cols-2 md:grid-cols-4 md:grid-rows-1 md:gap-3 md:overflow-hidden">
                    {[
                      {
                        title: '螺纹',
                        desc: '公制、G、R/PT、NPT、JIC 规格，查看外径、牙距、牙型角。',
                        icon: 'hexagon',
                        examples: ['G1/4', 'G1/2', 'R1/2', 'NPT1/4', 'M16×1.5'],
                      },
                      {
                        title: '俗称',
                        desc: '几分、几寸、DN 快速换算，适合现场口头规格确认。',
                        icon: 'pipeline',
                        examples: ['2分', '4分', '6分', '1寸', 'DN25'],
                      },
                      {
                        title: '测量',
                        desc: '输入卡尺外径、内螺纹小径或牙距，反推最接近螺纹。',
                        icon: 'straighten',
                        examples: ['外径13.1', '内螺纹18.6', '牙距1.5'],
                      },
                      {
                        title: '管路',
                        desc: '油管、气管、Dash、JIC 和扣压接头编号快速查。',
                        icon: 'cat_hydraulic_hose',
                        examples: ['-06', '-08', 'JIC-06', '20411', '26711'],
                      },
                    ].map((group) => (
                      <div
                        key={group.title}
                        className="flex min-h-[148px] flex-col overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low p-2.5 min-[390px]:min-h-[168px] md:min-h-0 md:p-4"
                      >
                        <div className="flex min-h-0 items-start gap-2 md:gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-primary-container md:h-9 md:w-9 md:rounded-xl">
                            <Icon name={group.icon} size={16} />
                          </span>
                          <div className="min-w-0">
                            <h3 className="text-[15px] font-black leading-tight text-on-surface md:text-lg">
                              {group.title}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-on-surface-variant md:mt-1.5 md:text-sm md:leading-5">
                              {group.desc}
                            </p>
                          </div>
                        </div>
                        <div className="mt-auto grid grid-cols-2 gap-1 pt-2 md:flex md:flex-wrap md:content-end md:gap-2 md:pt-3">
                          {group.examples.map((item) => (
                            <button
                              key={item}
                              onClick={() => fillMainSearch(item)}
                              className="min-w-0 truncate rounded-md bg-primary-container/8 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-primary-container transition-colors hover:bg-primary-container/14 active:scale-95 md:px-2.5 md:py-1.5 md:text-xs"
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── Measurement Results ── */}
            {showMeasurementResults && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div className={TABLE_HEADER}>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-bold text-on-surface">测量反推</h2>
                      <p className="line-clamp-1 text-[11px] text-on-surface-variant/60">按测量值匹配最接近的规格</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {measurementQuery.outer && (
                        <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                          外径 {measurementQuery.outer}mm
                        </span>
                      )}
                      {measurementQuery.inner && (
                        <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                          内径/小径 {measurementQuery.inner}mm
                        </span>
                      )}
                      {measurementQuery.pitchMm && (
                        <span className="rounded bg-surface-container-low px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                          {measurementQuery.pitchLabel || `${measurementQuery.pitchMm.toFixed(2)}mm`}
                        </span>
                      )}
                      {measurementQuery.family && measurementQuery.family !== 'all' && (
                        <span className="rounded bg-primary-container/10 px-1.5 py-0.5 text-[10px] text-primary-container">
                          {CATEGORY_FILTERS.find((item) => item.key === `thread:${measurementQuery.family}`)?.label ||
                            measurementQuery.family}
                        </span>
                      )}
                    </div>
                  </div>
                  {matchedThreads.length ? (
                    <div>
                      <div className={TABLE_SCROLL}>
                        <table className={`${TABLE_BASE} min-w-[860px]`}>
                          <thead className={TABLE_HEAD}>
                            <tr>
                              <th className={`${TABLE_FIRST_TH} min-w-28`}>结果</th>
                              <th className={`${TABLE_TH} min-w-40`}>规格</th>
                              <th className={`${TABLE_TH} min-w-32`}>类型</th>
                              <th className={`${TABLE_TH} min-w-28`}>外径差</th>
                              <th className={`${TABLE_TH} min-w-28`}>内径差</th>
                              <th className={`${TABLE_TH} min-w-28`}>牙距差</th>
                              <th className={`${TABLE_TH} min-w-44`}>结构</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-outline-variant/10">
                            {matchedThreads.map(({ item, diameterDiff, innerDiff, pitchDiff }, index) => (
                              <tr
                                key={item.size}
                                onClick={() => applyResultAsSearch(item.size)}
                                className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                              >
                                <td className={TABLE_FIRST_TD}>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${index === 0 ? 'bg-green-500/10 text-green-600' : 'bg-surface-container-high text-on-surface-variant'}`}
                                  >
                                    {index === 0 ? '最接近' : `第 ${index + 1}`}
                                  </span>
                                </td>
                                <td className={`${TABLE_TD} font-semibold`}>{item.size}</td>
                                <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                                <td className={`${TABLE_TD} tabular-nums`}>
                                  {measurementQuery.outer ? `${diameterDiff.toFixed(2)} mm` : '-'}
                                </td>
                                <td className={`${TABLE_TD} tabular-nums`}>
                                  {measurementQuery.inner ? `${innerDiff.toFixed(2)} mm` : '-'}
                                </td>
                                <td className={`${TABLE_TD} tabular-nums`}>
                                  {measurementQuery.pitchMm ? `${pitchDiff.toFixed(2)} mm` : '-'}
                                </td>
                                <td className={TABLE_TD}>
                                  {threadAngleText(item)} / {threadTaperText(item)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-8 text-center text-xs text-on-surface-variant">
                      暂未匹配到接近规格，可补充外径、内径/小径、牙距或牙数再试。
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Thread Results ── */}
            {showTechnicalResults && visibleTab === 'thread' && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[1260px]`}>
                      <thead className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-36`}>规格</th>
                          <th className={`${TABLE_TH} min-w-32`}>类型</th>
                          <th className={`${TABLE_TH} min-w-32`}>外径参考</th>
                          <th className={`${TABLE_TH} min-w-40`}>底孔/小径参考</th>
                          <th className={`${TABLE_TH} min-w-36`}>牙距 / 牙数</th>
                          <th className={`${TABLE_TH} min-w-24`}>牙型角</th>
                          <th className={`${TABLE_TH} min-w-40`}>锥度/结构</th>
                          <th className={`${TABLE_TH} min-w-40`}>密封方式</th>
                          <th className={TABLE_LONG_TH}>备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {displayedThreads.map((item) => (
                          <tr
                            key={`${item.family}-${item.size}`}
                            onClick={() => applyResultAsSearch(item.size)}
                            className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                          >
                            <td className={`${TABLE_FIRST_TD} min-w-36`}>{item.size}</td>
                            <td className={`${TABLE_TD} text-on-surface-variant`}>{item.familyLabel}</td>
                            <td className={`${TABLE_TD} tabular-nums`}>{item.majorMm.toFixed(3)} mm</td>
                            <td className={TABLE_TD}>{threadInnerReference(item)}</td>
                            <td className={TABLE_TD}>{threadPitchText(item)}</td>
                            <td className={TABLE_TD}>{threadAngleText(item)}</td>
                            <td className={TABLE_TD}>{threadTaperText(item)}</td>
                            <td className={TABLE_TD}>{item.seal}</td>
                            <td className={TABLE_LONG_TD}>{item.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ── Pipe Results ── */}
            {showTechnicalResults && visibleTab === 'pipe' && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[760px]`}>
                      <thead className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-24`}>DN</th>
                          <th className={`${TABLE_TH} min-w-28`}>英寸</th>
                          <th className={`${TABLE_TH} min-w-36`}>外径参考</th>
                          <th className={TABLE_LONG_TH}>常见用途</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {filteredPipes.map((item) => (
                          <tr
                            key={item.dn}
                            onClick={() => applyResultAsSearch(item.dn)}
                            className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                          >
                            <td className={`${TABLE_FIRST_TD} min-w-24`}>{item.dn}</td>
                            <td className={TABLE_TD}>{item.inch}"</td>
                            <td className={`${TABLE_TD} tabular-nums`}>Ø {item.odMm.toFixed(1)} mm</td>
                            <td className={TABLE_LONG_TD}>{item.commonUse}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ── Hose Results ── */}
            {showTechnicalResults && visibleTab === 'hose' && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[1180px]`}>
                      <thead className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-32`}>规格</th>
                          <th className={`${TABLE_TH} min-w-28`}>类型</th>
                          <th className={`${TABLE_TH} min-w-32`}>公称/外径</th>
                          <th className={`${TABLE_TH} min-w-28`}>内径</th>
                          <th className={`${TABLE_TH} min-w-36`}>外径范围</th>
                          <th className={`${TABLE_TH} min-w-36`}>常见压力</th>
                          <th className={`${TABLE_TH} min-w-48`}>常配接头</th>
                          <th className={TABLE_LONG_TH}>应用</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {filteredHoses.map((item) => (
                          <tr
                            key={item.dash}
                            onClick={() => applyResultAsSearch(item.dash)}
                            className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                          >
                            <td className={`${TABLE_FIRST_TD} min-w-32`}>
                              <span className="rounded-md bg-primary-container/10 px-2 py-1 font-semibold text-primary-container">
                                {item.dash}
                              </span>
                            </td>
                            <td className={TABLE_TD}>{item.kind || '液压油管'}</td>
                            <td className={TABLE_TD}>
                              {item.kind === '气管' ? item.nominalInch : `${item.nominalInch}"`}
                            </td>
                            <td className={`${TABLE_TD} tabular-nums`}>{item.innerMm.toFixed(1)} mm</td>
                            <td className={TABLE_TD}>Ø {item.outerRangeMm} mm</td>
                            <td className={TABLE_TD}>{item.pressureMpa} MPa</td>
                            <td className={`${TABLE_TD} font-medium`}>{item.jic}</td>
                            <td className={TABLE_LONG_TD}>{item.commonUse}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-outline-variant/10 px-4 py-3 text-xs leading-5 text-on-surface-variant/60">
                    油管压力会随层数、结构和品牌变化；气管压力会随 PU/PA 材质、温度和厂家规格变化，最终按具体样本确认。
                  </div>
                </div>
              </section>
            )}

            {/* ── Fitting Results ── */}
            {showTechnicalResults && visibleTab === 'fitting' && (
              <section className="h-full">
                <div className={TABLE_CARD}>
                  <div className={TABLE_SCROLL}>
                    <table className={`${TABLE_BASE} min-w-[1320px]`}>
                      <thead className={TABLE_HEAD}>
                        <tr>
                          <th className={`${TABLE_FIRST_TH} min-w-36`}>接头编号</th>
                          <th className={`${TABLE_TH} min-w-44`}>分类</th>
                          <th className={`${TABLE_TH} min-w-24`}>形态</th>
                          <th className={`${TABLE_TH} min-w-44`}>接头类型</th>
                          <th className={`${TABLE_TH} min-w-44`}>螺纹代码</th>
                          <th className={`${TABLE_TH} min-w-52`}>可选插芯代码</th>
                          <th className={`${TABLE_TH} min-w-44`}>密封结构</th>
                          <th className={TABLE_LONG_TH}>备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {filteredFittings.map((item) => (
                          <tr
                            key={item.code}
                            onClick={() => applyResultAsSearch(item.code)}
                            className="cursor-pointer text-on-surface transition-colors hover:bg-surface-container-high/30 active:bg-primary-container/10"
                          >
                            <td className={`${TABLE_FIRST_TD} min-w-36`}>
                              <span className="rounded-md bg-primary-container/10 px-2 py-1 font-semibold text-primary-container">
                                {item.code}
                              </span>
                            </td>
                            <td className={`${TABLE_TD} font-medium`}>{item.category}</td>
                            <td className={TABLE_TD}>{item.form}</td>
                            <td className={TABLE_TD}>{item.threadType}</td>
                            <td className={`${TABLE_TD} min-w-44`}>{item.threadCodes}</td>
                            <td className={`${TABLE_TD} min-w-52 max-w-[320px] leading-6 [white-space:normal]`}>
                              {item.insertCodes}
                            </td>
                            <td className={TABLE_TD}>{item.seal}</td>
                            <td className={TABLE_LONG_TD}>{item.remark}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ── Database Status ── */}
            {(showDataError || showDatabaseEmpty) && (
              <section className="flex h-full items-center justify-center overflow-y-auto px-4 py-10 text-center">
                <div className="max-w-sm">
                  <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-on-surface-variant/35">
                    <Icon name={showDataError ? 'error' : 'database'} size={30} />
                  </span>
                  <h2 className="text-sm font-bold text-on-surface">
                    {showDataError ? '规格数据加载失败' : '数据库暂无规格数据'}
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
                    {showDataError
                      ? '请检查后端接口和数据库连接，页面不会再用前端内置表格替代真实数据。'
                      : '当前页面只展示数据库数据。管理员可在「管理数据」里新增或导入规格资料。'}
                  </p>
                </div>
              </section>
            )}

            {/* ── No Results ── */}
            {showNoResults && (
              <section className="flex h-full items-center justify-center overflow-y-auto px-4 py-10 text-center">
                <div className="max-w-sm">
                  <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center text-on-surface-variant/35">
                    <Icon name="search_off" size={30} />
                  </span>
                  <h2 className="text-sm font-bold text-on-surface">没有找到匹配结果</h2>
                  <p className="mt-2 text-xs leading-6 text-on-surface-variant/70">
                    换成规格、俗称、型号片段或测量值再试
                    <br />
                    例如 G1/2、4分、DN25、-06、20.9 14牙
                  </p>
                </div>
              </section>
            )}
          </div>
        </AdminContentPanel>
      </AdminManagementPage>

      {managementOpen && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => setManagementOpen(false)}
        >
          <div
            className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low shadow-2xl sm:relative sm:inset-auto sm:h-[88dvh] sm:w-[min(96vw,1180px)] sm:overflow-hidden sm:rounded-xl sm:border sm:border-outline-variant/20"
            role="dialog"
            aria-modal="true"
            aria-label="规格数据管理"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-on-surface">规格数据管理</h2>
                <p className="mt-0.5 line-clamp-1 text-xs text-on-surface-variant">
                  数据已接入数据库，可人工新增、编辑、删除；前台表格只读取数据库记录。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManagementOpen(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="关闭"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="grid shrink-0 gap-3 border-b border-outline-variant/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <ResponsiveSectionTabs
                tabs={CATEGORY_FILTERS.map((tab) => ({
                  value: tab.key,
                  label: tab.label,
                  icon: categoryIcon(tab.key),
                  count: adminCounts[tab.key] || 0,
                }))}
                value={managementCategory}
                onChange={setManagementCategory}
                mobileTitle="数据分类"
              />
              <label className="relative block w-full">
                <Icon
                  name="search"
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
                />
                <input
                  value={managementQuery}
                  onChange={(event) => setManagementQuery(event.target.value)}
                  placeholder="搜索规格、型号、说明..."
                  className="h-9 w-full rounded-lg border border-outline-variant/25 bg-surface-container-lowest pl-9 pr-3 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary-container/60"
                />
              </label>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-on-surface">
                    {CATEGORY_FILTERS.find((tab) => tab.key === managementCategory)?.label}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {adminRows.length
                      ? '当前读取数据库数据，修改后前台立即生效。'
                      : '数据库暂无规格数据，请新增记录或通过数据库导入。'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-primary-container/10 px-2.5 py-1 text-xs font-bold text-primary-container">
                    {visibleAdminRows.length} 项
                  </span>
                  <button
                    type="button"
                    onClick={() => openEntryEditor()}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-2.5 text-xs font-bold text-on-primary transition-opacity hover:opacity-90"
                  >
                    <Icon name="add" size={13} />
                    新增
                  </button>
                </div>
              </div>

              {visibleAdminRows.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center">
                  <div>
                    <Icon name="search_off" size={32} className="mx-auto text-on-surface-variant/30" />
                    <p className="mt-3 text-sm font-bold text-on-surface">没有匹配数据</p>
                    <p className="mt-1 text-xs text-on-surface-variant">换一个规格、型号或说明关键词试试。</p>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                  <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-surface-container-low text-xs text-on-surface">
                      <tr>
                        <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">规格 / 型号</th>
                        <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">分类</th>
                        <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">关键参数</th>
                        <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">说明</th>
                        <th className="border-b border-outline-variant/10 px-4 py-3 text-right font-bold">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/8">
                      {visibleAdminRows.map((row) => (
                        <tr
                          key={row.id}
                          className="text-on-surface transition-colors hover:bg-surface-container-high/30"
                        >
                          <td className="px-4 py-3 font-semibold">{row.primary}</td>
                          <td className="px-4 py-3 text-on-surface-variant">{row.secondary}</td>
                          <td className="px-4 py-3 text-on-surface-variant">{row.meta}</td>
                          <td className="max-w-[420px] px-4 py-3 leading-6 text-on-surface-variant">{row.note}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => row.dbEntry && openEntryEditor(row.dbEntry)}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/12 px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                              >
                                <Icon name="edit" size={13} />
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => row.dbEntry && void deleteEntry(row.dbEntry)}
                                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-error/15 px-2.5 text-xs font-medium text-error transition-colors hover:bg-error/8"
                              >
                                <Icon name="delete" size={13} />
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingEntry && (
        <div
          className="fixed inset-0 z-[340] flex items-center justify-center bg-black/55 p-3"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="编辑规格数据"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-on-surface">
                  {editingEntry === 'new' ? '新增规格数据' : '编辑规格数据'}
                </h2>
                <p className="mt-0.5 text-xs text-on-surface-variant">结构化 JSON 会用于前台表格精确展示。</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="关闭"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">类型</span>
                  <select
                    value={entryDraft.kind}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, kind: event.target.value as DataTab }))}
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  >
                    <option value="thread">螺纹</option>
                    <option value="pipe">管径</option>
                    <option value="hose">油管/气管</option>
                    <option value="fitting">扣压接头</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">螺纹分类</span>
                  <input
                    value={entryDraft.family}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, family: event.target.value }))}
                    placeholder="metric / g / r / npt / jic"
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">管路分类</span>
                  <input
                    value={entryDraft.hoseKind}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, hoseKind: event.target.value }))}
                    placeholder="hydraulic / air"
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">规格 / 型号</span>
                  <input
                    value={entryDraft.primary}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, primary: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">分类显示</span>
                  <input
                    value={entryDraft.secondary}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, secondary: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-bold text-on-surface-variant">关键参数</span>
                <input
                  value={entryDraft.meta}
                  onChange={(event) => setEntryDraft((prev) => ({ ...prev, meta: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-on-surface-variant">说明</span>
                <textarea
                  value={entryDraft.note}
                  onChange={(event) => setEntryDraft((prev) => ({ ...prev, note: event.target.value }))}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-on-surface-variant">结构化 JSON</span>
                <textarea
                  value={entryDraft.dataText}
                  onChange={(event) => setEntryDraft((prev) => ({ ...prev, dataText: event.target.value }))}
                  rows={8}
                  spellCheck={false}
                  className="mt-1 w-full resize-y rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-xs leading-5 text-on-surface outline-none"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <label className="block">
                  <span className="text-xs font-bold text-on-surface-variant">排序</span>
                  <input
                    type="number"
                    value={entryDraft.sortOrder}
                    onChange={(event) =>
                      setEntryDraft((prev) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
                  />
                </label>
                <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant/15 px-3 text-sm text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={entryDraft.enabled}
                    onChange={(event) => setEntryDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
                  />
                  启用
                </label>
              </div>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 px-4 py-3">
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="h-9 rounded-lg border border-outline-variant/20 px-4 text-sm font-bold text-on-surface-variant"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void saveEntryDraft()}
                className="h-9 rounded-lg bg-primary-container px-4 text-sm font-bold text-on-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminPageShell>
  );
}
