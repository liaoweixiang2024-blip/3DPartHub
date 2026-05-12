/**
 * Thread-size tool: types, constants, and pure calculation/lookup logic.
 * Extracted from ThreadSizeToolPage for reuse and testability.
 */

// ── Types ───────────────────────────────────────────────────────────

export type ThreadFamily = 'metric' | 'metricH' | 'metricA' | 'metricC' | 'metricD' | 'g' | 'r' | 'npt' | 'jic';
export type ToolTab = 'thread' | 'pipe' | 'hose' | 'fitting';
export type DataTab = ToolTab;

export interface ThreadSpec {
  family: ThreadFamily;
  familyLabel: string;
  size: string;
  majorMm: number;
  pitchMm?: number;
  tpi?: number;
  seal: string;
  note: string;
}

export interface PipeSpec {
  dn: string;
  inch: string;
  odMm: number;
  commonUse: string;
}

export interface HoseSpec {
  kind?: '液压油管' | '气管';
  dash: string;
  nominalInch: string;
  innerMm: number;
  outerRangeMm: string;
  pressureMpa: string;
  jic: string;
  commonUse: string;
}

export interface FittingSpec {
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

export interface AdminDataRow {
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
  dbEntry?: import('../../api/threadSize').ThreadSizeEntry;
}

export interface MeasurementQuery {
  hasMeasurement: boolean;
  outer?: number;
  inner?: number;
  pitchMm?: number;
  tpi?: number;
  pitchLabel?: string;
  family?: 'all' | ThreadFamily;
}

export type ThreadSizeScrollPosition = { top: number; left: number };

export interface ThreadSizeResultReturnState {
  activeTab: ToolTab;
  family: 'all' | ThreadFamily;
  hoseKind: 'all' | 'hydraulic' | 'air';
  query: string;
  showGuide: boolean;
  scroll: ThreadSizeScrollPosition | null;
}

// ── Category Filters ────────────────────────────────────────────────

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

export function categoryIcon(key: string) {
  if (key.startsWith('thread')) return 'hexagon';
  if (key === 'pipe') return 'pipeline';
  if (key.startsWith('hose')) return 'cat_hydraulic_hose';
  return 'cat_crimp_fitting';
}

// ── Admin helpers ────────────────────────────────────────────────────

export function includesAdminQuery(row: AdminDataRow, query: string) {
  if (!query.trim()) return true;
  const text = `${row.primary}${row.secondary}${row.meta}${row.note}`.toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

export function matchesAdminFilter(row: AdminDataRow, key: string) {
  const filter = CATEGORY_FILTERS.find((item) => item.key === key)?.apply();
  if (!filter) return true;
  if (row.tab !== filter.tab) return false;
  if (filter.family && filter.family !== 'all' && row.family !== filter.family) return false;
  if (filter.hoseKind && filter.hoseKind !== 'all' && row.hoseKind !== filter.hoseKind) return false;
  return true;
}

export function entryToAdminRow(entry: import('../../api/threadSize').ThreadSizeEntry): AdminDataRow {
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

// ── Entry → Spec conversions ────────────────────────────────────────

function entryData<T>(entry: import('../../api/threadSize').ThreadSizeEntry): T | null {
  return entry.data && typeof entry.data === 'object' ? (entry.data as T) : null;
}

function firstNumber(value: string) {
  const matched = value.match(/\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

export function entryToThreadSpec(entry: import('../../api/threadSize').ThreadSizeEntry): ThreadSpec {
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

export function entryToPipeSpec(entry: import('../../api/threadSize').ThreadSizeEntry): PipeSpec {
  const data = entryData<PipeSpec>(entry);
  if (data?.dn && typeof data.odMm === 'number') return data;
  return {
    dn: entry.primary,
    inch: entry.secondary.replace(/"/g, ''),
    odMm: firstNumber(entry.meta),
    commonUse: entry.note,
  };
}

export function entryToHoseSpec(entry: import('../../api/threadSize').ThreadSizeEntry): HoseSpec {
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

export function entryToFittingSpec(entry: import('../../api/threadSize').ThreadSizeEntry): FittingSpec {
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

// ── Text normalisation & aliases ─────────────────────────────────────

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[×＊*]/g, 'x')
    .replace(/[，。；：、]/g, '')
    .replace(/\s+/g, '');
}

export function normalizeMetricPitchZero(value: string) {
  return value.replace(/(m\d+x\d+)\.0(?=$|[^\d])/g, '$1');
}

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

export function commonPipeNameAliases(value: string) {
  const q = normalizeText(value);
  if (!q) return undefined;
  const compact = q.replace(/(?:管螺纹|螺纹|管径|外牙|内牙|接口|接头|管|牙)+$/g, '');
  if (COMMON_PIPE_NAME_ALIASES[compact]) return COMMON_PIPE_NAME_ALIASES[compact];

  const matchedName = Object.keys(COMMON_PIPE_NAME_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((name) => q.includes(name));
  return matchedName ? COMMON_PIPE_NAME_ALIASES[matchedName] : undefined;
}

// ── Thread calculations ─────────────────────────────────────────────

export function threadPitchText(spec: ThreadSpec) {
  if (spec.pitchMm) return `${spec.pitchMm} mm`;
  return `${spec.tpi} 牙/英寸`;
}

export function pitchToMm(spec: ThreadSpec) {
  return spec.pitchMm || (spec.tpi ? 25.4 / spec.tpi : 0);
}

export function isMetricThreadFamily(family: ThreadFamily) {
  return (
    family === 'metric' || family === 'metricH' || family === 'metricA' || family === 'metricC' || family === 'metricD'
  );
}

export function threadInnerReference(spec: ThreadSpec) {
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

export function threadInnerValue(spec: ThreadSpec) {
  const pitch = pitchToMm(spec);
  if (!pitch) return null;
  if (isMetricThreadFamily(spec.family)) return spec.majorMm - pitch;
  if (spec.family === 'g' || spec.family === 'r') return spec.majorMm - pitch * 1.28;
  if (spec.family === 'npt') return spec.majorMm - pitch * 1.3;
  if (spec.family === 'jic') return spec.majorMm - pitch * 1.08;
  return spec.majorMm - pitch * 1.2;
}

export function threadAngleText(spec: ThreadSpec) {
  if (spec.family === 'g' || spec.family === 'r') return '55°';
  return '60°';
}

export function threadTaperText(spec: ThreadSpec) {
  if (spec.family === 'metricH') return '直牙，H型密封';
  if (spec.family === 'metricA') return '直牙，A型密封';
  if (spec.family === 'metricC') return '直牙，C型密封';
  if (spec.family === 'metricD') return '直牙，D型密封';
  if (spec.family === 'r') return '1:16 锥管';
  if (spec.family === 'npt') return '1:16 锥管';
  if (spec.family === 'jic') return '直牙，37°锥面';
  return '直牙';
}

// ── Measurement query parsing ────────────────────────────────────────

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

export function parseMeasurementQuery(value: string): MeasurementQuery {
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

// ── Query alias & matching ───────────────────────────────────────────

export function queryAliases(value: string) {
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

export function includesAnyAlias(text: string, aliases: string[]) {
  const normalized = normalizeText(text);
  return aliases.some((alias) => normalized.includes(alias));
}

export function threadSizeTokens(spec: ThreadSpec) {
  const tokens = spec.size.includes(' / ')
    ? spec.size
        .split(/\s+\/\s+/)
        .map(normalizeText)
        .filter(Boolean)
    : [normalizeText(spec.size)];
  return [...new Set(tokens.flatMap((token) => [token, normalizeMetricPitchZero(token)]))];
}

export function matchScore(text: string, query: string) {
  const aliases = queryAliases(query);
  const q = aliases[0] || '';
  if (!q) return 0;
  const normalized = normalizeText(text);
  if (aliases.some((alias) => normalized === alias)) return -400;
  if (aliases.some((alias) => normalized.startsWith(alias))) return -300;
  if (aliases.some((alias) => normalized.includes(alias))) return -200;
  return 0;
}

export function priorityScore(text: string, tab: ToolTab) {
  const normalized = normalizeText(text);
  const index = PRIORITY_TERMS[tab].findIndex((term) => normalized.includes(normalizeText(term)));
  return index === -1 ? 1000 : index;
}

export function rankedItems<T>(
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

// ── Comparators ──────────────────────────────────────────────────────

export function compareThreadSizeAsc(a: ThreadSpec, b: ThreadSpec) {
  return (
    a.majorMm - b.majorMm || pitchToMm(a) - pitchToMm(b) || a.familyLabel.localeCompare(b.familyLabel, 'zh-Hans-CN')
  );
}

export function comparePipeSizeAsc(a: PipeSpec, b: PipeSpec) {
  return a.odMm - b.odMm;
}

export function compareHoseSizeAsc(a: HoseSpec, b: HoseSpec) {
  return a.innerMm - b.innerMm || a.dash.localeCompare(b.dash, 'zh-Hans-CN');
}

export function compareFittingCodeAsc(a: FittingSpec, b: FittingSpec) {
  return Number(a.code) - Number(b.code) || a.form.localeCompare(b.form, 'zh-Hans-CN');
}

// ── Tab / family detection ──────────────────────────────────────────

export function detectToolTab(value: string, fallback: ToolTab): ToolTab {
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

export function familyFromQuery(value: string): 'all' | ThreadFamily {
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
