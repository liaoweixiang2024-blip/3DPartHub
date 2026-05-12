import type { ColumnDef, SelectionProduct } from '../../api/selections';
import type { UploadPolicy } from '../../lib/businessConfig';

export const PRODUCT_IMPORT_BASE_HEADERS = ['名称', '型号编号'];
export const PRODUCT_IMPORT_EXTRA_HEADERS = ['图片', 'PDF链接', '是否套件', '组件(JSON)'];
export const PRODUCT_MODEL_HEADERS = ['型号编号', '型号', 'modelNo', 'modelno', 'ModelNo'];
export const PRODUCT_NAME_HEADERS = ['名称', '产品名称', 'name', 'Name'];
export type SelectionImportPolicy = Pick<
  UploadPolicy,
  'selectionImportMaxSizeMb' | 'selectionImportMaxRows' | 'selectionImportMaxColumns'
>;

export function getApiErrorMessage(err: unknown, fallback: string) {
  const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
  const data = error.response?.data;
  return data?.detail || data?.message || error.message || fallback;
}

export function normalizeImportCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function rowsToImportObjects(rows: unknown[][], policy: SelectionImportPolicy): Record<string, string>[] {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => normalizeImportCell(cell)));
  if (nonEmptyRows.length <= 1) return [];
  if (nonEmptyRows.length - 1 > policy.selectionImportMaxRows) {
    throw new Error(`最多一次导入 ${policy.selectionImportMaxRows} 行`);
  }

  const headers = nonEmptyRows[0].map(normalizeImportCell);
  if (headers.length > policy.selectionImportMaxColumns) {
    throw new Error(`最多支持 ${policy.selectionImportMaxColumns} 列`);
  }

  return nonEmptyRows.slice(1).map((row) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      item[header] = normalizeImportCell(row[index]);
    });
    return item;
  });
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

export async function readProductImportRows(
  file: File,
  policy: SelectionImportPolicy,
): Promise<Record<string, string>[]> {
  const maxSizeMb = Math.max(1, Number(policy.selectionImportMaxSizeMb) || 5);
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`导入文件不能超过 ${maxSizeMb}MB`);
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.csv')) {
    return rowsToImportObjects(parseCsvRows(await file.text()), policy);
  }
  if (lowerName.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return rowsToImportObjects(await readSheet(file), policy);
  }
  throw new Error('仅支持 .xlsx / .csv 文件');
}

