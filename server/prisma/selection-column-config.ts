import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ColumnDef = {
  key: string;
  label?: string;
  unit?: string;
  sortType?: 'thread' | 'numeric' | 'default';
  inputType?: 'select' | 'manual';
  optionDisplay?: 'auto' | 'text' | 'image';
  showCount?: boolean;
  /** undefined/true = auto confirm the only available option; false = require manual confirmation */
  autoSelectSingle?: boolean;
  required?: boolean;
  skipWhenNoOptions?: boolean;
  hideInResults?: boolean;
  legacyPlaceholder?: string;
  placeholder?: string;
  suffix?: string;
  displayOnly?: boolean;
};

type RawStructure = {
  categoryTree: Array<{
    children: Array<{
      name: string;
      selectionFields: string[];
    }>;
  }>;
};

type ColumnRuleConfig = {
  displayOnlyFields?: string[];
  hideInResultsFields?: string[];
  defaultSelectableColumn?: Partial<ColumnDef>;
  sortTypeMap?: Record<string, ColumnDef['sortType']>;
  categoryFieldDefaults?: Record<string, Record<string, Partial<ColumnDef>>>;
  categoryExtraDisplayFields?: Record<string, ColumnDef[]>;
};

function repoPath(...parts: string[]) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, '../..', ...parts);
}

function firstExistingPath(paths: string[]) {
  return paths.find((path) => existsSync(path));
}

export function loadBeizeStructure() {
  const candidates = [repoPath('private-docs/beize/北泽选型结构.json'), repoPath('docs/北泽选型结构.json')];
  const structurePath = firstExistingPath(candidates);
  if (!structurePath) throw new Error(`未找到北泽选型结构文件：${candidates.join(' 或 ')}`);
  return JSON.parse(readFileSync(structurePath, 'utf-8')) as RawStructure;
}

export function loadSelectionFieldMap() {
  const structure = loadBeizeStructure();
  const map = new Map<string, string[]>();
  for (const group of structure.categoryTree) {
    for (const child of group.children) map.set(child.name, child.selectionFields);
  }
  return map;
}

export function loadColumnRuleConfig(): ColumnRuleConfig {
  const candidates = [repoPath('private-docs/beize/北泽参数列配置.json'), repoPath('docs/北泽参数列配置.json')];
  const configPath = firstExistingPath(candidates);
  if (!configPath) throw new Error(`未找到北泽参数列配置文件：${candidates.join(' 或 ')}`);
  return JSON.parse(readFileSync(configPath, 'utf-8')) as ColumnRuleConfig;
}

function mergeColumnRule(column: ColumnDef, categoryName: string, rules: ColumnRuleConfig): ColumnDef {
  const next: ColumnDef = { ...column };
  if (!next.label) next.label = next.key;
  if (next.unit === undefined) next.unit = '';

  if (rules.displayOnlyFields?.includes(next.key)) next.displayOnly = true;
  if (rules.hideInResultsFields?.includes(next.key)) next.hideInResults = true;
  if (!next.sortType && rules.sortTypeMap?.[next.key]) next.sortType = rules.sortTypeMap[next.key];

  const categoryDefaults = rules.categoryFieldDefaults?.[categoryName]?.[next.key];
  if (categoryDefaults) Object.assign(next, categoryDefaults);

  if (!next.displayOnly && next.inputType !== 'manual' && rules.defaultSelectableColumn) {
    for (const [key, value] of Object.entries(rules.defaultSelectableColumn) as Array<
      [keyof ColumnDef, ColumnDef[keyof ColumnDef]]
    >) {
      if (next[key] === undefined) {
        (next as Record<keyof ColumnDef, ColumnDef[keyof ColumnDef]>)[key] = value;
      }
    }
  }
  return next;
}

export function buildColumnsFromFields(
  fields: string[],
  categoryName: string,
  rules = loadColumnRuleConfig(),
): ColumnDef[] {
  const columns = [
    mergeColumnRule({ key: '型号', label: '型号', unit: '' }, categoryName, rules),
    ...fields
      .filter((field) => field !== '型号')
      .map((field) => mergeColumnRule({ key: field, label: field, unit: '' }, categoryName, rules)),
    ...(rules.categoryExtraDisplayFields?.[categoryName] ?? []).map((column) =>
      mergeColumnRule(column, categoryName, rules),
    ),
  ];

  const seen = new Set<string>();
  return columns.filter((column) => {
    if (seen.has(column.key)) return false;
    seen.add(column.key);
    return true;
  });
}

function columnRank(column: ColumnDef, originalIndex: number, selectionFields: string[]) {
  if (column.key === '型号') return -1000;
  const specIndex = selectionFields.indexOf(column.key);
  if (specIndex >= 0) return specIndex;
  return 1000 + originalIndex;
}

export function normalizeColumnsByRules(
  columns: unknown,
  selectionFields: string[],
  categoryName: string,
  rules = loadColumnRuleConfig(),
): ColumnDef[] | null {
  if (!Array.isArray(columns)) return null;
  const currentColumns = columns as ColumnDef[];
  const byKey = new Map<string, { column: ColumnDef; originalIndex: number }>();

  currentColumns.forEach((column, originalIndex) => {
    if (!column || typeof column !== 'object' || !column.key) return;
    byKey.set(column.key, { column, originalIndex });
  });

  for (const column of buildColumnsFromFields(selectionFields, categoryName, rules)) {
    if (!byKey.has(column.key)) byKey.set(column.key, { column, originalIndex: byKey.size + 1000 });
  }

  return Array.from(byKey.values())
    .map(({ column, originalIndex }) => ({
      column: mergeColumnRule(column, categoryName, rules),
      originalIndex,
    }))
    .sort(
      (a, b) =>
        columnRank(a.column, a.originalIndex, selectionFields) - columnRank(b.column, b.originalIndex, selectionFields),
    )
    .map((item) => item.column);
}