export function safeSpreadsheetText(value: unknown): string {
  const text = normalizeImportCell(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function cleanProductName(name: string, modelNo?: string | null) {
  if (!name || !modelNo) return name;
  return (
    name
      .replace(modelNo, '')
      .replace(/[\s\-—_]+$/g, '')
      .replace(/^[\s\-—_]+/g, '')
      .trim() || name
  );
}

export function firstRowValue(row: Record<string, string>, headers: string[]) {
  for (const header of headers) {
    const value = row[header];
    if (value) return value;
  }
  return '';
}

export function productImportHeaders(columns: ColumnDef[]) {
  const parameterHeaders = columns.filter((col) => col.key !== '型号').map((col) => col.label || col.key);
  return [...PRODUCT_IMPORT_BASE_HEADERS, ...parameterHeaders, ...PRODUCT_IMPORT_EXTRA_HEADERS];
}

export function generatableProductColumns(columns: ColumnDef[]) {
  return columns.filter((col) => col.key !== '型号');
}

export function isProductImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

export function isProductPdfFile(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function productAssetKind(file: File): 'image' | 'pdf' | null {
  if (isProductImageFile(file)) return 'image';
  if (isProductPdfFile(file)) return 'pdf';
  return null;
}

export type GeneratedProductDraft = {
  name: string;
  modelNo: string;
  specs: Record<string, string>;
};

export function parseGenerateValues(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/\r?\n|,|，/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function renderGenerateTemplate(template: string, specs: Record<string, string>) {
  return template.replace(/\[([^\]]+)\]/g, (_match, key: string) => specs[key] ?? '');
}

export function placeholdersFromText(text?: string | null) {
  return Array.from((text || '').matchAll(/\[([^\]]+)\]/g)).map((match) => match[1]);
}

export function firstNonSystemColumn(columns: ColumnDef[]) {
  return columns.find((col) => col.key !== '型号');
}

export function inferProductPattern(
  value: string | null | undefined,
  specs: Record<string, string>,
  columns: ColumnDef[],
) {
  const text = (value || '').trim();
  if (!text) return '';
  let pattern = text;
  const entries = columns
    .map((col) => ({ key: col.key, value: specs[col.key] || '' }))
    .filter((item) => item.key !== '型号' && item.value)
    .sort((a, b) => b.value.length - a.value.length);

  entries.forEach(({ key, value }) => {
    pattern = pattern.split(value).join(`[${key}]`);
  });

  const placeholderCount = placeholdersFromText(pattern).length;
  return placeholderCount > 0 ? pattern : '';
}

export function inferGenerateTemplates(columns: ColumnDef[], products: SelectionProduct[]) {
  const sample = products.find((p) => p.modelNo || p.name);
  if (sample) {
    const specs = (sample.specs as Record<string, string>) || {};
    const modelPattern = inferProductPattern(sample.modelNo, specs, columns);
    const namePattern = inferProductPattern(sample.name, specs, columns);
    if (modelPattern || namePattern) {
      return {
        modelTemplate: modelPattern || '[型号]',
        nameTemplate: namePattern || '',
      };
    }
  }

  const firstColumn = firstNonSystemColumn(columns);
  return {
    modelTemplate: firstColumn ? `[${firstColumn.key}]` : '',
    nameTemplate: '',
  };
}

export function parseExcludeRuleLine(line: string) {
  return line
    .split(/\s*(?:&&|&|，|,)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.+?)(?:=|==|：|:)(.+)$/);
      if (!match) return null;
      const field = match[1].trim();
      const values = match[2]
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean);
      return field && values.length ? { field, values } : null;
    })
    .filter((item): item is { field: string; values: string[] } => Boolean(item));
}

export function resolveRuleFieldKey(field: string, columns: ColumnDef[]) {
  const col = columns.find((item) => item.key === field || item.label === field);
  return col?.key || field;
}

export function isExcludedByRules(specs: Record<string, string>, rulesText: string, columns: ColumnDef[]) {
  const lines = rulesText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  return lines.some((line) => {
    const conditions = parseExcludeRuleLine(line);
    if (!conditions.length) return false;
    return conditions.every(({ field, values }) => {
      const current = specs[resolveRuleFieldKey(field, columns)] ?? '';
      return values.some((value) => (value === '*' ? Boolean(current) : current === value));
    });
  });
}

export function buildGeneratedProductDrafts(params: {
  columns: ColumnDef[];
  optionTexts: Record<string, string>;
  modelTemplate: string;
  nameTemplate: string;
  excludeRules: string;
  limit?: number;
}) {
  const selectableColumns = generatableProductColumns(params.columns);
  const optionEntries = selectableColumns
    .map((col) => ({ col, values: parseGenerateValues(params.optionTexts[col.key] || '') }))
    .filter((item) => item.values.length > 0);
  if (!optionEntries.length) return [];

  const results: GeneratedProductDraft[] = [];
  const limit = params.limit ?? 10000;

  function walk(index: number, specs: Record<string, string>) {
    if (results.length >= limit) return;
    if (index >= optionEntries.length) {
      if (isExcludedByRules(specs, params.excludeRules, params.columns)) return;
      const fallbackModel = optionEntries
        .map(({ col }) => specs[col.key])
        .filter(Boolean)
        .join('-');
      const modelNo = renderGenerateTemplate(params.modelTemplate, specs).trim() || fallbackModel;
      const name = renderGenerateTemplate(params.nameTemplate, specs).trim() || modelNo;
      results.push({ name, modelNo, specs: { ...specs } });
      return;
    }

    const { col, values } = optionEntries[index];
    for (const value of values) {
      walk(index + 1, { ...specs, [col.key]: value });
    }
  }

  walk(0, {});
  return results;
}
