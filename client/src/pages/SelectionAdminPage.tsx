import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import type { SheetData } from "write-excel-file/browser";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { smartSortOptions } from "../lib/selectionSort";
import Icon from "../components/shared/Icon";
import SafeImage from "../components/shared/SafeImage";
import InfiniteLoadTrigger from "../components/shared/InfiniteLoadTrigger";
import { useVisibleItems } from "../hooks/useVisibleItems";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminManagementPage } from "../components/shared/AdminManagementPage";
import ResponsiveSectionTabs from "../components/shared/ResponsiveSectionTabs";
import { useToast } from "../components/shared/Toast";
import { KIT_LIST_TITLE_OPTION_KEY } from "../lib/kitList";
import { getBusinessConfig, type UploadPolicy } from "../lib/businessConfig";
import {
  getSelectionCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  getSelectionProducts,
  updateProduct,
  deleteProduct,
  batchImportProducts,
  uploadOptionImage,
  uploadSelectionProductAsset,
  uploadOptionImageFromUrl,
  renameOptionValue,
  sortCategories,
  type SelectionCategory,
  type SelectionProduct,
  type SelectionComponent,
  type ColumnDef,
} from "../api/selections";

type Tab = "categories" | "products";
const PRODUCT_IMPORT_BASE_HEADERS = ["名称", "型号编号"];
const PRODUCT_IMPORT_EXTRA_HEADERS = ["图片", "PDF链接", "是否套件", "组件(JSON)"];
const PRODUCT_MODEL_HEADERS = ["型号编号", "型号", "modelNo", "modelno", "ModelNo"];
const PRODUCT_NAME_HEADERS = ["名称", "产品名称", "name", "Name"];
type SelectionImportPolicy = Pick<UploadPolicy, "selectionImportMaxSizeMb" | "selectionImportMaxRows" | "selectionImportMaxColumns">;
const SELECTION_TOOLBAR_BUTTON_BASE = "box-border inline-flex h-9 w-full shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-35 md:w-[5.9rem] md:px-2 md:text-xs [&_svg]:block [&_svg]:shrink-0";
const SELECTION_TOOLBAR_BUTTON_PRIMARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-primary-container bg-primary-container text-on-primary hover:opacity-90`;
const SELECTION_TOOLBAR_BUTTON_SECONDARY = `${SELECTION_TOOLBAR_BUTTON_BASE} border-outline-variant/18 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/35 hover:bg-surface-container-high hover:text-on-surface`;
const SELECTION_ICON_BUTTON_EDIT = "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary-container/12 bg-primary-container/8 text-primary-container transition-colors hover:border-primary-container/25 hover:bg-primary-container/14";
const SELECTION_ICON_BUTTON_DELETE = "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-error/10 bg-error/6 text-error/75 transition-colors hover:border-error/22 hover:bg-error/10 hover:text-error";

function SelectionToolbarButtonContent({ icon, children }: { icon: string; children: string }) {
  return (
    <span className="inline-grid grid-cols-[14px_auto] items-center justify-center gap-1 md:gap-1.5">
      <span className="flex items-center justify-center">
        <Icon name={icon} size={14} />
      </span>
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

function getApiErrorMessage(err: unknown, fallback: string) {
  const error = err as { response?: { data?: { detail?: string; message?: string } }; message?: string };
  const data = error.response?.data;
  return data?.detail || data?.message || error.message || fallback;
}

function normalizeImportCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function rowsToImportObjects(rows: unknown[][], policy: SelectionImportPolicy): Record<string, string>[] {
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

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
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
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

async function readProductImportRows(file: File, policy: SelectionImportPolicy): Promise<Record<string, string>[]> {
  const maxSizeMb = Math.max(1, Number(policy.selectionImportMaxSizeMb) || 5);
  if (file.size > maxSizeMb * 1024 * 1024) {
    throw new Error(`导入文件不能超过 ${maxSizeMb}MB`);
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return rowsToImportObjects(parseCsvRows(await file.text()), policy);
  }
  if (lowerName.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return rowsToImportObjects(await readSheet(file), policy);
  }
  throw new Error("仅支持 .xlsx / .csv 文件");
}

function safeSpreadsheetText(value: unknown): string {
  const text = normalizeImportCell(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function cleanProductName(name: string, modelNo?: string | null) {
  if (!name || !modelNo) return name;
  return name.replace(modelNo, "").replace(/[\s\-—_]+$/g, "").replace(/^[\s\-—_]+/g, "").trim() || name;
}

function firstRowValue(row: Record<string, string>, headers: string[]) {
  for (const header of headers) {
    const value = row[header];
    if (value) return value;
  }
  return "";
}

function productImportHeaders(columns: ColumnDef[]) {
  const parameterHeaders = columns
    .filter((col) => col.key !== "型号")
    .map((col) => col.label || col.key);
  return [...PRODUCT_IMPORT_BASE_HEADERS, ...parameterHeaders, ...PRODUCT_IMPORT_EXTRA_HEADERS];
}

function generatableProductColumns(columns: ColumnDef[]) {
  return columns.filter((col) => col.key !== "型号");
}

function isProductImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
}

function isProductPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function productAssetKind(file: File): "image" | "pdf" | null {
  if (isProductImageFile(file)) return "image";
  if (isProductPdfFile(file)) return "pdf";
  return null;
}

type GeneratedProductDraft = {
  name: string;
  modelNo: string;
  specs: Record<string, string>;
};

function parseGenerateValues(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/\r?\n|,|，/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function renderGenerateTemplate(template: string, specs: Record<string, string>) {
  return template.replace(/\[([^\]]+)\]/g, (_match, key: string) => specs[key] ?? "");
}

function placeholdersFromText(text?: string | null) {
  return Array.from((text || "").matchAll(/\[([^\]]+)\]/g)).map((match) => match[1]);
}

function firstNonSystemColumn(columns: ColumnDef[]) {
  return columns.find((col) => col.key !== "型号");
}

function inferProductPattern(value: string | null | undefined, specs: Record<string, string>, columns: ColumnDef[]) {
  const text = (value || "").trim();
  if (!text) return "";
  let pattern = text;
  const entries = columns
    .map((col) => ({ key: col.key, value: specs[col.key] || "" }))
    .filter((item) => item.key !== "型号" && item.value)
    .sort((a, b) => b.value.length - a.value.length);

  entries.forEach(({ key, value }) => {
    pattern = pattern.split(value).join(`[${key}]`);
  });

  const placeholderCount = placeholdersFromText(pattern).length;
  return placeholderCount > 0 ? pattern : "";
}

function inferGenerateTemplates(columns: ColumnDef[], products: SelectionProduct[]) {
  const sample = products.find((p) => p.modelNo || p.name);
  if (sample) {
    const specs = (sample.specs as Record<string, string>) || {};
    const modelPattern = inferProductPattern(sample.modelNo, specs, columns);
    const namePattern = inferProductPattern(sample.name, specs, columns);
    if (modelPattern || namePattern) {
      return {
        modelTemplate: modelPattern || "[型号]",
        nameTemplate: namePattern || "",
      };
    }
  }

  const firstColumn = firstNonSystemColumn(columns);
  return {
    modelTemplate: firstColumn ? `[${firstColumn.key}]` : "",
    nameTemplate: "",
  };
}

function parseExcludeRuleLine(line: string) {
  return line
    .split(/\s*(?:&&|&|，|,)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.+?)(?:=|==|：|:)(.+)$/);
      if (!match) return null;
      const field = match[1].trim();
      const values = match[2].split("|").map((item) => item.trim()).filter(Boolean);
      return field && values.length ? { field, values } : null;
    })
    .filter((item): item is { field: string; values: string[] } => Boolean(item));
}

function resolveRuleFieldKey(field: string, columns: ColumnDef[]) {
  const col = columns.find((item) => item.key === field || item.label === field);
  return col?.key || field;
}

function isExcludedByRules(specs: Record<string, string>, rulesText: string, columns: ColumnDef[]) {
  const lines = rulesText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return lines.some((line) => {
    const conditions = parseExcludeRuleLine(line);
    if (!conditions.length) return false;
    return conditions.every(({ field, values }) => {
      const current = specs[resolveRuleFieldKey(field, columns)] ?? "";
      return values.some((value) => value === "*" ? Boolean(current) : current === value);
    });
  });
}

function buildGeneratedProductDrafts(params: {
  columns: ColumnDef[];
  optionTexts: Record<string, string>;
  modelTemplate: string;
  nameTemplate: string;
  excludeRules: string;
  limit?: number;
}) {
  const selectableColumns = generatableProductColumns(params.columns);
  const optionEntries = selectableColumns
    .map((col) => ({ col, values: parseGenerateValues(params.optionTexts[col.key] || "") }))
    .filter((item) => item.values.length > 0);
  if (!optionEntries.length) return [];

  const results: GeneratedProductDraft[] = [];
  const limit = params.limit ?? 10000;

  function walk(index: number, specs: Record<string, string>) {
    if (results.length >= limit) return;
    if (index >= optionEntries.length) {
      if (isExcludedByRules(specs, params.excludeRules, params.columns)) return;
      const fallbackModel = optionEntries.map(({ col }) => specs[col.key]).filter(Boolean).join("-");
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

// ========== Column Editor ==========
function ColumnEditor({ columns, onChange }: { columns: ColumnDef[]; onChange: (cols: ColumnDef[]) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [openAdvancedIdx, setOpenAdvancedIdx] = useState<number | null>(null);

  function addColumn() {
    onChange([...columns, { key: `col_${columns.length}`, label: "", unit: "" }]);
  }
  function updateCol(i: number, field: keyof ColumnDef, value: string | boolean | undefined) {
    const next = [...columns];
    next[i] = { ...next[i], [field]: value };
    if (field === "key" && typeof value === "string") next[i] = { ...next[i], key: value.replace(/\s+/g, "_").toLowerCase() };
    onChange(next);
  }
  function updateColumnMode(i: number, mode: "select" | "manual" | "displayOnly") {
    const next = [...columns];
    const current = { ...next[i] };
    if (mode === "manual") {
      current.inputType = "manual";
      delete current.displayOnly;
      delete current.optionDisplay;
      delete current.sortType;
      delete current.showCount;
      delete current.autoSelectSingle;
      delete current.skipWhenNoOptions;
    } else if (mode === "displayOnly") {
      current.displayOnly = true;
      delete current.inputType;
      delete current.optionDisplay;
      delete current.sortType;
      delete current.showCount;
      delete current.autoSelectSingle;
      delete current.skipWhenNoOptions;
    } else {
      delete current.inputType;
      delete current.displayOnly;
      delete current.placeholder;
      delete current.suffix;
    }
    next[i] = current;
    onChange(next);
  }
  function removeCol(i: number) {
    onChange(columns.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <label className="text-sm font-bold text-on-surface">参数列定义</label>
          <p className="mt-0.5 text-[11px] text-on-surface-variant/70">从上到下就是客户选型顺序；拖动左侧手柄可调整顺序。</p>
        </div>
        <button
          type="button"
          onClick={addColumn}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90"
        >
          <Icon name="add" size={14} /> 添加参数列
        </button>
      </div>

      <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3 text-xs text-on-surface-variant">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-container/10 text-primary-container">
              <Icon name="info" size={14} />
            </span>
            <div>
              <p className="font-bold text-on-surface">怎么理解这张表</p>
              <p className="mt-1 leading-5">
                数据字段要和产品参数一致；页面名称是客户看到的文字；类型决定它是客户选择、客户填写，还是只在结果里展示。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] sm:w-[330px]">
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">客户选择=按钮筛选</span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">客户填写=手输长度</span>
            <span className="rounded-md bg-surface-container-high px-2 py-1 text-center">只展示=结果信息</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-sm">
        <div className="hidden grid-cols-[36px_44px_minmax(150px,1.1fr)_minmax(170px,1.1fr)_76px_118px_104px_40px] items-center gap-2 border-b border-outline-variant/10 bg-surface-container-high px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant md:grid">
          <span />
          <span>顺序</span>
          <span>数据字段</span>
          <span>页面名称</span>
          <span>单位</span>
          <span>类型</span>
          <span>设置</span>
          <span />
        </div>

        {columns.length === 0 ? (
          <div className="grid place-items-center px-4 py-10 text-center">
            <Icon name="view_column" size={28} className="mb-2 text-on-surface-variant/30" />
            <p className="text-sm font-medium text-on-surface">还没有参数列</p>
            <p className="mt-1 text-xs text-on-surface-variant">添加后，客户会按这些列一步步完成选型。</p>
            <button type="button" onClick={addColumn} className="mt-3 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary hover:opacity-90">
              添加第一列
            </button>
          </div>
        ) : columns.map((col, i) => {
          const mode = col.displayOnly ? "displayOnly" : col.inputType === "manual" ? "manual" : "select";
          const isAdvancedOpen = openAdvancedIdx === i;
          const modeTone = mode === "manual"
            ? "bg-amber-500/10 text-amber-700"
            : mode === "displayOnly"
              ? "bg-surface-container-high text-on-surface-variant"
              : "bg-primary-container/10 text-primary-container";
          const modeLabel = mode === "manual" ? "客户填写" : mode === "displayOnly" ? "只展示" : "客户选择";

          return (
            <div
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIdx === null || dragIdx === i) return;
                const next = [...columns];
                const [item] = next.splice(dragIdx, 1);
                next.splice(i, 0, item);
                onChange(next);
                setDragIdx(i);
              }}
              onDragEnd={() => setDragIdx(null)}
              className={`border-b border-outline-variant/8 last:border-b-0 transition-colors hover:bg-surface-container-high/35 ${dragIdx === i ? "opacity-40" : ""}`}
            >
              <div className="grid gap-2 px-3 py-3 md:grid-cols-[36px_44px_minmax(150px,1.1fr)_minmax(170px,1.1fr)_76px_118px_104px_40px] md:items-center">
                <div className="flex items-center justify-between md:contents">
                  <span className="inline-flex h-8 w-8 cursor-grab select-none items-center justify-center rounded-lg text-on-surface-variant/45 hover:bg-surface-container-high hover:text-on-surface-variant active:cursor-grabbing" title="拖拽排序">⠿</span>
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-surface-container-high px-2 text-xs font-bold text-on-surface-variant md:justify-self-start">
                    {i + 1}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold md:hidden ${modeTone}`}>{modeLabel}</span>
                </div>

                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">数据字段</span>
                  <input
                    value={col.key}
                    onChange={(e) => updateCol(i, "key", e.target.value)}
                    placeholder="如 通径"
                    title="必须和产品参数 specs 里的字段名一致"
                    className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">页面名称</span>
                  <input
                    value={col.label}
                    onChange={(e) => updateCol(i, "label", e.target.value)}
                    placeholder="如 选择通径"
                    title="客户在选型页面看到的名字，不影响数据匹配"
                    className="h-9 w-full min-w-0 rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">单位</span>
                  <input
                    value={col.unit}
                    onChange={(e) => updateCol(i, "unit", e.target.value)}
                    placeholder="单位"
                    className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] font-medium text-on-surface-variant md:hidden">类型</span>
                  <select
                    value={mode}
                    onChange={(e) => updateColumnMode(i, e.target.value as "select" | "manual" | "displayOnly")}
                    className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest px-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                  >
                    <option value="select">客户选择</option>
                    <option value="manual">客户填写</option>
                    <option value="displayOnly">只展示</option>
                  </select>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenAdvancedIdx(isAdvancedOpen ? null : i)}
                    className={`inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors md:flex-none ${
                      isAdvancedOpen
                        ? "border-primary-container/30 bg-primary-container/10 text-primary-container"
                        : "border-outline-variant/15 bg-surface-container-lowest text-on-surface-variant hover:border-primary-container/25 hover:text-on-surface"
                    }`}
                  >
                    <Icon name={isAdvancedOpen ? "expand_less" : "tune"} size={14} />
                    {isAdvancedOpen ? "收起" : "更多"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCol(i)}
                    className={`${SELECTION_ICON_BUTTON_DELETE} md:hidden`}
                    aria-label="删除参数列"
                    title="删除参数列"
                  >
                    <Icon name="delete" size={15} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => removeCol(i)}
                  className={`${SELECTION_ICON_BUTTON_DELETE} hidden md:grid`}
                  aria-label="删除参数列"
                  title="删除参数列"
                >
                  <Icon name="delete" size={15} />
                </button>
              </div>

              {isAdvancedOpen && (
                <div className="border-t border-outline-variant/8 bg-surface-container-lowest/70 px-3 pb-3 pt-2">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
                    <span className={`rounded-full px-2 py-1 font-bold ${modeTone}`}>{modeLabel}</span>
                    <span>
                      {mode === "manual"
                        ? `型号模板中写 [${col.key || "数据字段"}]，会替换为客户填写值。`
                        : mode === "displayOnly"
                          ? "只在结果中展示，不会成为客户选择步骤。"
                          : "用于生成筛选选项，可配置排序、图片展示、自动选择和跳过。"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">输入提示</span>
                      <input value={col.placeholder || ""} onChange={(e) => updateCol(i, "placeholder", e.target.value || undefined)} disabled={mode !== "manual"} placeholder="如：请输入长度，如 1.5" className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">填写后缀</span>
                      <input value={col.suffix || ""} onChange={(e) => updateCol(i, "suffix", e.target.value || undefined)} disabled={mode !== "manual"} placeholder="如：M" className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">结果里显示</span>
                      <select value={col.hideInResults ? "hide" : "show"} onChange={(e) => updateCol(i, "hideInResults", e.target.value === "hide" ? true : undefined)} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container">
                        <option value="show">显示</option>
                        <option value="hide">隐藏</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">兼容旧占位符</span>
                      <input value={col.legacyPlaceholder || ""} onChange={(e) => updateCol(i, "legacyPlaceholder", e.target.value || undefined)} disabled={mode !== "manual"} placeholder="如：[M]" className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40" />
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">选项排序</span>
                      <select disabled={mode !== "select"} value={col.sortType || "default"} onChange={(e) => updateCol(i, "sortType", e.target.value === "default" ? undefined : e.target.value as ColumnDef["sortType"])} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40">
                        <option value="default">按文字</option>
                        <option value="numeric">按数字大小</option>
                        <option value="thread">按规格大小</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">选项显示</span>
                      <select disabled={mode !== "select"} value={col.optionDisplay || "auto"} onChange={(e) => updateCol(i, "optionDisplay", e.target.value === "auto" ? undefined : e.target.value as ColumnDef["optionDisplay"])} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40">
                        <option value="auto">有图用图</option>
                        <option value="text">文字按钮</option>
                        <option value="image">图片卡片</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">显示产品数</span>
                      <select disabled={mode !== "select"} value={col.showCount === false ? "hide" : "show"} onChange={(e) => updateCol(i, "showCount", e.target.value === "hide" ? false : undefined)} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40">
                        <option value="show">显示</option>
                        <option value="hide">不显示</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">只有一个选项时</span>
                      <select disabled={mode !== "select"} value={col.autoSelectSingle === true ? "auto" : "manual"} onChange={(e) => updateCol(i, "autoSelectSingle", e.target.value === "auto" ? true : undefined)} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40">
                        <option value="manual">让客户点</option>
                        <option value="auto">自动选</option>
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-[10px] text-on-surface-variant">没有选项时</span>
                      <select disabled={mode !== "select"} value={col.skipWhenNoOptions === true ? "skip" : "stop"} onChange={(e) => updateCol(i, "skipWhenNoOptions", e.target.value === "skip" ? true : undefined)} className="h-9 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-2 text-xs text-on-surface outline-none focus:border-primary-container disabled:opacity-40">
                        <option value="stop">停下提示</option>
                        <option value="skip">自动跳过</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ========== Content ==========
function Content() {
  const { toast } = useToast();
  const businessConfig = useMemo(() => getBusinessConfig(), []);
  const { uploadPolicy, pageSizePolicy } = businessConfig;
  const productRenderBatchSize = Math.max(20, Number(pageSizePolicy.selectionAdminRenderBatch) || 120);
  const initialGeneratePreviewPageSize = Math.max(1, Number(pageSizePolicy.selectionGeneratePreviewPageSize) || 50);
  const [tab, setTab] = useState<Tab>("categories");
  const [catFilter, setCatFilter] = useState<"all" | "empty">("all");
  const [catSearch, setCatSearch] = useState("");

  // Category state
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<SelectionCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", slug: "", description: "", icon: "", image: "", kitListTitle: "", columns: [] as ColumnDef[] });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  const [showCatSortModal, setShowCatSortModal] = useState(false);
  const [catSortItems, setCatSortItems] = useState<{ id: string; name: string }[]>([]);
  const [catSortDragIdx, setCatSortDragIdx] = useState<number | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupItems, setGroupItems] = useState<{ id: string; name: string; icon: string; image: string; imageFit: "cover" | "contain"; catCount: number }[]>([]);
  const [groupForm, setGroupForm] = useState({ name: "", icon: "category", image: "", imageFit: "cover" as "cover" | "contain" });
  const [groupDragIdx, setGroupDragIdx] = useState<number | null>(null);
  const [manageGroupCatsId, setManageGroupCatsId] = useState<string | null>(null);
  const groupCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Product state
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [productCatOpen, setProductCatOpen] = useState(false);
  const [productCatQuery, setProductCatQuery] = useState("");
  const productCatPickerRef = useRef<HTMLDivElement | null>(null);
  const [showProdModal, setShowProdModal] = useState(false);
  const [editProd, setEditProd] = useState<SelectionProduct | null>(null);
  const [prodForm, setProdForm] = useState({
    name: "",
    modelNo: "",
    specs: {} as Record<string, string>,
    image: "",
    pdfUrl: "",
    isKit: false,
    components: [] as SelectionComponent[],
  });
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null);
  const [productAssetDragging, setProductAssetDragging] = useState(false);
  const [productAssetUploading, setProductAssetUploading] = useState(false);
  const productAssetInputRef = useRef<HTMLInputElement | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchParsed, setBatchParsed] = useState<any[] | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchImporting, setBatchImporting] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateModelTemplate, setGenerateModelTemplate] = useState("");
  const [generateNameTemplate, setGenerateNameTemplate] = useState("");
  const [generateOptionTexts, setGenerateOptionTexts] = useState<Record<string, string>>({});
  const [generateExcludeRules, setGenerateExcludeRules] = useState("");
  const [generatePreview, setGeneratePreview] = useState<GeneratedProductDraft[]>([]);
  const [generatePreviewSearch, setGeneratePreviewSearch] = useState("");
  const [generatePreviewPageSize, setGeneratePreviewPageSize] = useState(initialGeneratePreviewPageSize);
  const [generatePreviewPage, setGeneratePreviewPage] = useState(1);
  const [generateErrors, setGenerateErrors] = useState<string[]>([]);
  const [generateImporting, setGenerateImporting] = useState(false);
  const [showOptImgModal, setShowOptImgModal] = useState(false);
  const [optImgField, setOptImgField] = useState<string>("");
  const [optSettingsSearch, setOptSettingsSearch] = useState("");
  const [uploadingVal, setUploadingVal] = useState<string | null>(null);
  const [editOptVal, setEditOptVal] = useState<string | null>(null);

  const [renameField, setRenameField] = useState<string>("");
  const [renameOldVal, setRenameOldVal] = useState<string>("");
  const [renameNewVal, setRenameNewVal] = useState<string>("");
  const [renaming, setRenaming] = useState(false);

  // Lock body scroll when settings modal or sub-dialog is open
  useEffect(() => {
    if (showOptImgModal || editOptVal || renameOldVal) {
      const y = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${y}px`;
      document.body.style.width = "100%";
      return () => {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        window.scrollTo(0, y);
      };
    }
  }, [showOptImgModal, editOptVal, renameOldVal]);
  useEffect(() => {
    if (!productCatOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!productCatPickerRef.current?.contains(event.target as Node)) {
        setProductCatOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [productCatOpen]);
  const [orderItems, setOrderItems] = useState<string[]>([]);
  const [orderDragIdx, setOrderDragIdx] = useState<number | null>(null);
  const [optViewMode, setOptViewMode] = useState<"grid" | "list">("grid");
  const productTableScrollRef = useRef<HTMLDivElement | null>(null);

  const { data: categories = [], mutate: mutateCats } = useSWR("selections/categories", getSelectionCategories);

  const saveManagedGroupCoverFile = useCallback(async (file: File) => {
    if (!manageGroupCatsId) return;
    const currentGroup = groupItems.find((item) => item.id === manageGroupCatsId);
    try {
      const { url } = await uploadOptionImage(file);
      const catsInGroup = categories.filter((c) => c.groupId === manageGroupCatsId);
      for (const c of catsInGroup) {
        await updateCategory(c.id, {
          groupImage: url || null,
          groupImageFit: currentGroup?.imageFit || "cover",
        });
      }
      setGroupItems((items) => items.map((item) => item.id === manageGroupCatsId ? { ...item, image: url } : item));
      mutateCats();
      toast("分组封面已粘贴上传", "success");
    } catch (err) {
      toast(getApiErrorMessage(err, "上传失败"), "error");
    }
  }, [categories, groupItems, manageGroupCatsId, mutateCats, toast]);

  useEffect(() => {
    if (!showGroupModal || !manageGroupCatsId) return;
    const handleGlobalGroupCoverPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void saveManagedGroupCoverFile(file);
    };
    window.addEventListener("paste", handleGlobalGroupCoverPaste, true);
    return () => window.removeEventListener("paste", handleGlobalGroupCoverPaste, true);
  }, [manageGroupCatsId, saveManagedGroupCoverFile, showGroupModal]);

  // Products for selected category
  const { data: productsData, mutate: mutateProds } = useSWR(
    selectedCatId ? `selections/admin/products/${selectedCatId}` : null,
    async () => {
      const cat = categories.find((c) => c.id === selectedCatId);
      if (!cat) return null;
      return getSelectionProducts(cat.slug, 1, 5000);
    }
  );

  const products = useMemo(() => productsData?.items ?? [], [productsData]);
  const [prodSearch, setProdSearch] = useState("");
  const filteredProducts = useMemo(() => {
    if (!prodSearch) return products;
    const q = prodSearch.toLowerCase();
    return products.filter((p) =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.modelNo || "").toLowerCase().includes(q) ||
      Object.values(p.specs as Record<string, string>).some((v) => v.toLowerCase().includes(q))
    );
  }, [products, prodSearch]);
  const { visibleItems: visibleProducts, hasMore: hasMoreProducts, loadMore: loadMoreProducts } = useVisibleItems(
    filteredProducts,
    productRenderBatchSize,
    `${selectedCatId}:${prodSearch}`
  );
  const handleProductTableScroll = () => {
    const node = productTableScrollRef.current;
    if (!node || !hasMoreProducts) return;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceToBottom < 320) loadMoreProducts();
  };
  const productCategoryOptions = useMemo(() => {
    const q = productCatQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.groupName || "").toLowerCase().includes(q)
    );
  }, [categories, productCatQuery]);

  // ---- Category handlers ----
  function openNewCat() {
    setEditCat(null);
    setCatForm({ name: "", slug: "", description: "", icon: "", image: "", kitListTitle: "", columns: [] });
    setShowCatModal(true);
  }
  function openEditCat(cat: SelectionCategory) {
    setEditCat(cat);
    const optionOrder = (cat.optionOrder || {}) as Record<string, string[] | string>;
    setCatForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || "",
      icon: cat.icon || "",
      image: cat.image || "",
      kitListTitle: typeof optionOrder[KIT_LIST_TITLE_OPTION_KEY] === "string" ? optionOrder[KIT_LIST_TITLE_OPTION_KEY] as string : "",
      columns: cat.columns as ColumnDef[],
    });
    setShowCatModal(true);
  }
  async function saveCat() {
    try {
      const { kitListTitle, ...basePayload } = catForm;
      const optionOrder = { ...((editCat?.optionOrder || {}) as Record<string, string[] | string>) };
      const normalizedKitListTitle = kitListTitle.trim();
      if (normalizedKitListTitle) optionOrder[KIT_LIST_TITLE_OPTION_KEY] = normalizedKitListTitle;
      else delete optionOrder[KIT_LIST_TITLE_OPTION_KEY];
      const payload = { ...basePayload, optionOrder };
      if (editCat) {
        await updateCategory(editCat.id, payload);
        toast("分类已更新", "success");
      } else {
        await createCategory(payload);
        toast("分类已创建", "success");
      }
      setShowCatModal(false);
      mutateCats();
    } catch (err: any) {
      toast(err.response?.data?.detail || "操作失败", "error");
    }
  }
  async function handleDeleteCat(id: string) {
    try {
      await deleteCategory(id);
      toast("分类已删除", "success");
      setDeleteCatId(null);
      if (selectedCatId === id) setSelectedCatId("");
      mutateCats();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }

  // ---- Product handlers ----
  const activeCat = categories.find((c) => c.id === selectedCatId);
  const productColumns = (activeCat?.columns as ColumnDef[]) || [];
  const productsLoading = Boolean(selectedCatId && activeCat && !productsData);
  const selectableProductColumns = generatableProductColumns(productColumns);
  const generateCat = activeCat;
  const generateColumns = (generateCat?.columns as ColumnDef[]) || [];
  const selectableGenerateColumns = generatableProductColumns(generateColumns);
  const generateTemplateExample = selectableGenerateColumns.length
    ? `[${selectableGenerateColumns[0].key}]`
    : "[字段A]-[字段B]-[字段C]";
  const generateExcludeExample = selectableGenerateColumns.length
    ? (() => {
        const [first, second, third] = selectableGenerateColumns;
        const firstKey = first?.key || "字段A";
        const secondKey = second?.key || "字段B";
        const thirdKey = third?.key || secondKey;
        return `例：${firstKey}=不允许值 && ${secondKey}=*\n例：${firstKey}=A && ${thirdKey}=B|C`;
      })()
    : "例：字段A=不允许值 && 字段B=*\n例：字段A=A && 字段C=B|C";
  const filteredGeneratePreview = useMemo(() => {
    const q = generatePreviewSearch.trim().toLowerCase();
    if (!q) return generatePreview;
    return generatePreview.filter((item) => {
      const values = [
        item.name,
        item.modelNo,
        ...Object.values(item.specs || {}),
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [generatePreview, generatePreviewSearch]);
  const generatePreviewTotalPages = Math.max(1, Math.ceil(filteredGeneratePreview.length / generatePreviewPageSize));
  const generatePreviewStart = (generatePreviewPage - 1) * generatePreviewPageSize;
  const pagedGeneratePreview = filteredGeneratePreview.slice(generatePreviewStart, generatePreviewStart + generatePreviewPageSize);

  useEffect(() => {
    if (generatePreviewPage > generatePreviewTotalPages) {
      setGeneratePreviewPage(generatePreviewTotalPages);
    }
  }, [generatePreviewPage, generatePreviewTotalPages]);

  function openNewProd() {
    if (!selectedCatId) { toast("请先选择分类", "error"); return; }
    setEditProd(null);
    setProdForm({ name: "", modelNo: "", specs: {}, image: "", pdfUrl: "", isKit: false, components: [] });
    setShowProdModal(true);
  }
  function openEditProd(prod: SelectionProduct) {
    const modelNo = prod.modelNo || "";
    setEditProd(prod);
    setProdForm({
      name: cleanProductName(prod.name, modelNo),
      modelNo,
      specs: { ...(prod.specs as Record<string, string>) },
      image: prod.image || "",
      pdfUrl: prod.pdfUrl || "",
      isKit: prod.isKit ?? false,
      components: (prod.components as SelectionComponent[]) ?? [],
    });
    setShowProdModal(true);
  }
  async function saveProd() {
    try {
      const modelNo = prodForm.modelNo || undefined;
      const payload = {
        name: cleanProductName(prodForm.name, modelNo),
        modelNo,
        specs: prodForm.specs,
        image: prodForm.image || undefined,
        pdfUrl: prodForm.pdfUrl || undefined,
        isKit: prodForm.isKit,
        components: prodForm.isKit && prodForm.components.length > 0 ? prodForm.components : undefined,
      };
      if (editProd) {
        await updateProduct(editProd.id, payload);
        toast("产品已更新", "success");
      } else {
        await createProduct({ categoryId: selectedCatId, ...payload });
        toast("产品已创建", "success");
      }
      setShowProdModal(false);
      mutateProds();
    } catch (err: any) {
      toast(err.response?.data?.detail || "操作失败", "error");
    }
  }
  async function handleDeleteProd(id: string) {
    try {
      await deleteProduct(id);
      toast("产品已删除", "success");
      setDeleteProdId(null);
      mutateProds();
    } catch (err: any) {
      toast(err.response?.data?.detail || "删除失败", "error");
    }
  }
  async function handleProductAssetFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validFiles = files.filter((file) => productAssetKind(file));
    if (!validFiles.length) {
      toast("只支持上传图片或 PDF 文件", "error");
      return;
    }

    setProductAssetUploading(true);
    try {
      let imageCount = 0;
      let pdfCount = 0;
      for (const file of validFiles) {
        const expectedKind = productAssetKind(file);
        if (!expectedKind) continue;
        const { url, type } = await uploadSelectionProductAsset(file);
        const kind = type || expectedKind;
        setProdForm((prev) => ({
          ...prev,
          image: kind === "image" ? url : prev.image,
          pdfUrl: kind === "pdf" ? url : prev.pdfUrl,
        }));
        if (kind === "image") imageCount += 1;
        if (kind === "pdf") pdfCount += 1;
      }
      const parts = [
        imageCount ? `${imageCount} 张图片` : "",
        pdfCount ? `${pdfCount} 个 PDF` : "",
      ].filter(Boolean);
      toast(`${parts.join("、")}已上传`, "success");
    } catch (err) {
      toast(getApiErrorMessage(err, "上传失败"), "error");
    } finally {
      setProductAssetUploading(false);
      setProductAssetDragging(false);
    }
  }
  async function handleProductAssetPaste(e: React.ClipboardEvent) {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && productAssetKind(file)) files.push(file);
    }
    if (files.length) {
      e.preventDefault();
      await handleProductAssetFiles(files);
      return;
    }

    const text = e.clipboardData.getData("text/plain")?.trim();
    if (!text) return;
    if (/\.(pdf)(\?.*)?$/i.test(text) || /^https?:\/\/.+/i.test(text)) {
      if (/\.(pdf)(\?.*)?$/i.test(text)) {
        e.preventDefault();
        setProdForm((prev) => ({ ...prev, pdfUrl: text }));
        toast("PDF 链接已粘贴", "success");
      } else if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(text)) {
        e.preventDefault();
        toast("正在下载图片...", "info");
        try {
          const { url } = await uploadOptionImageFromUrl(text);
          setProdForm((prev) => ({ ...prev, image: url }));
          toast("图片已下载并保存", "success");
        } catch {
          setProdForm((prev) => ({ ...prev, image: text }));
          toast("图片链接已粘贴，远程保存失败", "error");
        }
      }
    }
  }
  async function handleBatchImport() {
    if (!batchParsed || batchParsed.length === 0) return;
    setBatchImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, batchParsed);
      const msg = updated > 0
        ? `导入完成：新增 ${created} 个，更新 ${updated} 个`
        : `成功导入 ${created} 个产品`;
      toast(msg, "success");
      setShowBatchModal(false);
      setBatchParsed(null);
      setBatchErrors([]);
      mutateProds();
      mutateCats();
    } catch (err: any) {
      toast(err.message || "导入失败", "error");
    } finally {
      setBatchImporting(false);
    }
  }

  function handleExcelFile(file: File) {
    setBatchErrors([]);
    setBatchParsed(null);
    void (async () => {
      try {
        const rows = await readProductImportRows(file, uploadPolicy);
        if (rows.length === 0) {
          setBatchErrors(["文件中没有数据"]);
          return;
        }

        const cols = (activeCat?.columns as ColumnDef[]) || [];
        const colMap = new Map<string, string>();
        cols.forEach((c) => {
          colMap.set(c.key, c.key);
          if (c.label) colMap.set(c.label, c.key);
        });

        const errors: string[] = [];
        const parsed: any[] = [];
        const seenModelNos = new Set<string>();

        rows.forEach((row, i) => {
          const specs: Record<string, string> = {};
          const modelNo = firstRowValue(row, PRODUCT_MODEL_HEADERS);
          const rawName = firstRowValue(row, PRODUCT_NAME_HEADERS);
          for (const [header, val] of Object.entries(row)) {
            if (!val) continue;
            if (PRODUCT_NAME_HEADERS.includes(header) || PRODUCT_MODEL_HEADERS.includes(header)) continue;
            const key = colMap.get(header);
            if (key) {
              specs[key] = val;
            } else if (header === "图片") {
              // skip, handled below
            } else if (header === "PDF链接") {
              // skip
            } else if (header === "是否套件") {
              // skip
            } else if (header === "组件(JSON)") {
              // skip
            }
          }

          if (modelNo) specs["型号"] = modelNo;
          const name = cleanProductName(rawName || modelNo || Object.values(specs).find(Boolean) || `产品 ${i + 1}`, modelNo);
          if (!modelNo) {
            errors.push(`第 ${i + 2} 行：缺少型号编号，导入后无法按型号自动更新`);
          } else if (seenModelNos.has(modelNo)) {
            errors.push(`第 ${i + 2} 行：型号编号 ${modelNo} 在文件中重复，将以后面的数据为准`);
          }
          if (modelNo) seenModelNos.add(modelNo);

          const product: any = {
            name,
            modelNo,
            specs,
            image: row["图片"] || "",
            pdfUrl: row["PDF链接"] || "",
          };

          const isKitVal = row["是否套件"];
          if (isKitVal === "是" || isKitVal === "true" || isKitVal === "1") {
            product.isKit = true;
          }

          const compStr = row["组件(JSON)"];
          if (compStr && compStr.trim()) {
            try {
              product.components = JSON.parse(compStr);
            } catch {
              errors.push(`第 ${i + 2} 行：组件 JSON 解析失败`);
            }
          }

          parsed.push(product);
        });

        if (errors.length > 0) setBatchErrors(errors);
        setBatchParsed(parsed);
      } catch (err) {
        setBatchErrors([err instanceof Error ? err.message : "文件解析失败，请确认是有效的 .xlsx / .csv 文件"]);
      }
    })();
  }

  async function downloadProductImportTemplate() {
    if (!activeCat) {
      toast("请先选择分类", "error");
      return;
    }
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const headers = productImportHeaders(productColumns);
    const rows: SheetData = [
      headers.map((header) => ({ value: header, fontWeight: "bold" as const })),
    ];
    await writeXlsxFile(rows, { sheet: "产品导入模板" }).toFile(`${activeCat.slug || "products"}_import_template.xlsx`);
    toast("已下载导入模板", "success");
  }

  async function exportCurrentProducts() {
    if (!activeCat) {
      toast("请先选择分类", "error");
      return;
    }
    if (!products.length) {
      toast("没有可导出的产品", "error");
      return;
    }
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    const cols = productColumns;
    const headers = productImportHeaders(cols);
    const rows: SheetData = [
      headers.map((header) => ({ value: header, fontWeight: "bold" as const })),
    ];
    products.forEach((p) => {
      const specs = p.specs as Record<string, string>;
      const baseRow: Record<string, string> = {
        "名称": safeSpreadsheetText(p.name),
        "型号编号": safeSpreadsheetText(p.modelNo),
        "图片": safeSpreadsheetText(p.image),
        "PDF链接": safeSpreadsheetText(p.pdfUrl),
        "是否套件": p.isKit ? "是" : "否",
        "组件(JSON)": p.components ? safeSpreadsheetText(JSON.stringify(p.components)) : "",
      };
      cols
        .filter((col) => col.key !== "型号")
        .forEach((col) => {
          baseRow[col.label || col.key] = safeSpreadsheetText(specs[col.key]);
        });
      rows.push(headers.map((header) => baseRow[header] ?? ""));
    });
    await writeXlsxFile(rows, { sheet: "产品" }).toFile(`${activeCat.slug || "products"}_products.xlsx`);
    toast(`已导出 ${products.length} 个产品`, "success");
  }

  // ---- Option Image handlers ----
  const optImages = (activeCat?.optionImages ?? {}) as Record<string, Record<string, string>>;

  // Extract unique option values per field from product data
  const fieldOptions = useMemo(() => {
    if (!activeCat) return {};
    const result: Record<string, string[]> = {};
    for (const col of activeCat.columns) {
      const vals = new Set<string>();
      for (const p of products) {
        const v = (p.specs as Record<string, string>)[col.key];
        if (v) vals.add(v);
      }
      if (vals.size > 0) result[col.key] = Array.from(vals).sort();
    }
    return result;
  }, [activeCat, products]);
  const optSearchText = optSettingsSearch.trim().toLowerCase();
  const optionMatchedProducts = useMemo(() => {
    if (!optSearchText) return [];
    return products.filter((product) => {
      const specs = product.specs as Record<string, string>;
      const haystack = [
        product.modelNo,
        product.name,
        ...Object.values(specs || {}),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(optSearchText);
    });
  }, [optSearchText, products]);
  const filteredOptionFields = useMemo(() => {
    const keys = Object.keys(fieldOptions);
    if (!optSearchText) return keys;
    return keys.filter((field) => {
      const col = activeCat?.columns?.find((item) => item.key === field);
      const haystack = `${field} ${col?.label || ""} ${(fieldOptions[field] || []).join(" ")}`.toLowerCase();
      if (haystack.includes(optSearchText)) return true;
      return optionMatchedProducts.some((product) => Boolean((product.specs as Record<string, string>)?.[field]));
    });
  }, [activeCat?.columns, fieldOptions, optSearchText, optionMatchedProducts]);
  const filteredOrderItems = useMemo(() => {
    if (!optSearchText) return orderItems;
    const matchedValues = new Set(
      optionMatchedProducts
        .map((product) => (product.specs as Record<string, string>)?.[optImgField])
        .filter((value): value is string => Boolean(value))
    );
    return orderItems.filter((item) => item.toLowerCase().includes(optSearchText) || matchedValues.has(item));
  }, [optImgField, optSearchText, optionMatchedProducts, orderItems]);

  function resetGenerateFormForCategory(cat: SelectionCategory, sourceProducts: SelectionProduct[] = []) {
    const columns = (cat.columns as ColumnDef[]) || [];
    const selectableColumns = generatableProductColumns(columns);
    const optionTexts: Record<string, string> = {};
    selectableColumns.forEach((col) => {
      const vals = new Set<string>();
      sourceProducts.forEach((p) => {
        const value = (p.specs as Record<string, string>)?.[col.key];
        if (value) vals.add(value);
      });
      optionTexts[col.key] = Array.from(vals).sort().join("\n");
    });
    const templates = inferGenerateTemplates(columns, sourceProducts);
    setGenerateModelTemplate(templates.modelTemplate);
    setGenerateNameTemplate(templates.nameTemplate);
    setGenerateOptionTexts(optionTexts);
    setGenerateExcludeRules("");
    setGeneratePreview([]);
    setGeneratePreviewSearch("");
    setGeneratePreviewPage(1);
    setGenerateErrors([]);
  }

  function openGenerateProducts() {
    if (!activeCat) {
      toast("请先选择分类", "error");
      return;
    }
    const selectableColumns = selectableProductColumns;
    if (!selectableColumns.length) {
      toast("当前分类没有可组合生成的选择列", "error");
      return;
    }
    resetGenerateFormForCategory(activeCat, products);
    setShowGenerateModal(true);
  }

  function refreshGeneratePreview() {
    const selectableColumns = selectableGenerateColumns;
    const errors: string[] = [];
    if (!generateCat) errors.push("请先选择分类");
    if (!selectableColumns.length) errors.push("当前分类没有可组合生成的选择列");
    selectableColumns.forEach((col) => {
      if (parseGenerateValues(generateOptionTexts[col.key] || "").length === 0) {
        errors.push(`${col.label || col.key} 没有填写可选值`);
      }
    });

    const preview = errors.length
      ? []
      : buildGeneratedProductDrafts({
          columns: generateColumns,
          optionTexts: generateOptionTexts,
          modelTemplate: generateModelTemplate,
          nameTemplate: generateNameTemplate,
          excludeRules: generateExcludeRules,
          limit: 10000,
        });

    if (preview.length >= 10000) errors.push("组合超过 10000 条，已截断；建议减少选项或增加排除规则");
    if (!preview.length && errors.length === 0) errors.push("排除规则过滤掉了全部组合");
    setGeneratePreview(preview);
    setGeneratePreviewPage(1);
    setGenerateErrors(errors);
  }

  async function importGeneratedProducts() {
    if (!generatePreview.length) {
      refreshGeneratePreview();
      return;
    }
    if (!selectedCatId) {
      toast("请先选择分类", "error");
      return;
    }
    setGenerateImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, generatePreview);
      const msg = updated > 0
        ? `生成导入完成：新增 ${created} 个，更新 ${updated} 个`
        : `已生成导入 ${created} 个产品`;
      toast(msg, "success");
      setShowGenerateModal(false);
      setGeneratePreview([]);
      mutateProds();
      mutateCats();
    } catch (err) {
      toast(getApiErrorMessage(err, "生成导入失败"), "error");
    } finally {
      setGenerateImporting(false);
    }
  }

  async function uploadOptImg(field: string, val: string, file: File) {
    setUploadingVal(`${field}::${val}`);
    try {
      const { url } = await uploadOptionImage(file);
      const updated = { ...optImages, [field]: { ...(optImages[field] || {}), [val]: url } };
      await updateCategory(activeCat!.id, { optionImages: updated });
      mutateCats();
      toast("图片已上传", "success");
    } catch {
      toast("上传失败", "error");
    } finally {
      setUploadingVal(null);
    }
  }

  async function removeOptImg(field: string, val: string) {
    const updated = { ...optImages };
    if (updated[field]) {
      delete updated[field][val];
      if (Object.keys(updated[field]).length === 0) delete updated[field];
    }
    await updateCategory(activeCat!.id, { optionImages: updated });
    mutateCats();
    toast("图片已移除", "success");
  }

  async function handlePaste(e: React.ClipboardEvent) {
    if (!optImgField) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await uploadOptImg(optImgField, "__pasting__", file);
        return;
      }
    }
    // No image — check for URL text
    const text = e.clipboardData.getData("text/plain")?.trim();
    if (text && /^https?:\/\/.+/i.test(text)) {
      e.preventDefault();
      toast("正在下载图片...", "info");
      try {
        const { url } = await uploadOptionImageFromUrl(text);
        const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), ["__pasting__"]: url } };
        await updateCategory(activeCat!.id, { optionImages: updated });
        mutateCats();
        toast("图片已下载并保存", "success");
      } catch {
        toast("下载图片失败，请检查链接", "error");
      }
    }
  }
  const totalCats = categories.length;
  const totalProducts = categories.reduce((s, c) => s + (c.productCount || 0), 0);
  const filteredSelectionCategories = useMemo(() => {
    const base = catFilter === "empty" ? categories.filter((c) => !(c.productCount || 0)) : categories;
    const q = catSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.groupName || "").toLowerCase().includes(q) ||
      (c.icon || "").toLowerCase().includes(q)
    );
  }, [categories, catFilter, catSearch]);
  const openGroupManager = () => {
    const map = new Map<string, { id: string; name: string; icon: string; image: string; imageFit: "cover" | "contain"; catCount: number }>();
    for (const c of categories) {
      if (c.groupId && c.groupName) {
        if (!map.has(c.groupId)) {
          map.set(c.groupId, { id: c.groupId, name: c.groupName, icon: c.groupIcon || "category", image: c.groupImage || "", imageFit: c.groupImageFit === "contain" ? "contain" : "cover", catCount: 0 });
        } else if (!map.get(c.groupId)!.image && c.groupImage) {
          map.get(c.groupId)!.image = c.groupImage;
          map.get(c.groupId)!.imageFit = c.groupImageFit === "contain" ? "contain" : "cover";
        }
        map.get(c.groupId)!.catCount++;
      }
    }
    setGroupItems(Array.from(map.values()));
    setGroupForm({ name: "", icon: "category", image: "", imageFit: "cover" });
    setShowGroupModal(true);
  };

  return (
    <AdminManagementPage
      title="选型管理"
      description="管理选型分类、产品、参数列定义和批量导入数据"
      toolbar={(
        <div className="grid items-start gap-3 md:min-h-11 md:grid-cols-[18rem_minmax(0,1fr)_18rem] md:items-center">
          <ResponsiveSectionTabs
            tabs={[
              { value: "categories", label: "分类管理", count: totalCats, icon: "category" },
              { value: "products", label: "产品管理", count: totalProducts, icon: "inventory_2" },
            ]}
            value={tab}
            onChange={(next) => {
              setTab(next as Tab);
              setCatFilter("all");
            }}
            mobileTitle="选型管理"
          />
          <div className="grid min-w-0 grid-cols-4 items-center gap-1.5 overflow-visible md:flex md:h-9 md:flex-nowrap md:justify-end md:gap-2">
            <button
              onClick={openNewProd}
              disabled={!selectedCatId || !activeCat}
              title={!selectedCatId ? "请先选择分类" : undefined}
              className={SELECTION_TOOLBAR_BUTTON_PRIMARY}
            >
              <SelectionToolbarButtonContent icon="add">新建产品</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => { setBatchParsed(null); setBatchErrors([]); setShowBatchModal(true); }}
              disabled={!selectedCatId || !activeCat}
              title={!selectedCatId ? "请先选择分类" : undefined}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="upload">批量导入</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={openGenerateProducts}
              disabled={!selectedCatId || !activeCat}
              title={!selectedCatId ? "请先选择分类" : undefined}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="auto_awesome">批量生成</SelectionToolbarButtonContent>
            </button>
            <button
              disabled={!selectedCatId || !activeCat}
              title={!selectedCatId ? "请先选择分类" : undefined}
              onClick={exportCurrentProducts}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="download">导出</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => { setOptImgField(""); setOptSettingsSearch(""); setOrderItems([]); setShowOptImgModal(true); }}
              disabled={!selectedCatId || !activeCat}
              title={!selectedCatId ? "请先选择分类" : undefined}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="settings">选项设置</SelectionToolbarButtonContent>
            </button>
            <button onClick={openNewCat} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="add">新建分类</SelectionToolbarButtonContent>
            </button>
            <button onClick={openGroupManager} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="folder">分组管理</SelectionToolbarButtonContent>
            </button>
            <button onClick={() => { setCatSortItems(categories.map((c) => ({ id: c.id, name: c.name }))); setShowCatSortModal(true); }} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="view_list">排序</SelectionToolbarButtonContent>
            </button>
          </div>
          <div className="flex h-9 w-full min-w-0 items-center rounded-sm border border-outline-variant/30 bg-surface-container-lowest px-3 md:w-72 md:justify-self-end">
            <Icon name="search" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
            <input
              value={tab === "categories" ? catSearch : prodSearch}
              onChange={(e) => tab === "categories" ? setCatSearch(e.target.value) : setProdSearch(e.target.value)}
              placeholder={tab === "categories" ? "搜索分类名称、slug 或分组" : "搜索产品名称、型号、参数值"}
              className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
            />
            {(tab === "categories" ? catSearch : prodSearch) && (
              <button onClick={() => tab === "categories" ? setCatSearch("") : setProdSearch("")} className="p-0.5 text-on-surface-variant hover:text-on-surface">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    >

      {/* ===== Categories Tab ===== */}
      {tab === "categories" && (
        <div key="categories-panel" className="admin-tab-panel space-y-3">
          {catFilter === "empty" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Icon name="warning" size={14} className="text-amber-500 shrink-0" />
              <span className="text-xs text-on-surface">仅显示空分类（无产品的分类）</span>
              <button onClick={() => setCatFilter("all")} className="text-xs text-primary-container hover:underline ml-auto shrink-0">显示全部</button>
            </div>
          )}
          {(() => {
            const filtered = filteredSelectionCategories;
            if (filtered.length === 0) return (
              <div className="text-center py-12 text-on-surface-variant">
                <Icon name="inventory_2" size={40} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{catSearch ? "没有匹配的分类" : catFilter === "empty" ? "没有空分类" : "暂无分类"}</p>
              </div>
            );
            return (
              <div className="overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low">
                <div className="sticky top-0 z-10 hidden grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_92px_92px_80px_104px] items-center gap-3 border-b border-outline-variant/10 bg-surface-container-low px-4 py-2 text-xs font-bold text-on-surface-variant md:grid">
                  <span>分类名称</span>
                  <span>分组</span>
                  <span className="text-center">参数列</span>
                  <span className="text-center">产品数</span>
                  <span>排序</span>
                  <span className="text-right">操作</span>
                </div>
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto selection-scrollbarless">
                  {filtered.map((cat) => (
                    <div key={cat.id} className="group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 border-t border-outline-variant/[0.08] px-4 py-4 first:border-t-0 transition-colors hover:bg-surface-container-high/35 md:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_92px_92px_80px_104px] md:items-center md:gap-3 md:py-3">
                      <div className="min-w-0">
                        <div className="flex items-start gap-2.5 md:items-center md:gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-primary-container">
                            <Icon name={cat.icon || "inventory_2"} size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-bold leading-snug text-on-surface md:text-sm">{cat.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant sm:hidden">/{cat.slug}</span>
                          </span>
                          <span className="hidden text-[10px] text-on-surface-variant sm:inline">/{cat.slug}</span>
                        </div>
                        <div className="mt-2 ml-9 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-on-surface-variant/70 md:hidden">
                          <span>{cat.groupName || "未分组"}</span>
                          <span>{(cat.columns as ColumnDef[]).length} 个参数列</span>
                          <span>{cat.productCount ?? 0} 个产品</span>
                          <span>排序 {cat.sortOrder}</span>
                        </div>
                      </div>
                      <span className="hidden min-w-0 truncate text-xs text-on-surface-variant md:block">{cat.groupName || "未分组"}</span>
                      <span className="hidden text-center text-xs tabular-nums text-on-surface md:block">{(cat.columns as ColumnDef[]).length}</span>
                      <span className="hidden text-center text-xs tabular-nums text-on-surface md:block">{cat.productCount ?? 0}</span>
                      <span className="hidden text-xs tabular-nums text-on-surface-variant md:block">{cat.sortOrder}</span>
                      <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5 md:gap-1 md:pt-0">
                        <button onClick={() => openEditCat(cat)} className={SELECTION_ICON_BUTTON_EDIT} aria-label="编辑分类" title="编辑分类">
                          <Icon name="edit" size={14} />
                        </button>
                        {deleteCatId === cat.id ? (
                          <>
                            <button onClick={() => handleDeleteCat(cat.id)} className="h-8 px-2 text-xs font-medium text-error hover:underline md:text-[10px]">确认删除</button>
                            <button onClick={() => setDeleteCatId(null)} className="h-8 px-2 text-xs text-on-surface-variant hover:text-on-surface md:text-[10px]">取消</button>
                          </>
                        ) : (
                          <button onClick={() => setDeleteCatId(cat.id)} className={SELECTION_ICON_BUTTON_DELETE} aria-label="删除分类" title="删除分类">
                            <Icon name="delete" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== Products Tab ===== */}
      {tab === "products" && (
        <div key="products-panel" className="admin-tab-panel space-y-3">
          {/* Category selector */}
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="min-w-0 flex-1">
                <div ref={productCatPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setProductCatOpen((open) => !open);
                      setProductCatQuery("");
                    }}
                    className={`flex min-h-[54px] w-full items-center gap-3 rounded-xl border bg-surface-container-lowest px-3 py-2 text-left transition-all duration-150 ${
                      productCatOpen
                        ? "border-primary-container shadow-sm ring-2 ring-primary-container/10"
                        : "border-outline-variant/20 hover:border-primary-container/40"
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-container/10">
                      <Icon name={activeCat?.icon || "category"} size={16} className="text-primary-container" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-on-surface">{activeCat?.name || "选择分类..."}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant">
                        {activeCat ? `/${activeCat.slug} · ${activeCat.productCount ?? products.length} 个产品` : "选择后维护产品、图片、PDF 和选项设置"}
                      </span>
                    </span>
                    <Icon name="expand_more" size={18} className={`shrink-0 text-on-surface-variant transition-transform ${productCatOpen ? "rotate-180" : ""}`} />
                  </button>
                  {productCatOpen && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[40] overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-lowest shadow-2xl">
                      <div className="border-b border-outline-variant/10 p-2">
                        <div className="relative">
                          <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                          <input
                            autoFocus
                            value={productCatQuery}
                            onChange={(e) => setProductCatQuery(e.target.value)}
                            placeholder="搜索分类名称、slug 或分组"
                            className="w-full rounded-lg border border-outline-variant/15 bg-surface-container-low px-3 py-2 pl-9 text-sm text-on-surface outline-none focus:border-primary-container"
                          />
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto p-1.5">
                        {productCategoryOptions.length > 0 ? productCategoryOptions.map((c) => {
                          const selected = c.id === selectedCatId;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedCatId(c.id);
                                setProdSearch("");
                                setProductCatOpen(false);
                                setProductCatQuery("");
                              }}
                              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                selected ? "bg-primary-container/10 text-primary-container" : "text-on-surface hover:bg-surface-container-high"
                              }`}
                            >
                              <Icon name={c.icon || "category"} size={16} className={selected ? "text-primary-container" : "text-on-surface-variant"} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold">{c.name}</span>
                                <span className="block truncate text-[10px] text-on-surface-variant">/{c.slug}{c.groupName ? ` · ${c.groupName}` : ""}</span>
                              </span>
                              <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] text-on-surface-variant">{c.productCount ?? 0}</span>
                              {selected && <Icon name="check" size={15} className="shrink-0 text-primary-container" />}
                            </button>
                          );
                        }) : (
                          <div className="px-3 py-8 text-center text-xs text-on-surface-variant">没有匹配的分类</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {activeCat ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
                <span>/{activeCat.slug}</span>
                <span>{activeCat.productCount ?? products.length} 个产品</span>
                <span>{productColumns.length} 个参数列</span>
                {activeCat.groupName && <span>{activeCat.groupName}</span>}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-on-surface-variant">选择分类后维护产品、图片、PDF 和选项设置。</p>
            )}
          </div>

          {selectedCatId && activeCat && (
            <>
              {/* Products table */}
              {productsLoading ? (
                <div className="min-h-[320px] overflow-hidden rounded-lg border border-outline-variant/10 bg-surface-container-low">
                  <div className="hidden grid-cols-[repeat(5,minmax(120px,1fr))_96px] gap-3 border-b border-outline-variant/10 bg-surface-container-high px-4 py-3 md:grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className="h-3 rounded-full bg-outline-variant/15" />
                    ))}
                  </div>
                  <div className="space-y-3 p-3 md:p-4">
                    {Array.from({ length: 6 }).map((_, row) => (
                      <div key={row} className="grid gap-3 rounded-xl bg-surface-container-lowest p-3 md:grid-cols-[repeat(5,minmax(120px,1fr))_96px]">
                        {Array.from({ length: 6 }).map((_, col) => (
                          <span
                            key={col}
                            className={`h-3 rounded-full bg-outline-variant/10 ${col === 0 ? "w-4/5" : col === 5 ? "w-12 justify-self-end" : "w-full"}`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-12 text-on-surface-variant">
                  <Icon name="inventory_2" size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">暂无产品</p>
                </div>
              ) : (
                <>
                  {prodSearch && (
                    <p className="text-xs text-on-surface-variant">
                      搜索 "<span className="text-on-surface font-medium">{prodSearch}</span>" 匹配 {filteredProducts.length} / {products.length} 个产品
                    </p>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant">
                      <Icon name="search_off" size={40} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">未找到匹配的产品</p>
                    </div>
                  ) : (
                    <>
                      <div className="md:hidden space-y-2">
                        {visibleProducts.map((p) => {
                          const specs = (p.specs as Record<string, string>) || {};
                          const primaryColumn = productColumns.find((col) => col.displayOnly) || productColumns[0];
                          const title = p.modelNo || (primaryColumn ? specs[primaryColumn.key] : "") || p.name || "未命名产品";
                          const subtitle = p.name && p.name !== title ? p.name : "";
                          const displayColumns = productColumns
                            .filter((col) => col.key !== primaryColumn?.key)
                            .slice(0, 6);

                          return (
                            <div key={p.id} className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-3 shadow-sm">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-bold leading-snug text-on-surface break-words">{title}</div>
                                  {subtitle && <div className="mt-0.5 text-xs leading-snug text-on-surface-variant break-words">{subtitle}</div>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button onClick={() => openEditProd(p)} className={SELECTION_ICON_BUTTON_EDIT} aria-label="编辑产品" title="编辑产品">
                                    <Icon name="edit" size={14} />
                                  </button>
                                  {deleteProdId === p.id ? (
                                    <>
                                      <button onClick={() => handleDeleteProd(p.id)} className="h-8 px-2 text-[10px] font-bold bg-error text-on-error-container rounded">确认</button>
                                      <button onClick={() => setDeleteProdId(null)} className="h-8 px-2 text-[10px] text-on-surface-variant bg-surface-container-high rounded">取消</button>
                                    </>
                                  ) : (
                                    <button onClick={() => setDeleteProdId(p.id)} className={SELECTION_ICON_BUTTON_DELETE} aria-label="删除产品" title="删除产品">
                                      <Icon name="delete" size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                {displayColumns.map((col) => (
                                  <div key={col.key} className="min-w-0 rounded-lg bg-surface-container-lowest px-2 py-1.5">
                                    <div className="truncate text-[10px] leading-tight text-on-surface-variant">
                                      {col.label || col.key}{col.unit ? ` (${col.unit})` : ""}
                                    </div>
                                    <div className="mt-0.5 text-xs font-medium leading-snug text-on-surface break-words line-clamp-2">
                                      {specs[col.key] ?? "—"}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div
                        ref={productTableScrollRef}
                        onScroll={handleProductTableScroll}
                        className="hidden md:block overflow-auto selection-scrollbarless rounded-lg border border-outline-variant/10 max-h-[calc(100vh-280px)]"
                      >
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-surface-container-low">
                              {productColumns.map((col) => (
                                <th key={col.key} className="px-3 py-2 text-left font-bold text-on-surface-variant whitespace-nowrap text-xs">
                                  {col.label}{col.unit ? ` (${col.unit})` : ""}
                                </th>
                              ))}
                              <th className="px-3 py-2 text-right text-xs">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleProducts.map((p) => (
                              <tr key={p.id} className="border-t border-outline-variant/5 hover:bg-surface-container/50">
                                {productColumns.map((col) => (
                                  <td key={col.key} className="px-3 py-2 text-on-surface whitespace-nowrap">
                                    {(p.specs as Record<string, string>)[col.key] ?? "—"}
                                  </td>
                                ))}
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => openEditProd(p)} className={SELECTION_ICON_BUTTON_EDIT} aria-label="编辑产品" title="编辑产品">
                                      <Icon name="edit" size={13} />
                                    </button>
                                    {deleteProdId === p.id ? (
                                      <>
                                        <button onClick={() => handleDeleteProd(p.id)} className="px-1.5 py-0.5 text-[10px] bg-error text-on-error-container rounded">确认</button>
                                        <button onClick={() => setDeleteProdId(null)} className="px-1.5 py-0.5 text-[10px] text-on-surface-variant">取消</button>
                                      </>
                                    ) : (
                                      <button onClick={() => setDeleteProdId(p.id)} className={SELECTION_ICON_BUTTON_DELETE} aria-label="删除产品" title="删除产品">
                                        <Icon name="delete" size={13} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <InfiniteLoadTrigger
                        hasMore={hasMoreProducts}
                        isLoading={false}
                        onLoadMore={loadMoreProducts}
                        buttonless
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}

          {!selectedCatId && (
            <div className="text-center py-12 text-on-surface-variant">
              <Icon name="touch_app" size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">请先选择一个分类</p>
            </div>
          )}
        </div>
      )}

      {/* ===== Category Modal ===== */}
      {showCatModal && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowCatModal(false)} onPaste={async (e) => {
          for (const item of Array.from(e.clipboardData.items)) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) {
                try {
                  const { url } = await uploadOptionImage(file);
                  setCatForm(prev => ({ ...prev, image: url }));
                  toast("图片已粘贴上传", "success");
                } catch { toast("上传失败", "error"); }
              }
              return;
            }
          }
          // Check for URL text
          const text = e.clipboardData.getData("text/plain")?.trim();
          if (text && /^https?:\/\/.+/i.test(text)) {
            e.preventDefault();
            toast("正在下载图片...", "info");
            try {
              const { url } = await uploadOptionImageFromUrl(text);
              setCatForm(prev => ({ ...prev, image: url }));
              toast("图片已下载并保存", "success");
            } catch { toast("下载图片失败", "error"); }
          }
        }}>
          <div className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl sm:relative sm:inset-auto sm:w-[min(96vw,1280px)] sm:max-w-none sm:max-h-[90dvh] sm:rounded-xl sm:border sm:border-outline-variant/20 sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 pb-3 sm:mb-4 sm:border-b-0 sm:pb-0">
              <h2 className="text-base font-bold text-on-surface">{editCat ? "编辑分类" : "新建分类"}</h2>
              <button onClick={() => setShowCatModal(false)} className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface sm:hidden" aria-label="关闭">
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">标识 (slug) *</label>
                  <input value={catForm.slug} onChange={(e) => setCatForm({ ...catForm, slug: e.target.value.replace(/\s+/g, "-").toLowerCase() })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">描述</label>
                <input value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">套件清单标题</label>
                <input
                  value={catForm.kitListTitle}
                  onChange={(e) => setCatForm({ ...catForm, kitListTitle: e.target.value })}
                  placeholder="默认：子零件清单，例如：组装清单 / BOM清单"
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
                <p className="mt-1 text-[10px] text-on-surface-variant">用于选型结果、分享页、复制清单和下载清单；产品参数里的“清单标题”可单独覆盖。</p>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">所属分组（可选）</label>
                <select
                  value={(() => {
                    const editCatObj = editCat ? categories.find(c => c.id === editCat.id) : null;
                    return editCatObj?.groupId || "";
                  })()}
                  onChange={async (e) => {
                    const gid = e.target.value;
                    if (!gid) {
                      if (editCat) await updateCategory(editCat.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                      toast("已移除分组", "success");
                      mutateCats();
                    } else {
                      const src = categories.find(c => c.groupId === gid);
                      if (editCat) await updateCategory(editCat.id, { groupId: gid, groupName: src?.groupName || "", groupIcon: src?.groupIcon || "", groupImage: src?.groupImage || null, groupImageFit: src?.groupImageFit === "contain" ? "contain" : "cover" });
                      toast("已设置分组", "success");
                      mutateCats();
                    }
                  }}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                >
                  <option value="">不分组</option>
                  {(() => {
                    const groupMap = new Map<string, string>();
                    for (const c of categories) {
                      if (c.groupId && c.groupName && !groupMap.has(c.groupId)) groupMap.set(c.groupId, c.groupName);
                    }
                    return Array.from(groupMap.entries()).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ));
                  })()}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">图标名称</label>
                  <input value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} placeholder="如: tune" className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">封面图</label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input value={catForm.image} onChange={(e) => setCatForm({ ...catForm, image: e.target.value })} placeholder="URL 或上传" className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                    <label className="shrink-0">
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          try {
                            const { url } = await uploadOptionImage(f);
                            setCatForm(prev => ({ ...prev, image: url }));
                          } catch { toast("上传失败", "error"); }
                        }
                        e.target.value = "";
                      }} />
                      <span className="px-2.5 py-2 text-xs text-primary-container hover:underline cursor-pointer border border-outline-variant/20 rounded">上传</span>
                    </label>
                  </div>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">支持截图后 Ctrl+V 粘贴上传</p>
                  {catForm.image && (
                    <div className="mt-2 w-20 h-14 rounded overflow-hidden bg-surface-container-lowest border border-outline-variant/10">
                      <SafeImage src={catForm.image} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
              <ColumnEditor columns={catForm.columns} onChange={(columns) => setCatForm({ ...catForm, columns })} />
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-3 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => setShowCatModal(false)} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">取消</button>
              <button onClick={saveCat} disabled={!catForm.name || !catForm.slug} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Product Modal ===== */}
      {showProdModal && activeCat && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowProdModal(false)} onPaste={handleProductAssetPaste}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-on-surface shrink-0">{editProd ? "编辑产品" : "新建产品"}</h2>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">型号编号</label>
                  <input value={prodForm.modelNo} onChange={(e) => setProdForm({ ...prodForm, modelNo: e.target.value })} className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">产品图片 URL</label>
                  <input value={prodForm.image} onChange={(e) => setProdForm({ ...prodForm, image: e.target.value })} placeholder="https://..." className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">PDF 规格书 URL</label>
                  <input value={prodForm.pdfUrl} onChange={(e) => setProdForm({ ...prodForm, pdfUrl: e.target.value })} placeholder="https://..." className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
                </div>
              </div>
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setProductAssetDragging(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setProductAssetDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.currentTarget === e.target) setProductAssetDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleProductAssetFiles(e.dataTransfer.files);
                }}
                className={`rounded-xl border border-dashed p-3 transition-colors ${
                  productAssetDragging
                    ? "border-primary-container bg-primary-container/10"
                    : "border-outline-variant/30 bg-surface-container-high/30"
                }`}
              >
                <input
                  ref={productAssetInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void handleProductAssetFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[88px_1fr] sm:items-center">
                  <button
                    type="button"
                    onClick={() => productAssetInputRef.current?.click()}
                    disabled={productAssetUploading}
                    className="flex h-20 items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                  >
                    <Icon name={productAssetUploading ? "hourglass_empty" : "upload_file"} size={28} className={productAssetUploading ? "animate-spin" : ""} />
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface">拖拽图片或 PDF 到这里</p>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">也可以点击选择文件，或直接截图后 Ctrl+V 粘贴。图片会填入产品图片，PDF 会填入规格书链接。</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {prodForm.image && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="image" size={13} />
                          <span className="truncate">图片已设置</span>
                        </span>
                      )}
                      {prodForm.pdfUrl && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="picture_as_pdf" size={13} />
                          <span className="truncate">PDF 已设置</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {(prodForm.image || prodForm.pdfUrl) && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {prodForm.image && (
                    <div className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-2">
                      <div className="h-24 overflow-hidden rounded bg-surface-container-high">
                        <SafeImage src={prodForm.image} alt="" className="h-full w-full object-contain p-1" fallbackIcon="image" />
                      </div>
                    </div>
                  )}
                  {prodForm.pdfUrl && (
                    <a href={prodForm.pdfUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-3 text-xs text-on-surface-variant hover:text-on-surface">
                      <Icon name="picture_as_pdf" size={22} className="text-error" />
                      <span className="min-w-0 flex-1 truncate">{prodForm.pdfUrl}</span>
                    </a>
                  )}
                </div>
              )}
              {(activeCat.columns as ColumnDef[]).map((col) => (
                <div key={col.key}>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {col.label}{col.unit ? ` (${col.unit})` : ""}
                  </label>
                  <input
                    value={prodForm.specs[col.key] || ""}
                    onChange={(e) => setProdForm({ ...prodForm, specs: { ...prodForm.specs, [col.key]: e.target.value } })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              ))}

              {/* Kit / BOM toggle */}
              <div className="border-t border-outline-variant/10 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-on-surface">套件（含子零件）</p>
                    <p className="text-xs text-on-surface-variant">开启后可添加子零件清单</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProdForm({ ...prodForm, isKit: !prodForm.isKit })}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${prodForm.isKit ? "bg-primary-container" : "bg-outline-variant/30"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${prodForm.isKit ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>

                {prodForm.isKit && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-on-surface-variant">子零件清单</span>
                      <button
                        type="button"
                        onClick={() => setProdForm({
                          ...prodForm,
                          components: [...prodForm.components, { name: "", modelNo: "", qty: 1, specs: {} }],
                        })}
                        className="text-xs text-primary-container hover:underline"
                      >
                        + 添加子零件
                      </button>
                    </div>
                    {prodForm.components.map((comp, i) => (
                      <div key={i} className="flex items-start gap-2 bg-surface-container-high/50 rounded-lg p-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            value={comp.name}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], name: e.target.value };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="零件名"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            value={comp.modelNo || ""}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], modelNo: e.target.value };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="型号"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            type="number"
                            min={1}
                            value={comp.qty}
                            onChange={(e) => {
                              const next = [...prodForm.components];
                              next[i] = { ...next[i], qty: Math.max(1, parseInt(e.target.value) || 1) };
                              setProdForm({ ...prodForm, components: next });
                            }}
                            placeholder="数量"
                            className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setProdForm({ ...prodForm, components: prodForm.components.filter((_, idx) => idx !== i) })}
                          className="text-error/70 hover:text-error shrink-0 mt-1"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => setShowProdModal(false)} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">取消</button>
              <button onClick={saveProd} disabled={!prodForm.name} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Unified Option Settings Modal ===== */}
      {showOptImgModal && activeCat && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowOptImgModal(false)} onPaste={handlePaste}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-none bg-surface-container-low rounded-2xl border border-outline-variant/20 p-3 space-y-3 flex min-h-0 flex-col overflow-hidden shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-2xl sm:max-h-[90dvh] sm:p-5 sm:space-y-4 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 shrink-0 pb-2 border-b border-outline-variant/10 sm:pb-0 sm:border-b-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-on-surface leading-snug">选项设置</h2>
                <p className="mt-0.5 text-xs text-on-surface-variant truncate">{activeCat.name}</p>
              </div>
              <button onClick={() => setShowOptImgModal(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={18} /></button>
            </div>
            <p className="hidden sm:block text-xs leading-relaxed text-on-surface-variant shrink-0">拖拽调整顺序，点击图片上传/更换，点击编辑图标修改名称。</p>

            {/* Field selector + view toggle */}
            <div className="grid grid-cols-1 gap-2 shrink-0 pb-2 border-b border-outline-variant/10 sm:flex sm:flex-wrap sm:items-center sm:pb-0 sm:border-b-0">
              <select value={optImgField} onChange={(e) => {
                const f = e.target.value;
                setOptImgField(f);
                setOptSettingsSearch("");
                if (f) {
                  const vals = fieldOptions[f] || [];
                  const savedOrderRaw = (activeCat.optionOrder as Record<string, string[] | string>)?.[f];
                  const savedOrder = Array.isArray(savedOrderRaw) ? savedOrderRaw : [];
                  const ordered = savedOrder.filter((v) => vals.includes(v));
                  const rest = vals.filter((v) => !savedOrder.includes(v));
                  setOrderItems([...ordered, ...rest]);
                } else {
                  setOrderItems([]);
                }
              }} className="w-full sm:w-48 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container">
                <option value="">选择字段...</option>
                {filteredOptionFields.map((f) => (
                  <option key={f} value={f}>{f} ({fieldOptions[f].length} 个选项)</option>
                ))}
              </select>
              {optImgField && (
                <div className="relative w-full sm:flex-1">
                  <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                  <input
                    value={optSettingsSearch}
                    onChange={(e) => setOptSettingsSearch(e.target.value)}
                    placeholder="搜索选项、型号或产品名..."
                    className="w-full rounded bg-surface-container-lowest py-2 pl-8 pr-8 text-sm text-on-surface outline-none border border-outline-variant/20 focus:border-primary-container"
                  />
                  {optSettingsSearch && (
                    <button
                      onClick={() => setOptSettingsSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                      aria-label="清空搜索"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              )}
              {optSettingsSearch && (
                <span className="text-[11px] text-on-surface-variant sm:mr-auto">
                  {optImgField ? `${filteredOrderItems.length}/${orderItems.length} 个选项` : `${filteredOptionFields.length}/${Object.keys(fieldOptions).length} 个字段`}
                </span>
              )}
              {optImgField && (
                <div className="grid grid-cols-2 rounded-md border border-outline-variant/20 overflow-hidden shrink-0 sm:flex">
                  <button
                    onClick={() => setOptViewMode("grid")}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === "grid" ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"}`}
                    title="卡片视图"
                  >
                    <Icon name="grid_view" size={14} /> 卡片
                  </button>
                  <button
                    onClick={() => setOptViewMode("list")}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === "list" ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"}`}
                    title="列表视图"
                  >
                    <Icon name="view_list" size={14} /> 列表
                  </button>
                </div>
              )}
              {optImgField && orderItems.length > 0 && (
                <button
                  onClick={() => {
                    const colDef = activeCat?.columns?.find((c: any) => c.key === optImgField);
                    setOrderItems(smartSortOptions(orderItems, colDef?.sortType));
                  }}
                  className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 rounded-md hover:bg-surface-container-high hover:text-on-surface transition-colors shrink-0"
                  title="按智能规则排序（螺纹/数字优先）"
                >
                  <Icon name="sort" size={13} className="mr-0.5" /> 一键排序
                </button>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-0.5 pb-2">
              {!optImgField || orderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="tune" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">请选择要设置的字段</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">选择字段后可调整选项顺序、修改名称或上传图片。</p>
                  </div>
                </div>
              ) : filteredOrderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="search_off" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">没有匹配的选项</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">换个关键词，或清空搜索查看全部选项。</p>
                  </div>
                </div>
              ) : optViewMode === "grid" ? (
                /* ===== Card Grid View (for images) ===== */
                <div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  {filteredOrderItems.map((val) => {
                    const i = orderItems.indexOf(val);
                    const imgUrl = optImages[optImgField]?.[val];
                    const isUploading = uploadingVal === `${optImgField}::${val}`;
                    return (
                      <div
                        key={val}
                        draggable
                        onDragStart={() => setOrderDragIdx(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (orderDragIdx === null || orderDragIdx === i) return;
                          const next = [...orderItems];
                          const [item] = next.splice(orderDragIdx, 1);
                          next.splice(i, 0, item);
                          setOrderItems(next);
                          setOrderDragIdx(i);
                        }}
                        onDragEnd={() => setOrderDragIdx(null)}
                        className={`rounded-lg border bg-surface-container p-2.5 sm:p-3 space-y-2 transition-opacity cursor-grab active:cursor-grabbing ${
                          orderDragIdx === i ? "opacity-40 border-primary-container/30" : "border-outline-variant/20"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface-variant/40 select-none text-xs shrink-0">⠿</span>
                          <span className="text-xs font-medium text-on-surface break-words line-clamp-2 flex-1 min-w-0">{val}</span>
                          <button
                            onClick={() => { setRenameField(optImgField); setRenameOldVal(val); setRenameNewVal(val); }}
                            className={SELECTION_ICON_BUTTON_EDIT}
                            title="改名"
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        </div>
                        <button
                          onClick={() => setEditOptVal(val)}
                          className="w-full aspect-[2.2/1] min-[430px]:aspect-square rounded bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-outline-variant/10 hover:border-primary-container/30 transition-colors"
                        >
                          {isUploading ? (
                            <Icon name="hourglass_empty" size={24} className="text-on-surface-variant animate-spin" />
                          ) : imgUrl ? (
                            <SafeImage src={imgUrl} alt={val} className="w-full h-full object-contain" fallbackIcon="add_photo_alternate" />
                          ) : (
                            <Icon name="add_photo_alternate" size={24} className="text-on-surface-variant/30" />
                          )}
                        </button>
                        <span className="block text-center text-[10px] text-primary-container">
                          {imgUrl ? "点击更换" : "点击上传"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ===== List View (for sorting & rename) ===== */
                <div className="space-y-1">
                  {filteredOrderItems.map((val) => {
                    const i = orderItems.indexOf(val);
                    return (
                      <div
                        key={val}
                        draggable
                        onDragStart={() => setOrderDragIdx(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (orderDragIdx === null || orderDragIdx === i) return;
                          const next = [...orderItems];
                          const [item] = next.splice(orderDragIdx, 1);
                          next.splice(i, 0, item);
                          setOrderItems(next);
                          setOrderDragIdx(i);
                        }}
                        onDragEnd={() => setOrderDragIdx(null)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                          orderDragIdx === i
                            ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                            : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                        }`}
                      >
                        <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm shrink-0">⠿</span>
                        <span className="text-sm font-medium text-on-surface flex-1 min-w-0 break-words">{val}</span>
                        {optImages[optImgField]?.[val] && (
                          <SafeImage src={optImages[optImgField][val]} alt="" className="w-7 h-7 object-contain rounded shrink-0" fallbackIcon="image" />
                        )}
                        <button
                          onClick={() => { setRenameField(optImgField); setRenameOldVal(val); setRenameNewVal(val); }}
                          className={SELECTION_ICON_BUTTON_EDIT}
                          title="改名"
                        >
                          <Icon name="edit" size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save order button */}
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 bg-surface-container-low sm:flex sm:justify-end">
              <button onClick={() => setShowOptImgModal(false)} className="px-3 py-2.5 sm:py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">关闭</button>
              <button
                onClick={async () => {
                  if (!optImgField || orderItems.length === 0) {
                    toast("请先选择要设置的字段", "error");
                    return;
                  }
                  try {
                    const currentOrder = (activeCat.optionOrder as Record<string, string[] | string>) || {};
                    await updateCategory(activeCat.id, {
                      optionOrder: { ...currentOrder, [optImgField]: orderItems },
                    });
                    toast("设置已保存", "success");
                    mutateCats();
                  } catch (err) {
                    console.error("保存设置失败:", err);
                    toast("保存失败", "error");
                  }
                }}
                disabled={!optImgField || orderItems.length === 0}
                className="px-3 py-2.5 sm:py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Single Option Upload Dialog ===== */}
      {editOptVal && optImgField && (
        <div className="fixed inset-0 z-[330] flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={() => setEditOptVal(null)} onPaste={async (e) => {
          // Check for image first
          for (const item of Array.from(e.clipboardData.items)) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) await uploadOptImg(optImgField, editOptVal, file);
              return;
            }
          }
          // Check for URL text
          const text = e.clipboardData.getData("text/plain")?.trim();
          if (text && /^https?:\/\/.+/i.test(text)) {
            e.preventDefault();
            toast("正在下载图片...", "info");
            try {
              const { url } = await uploadOptionImageFromUrl(text);
              const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), [editOptVal]: url } };
              await updateCategory(activeCat!.id, { optionImages: updated });
              mutateCats();
              toast("图片已下载并保存", "success");
            } catch {
              toast("下载图片失败，请检查链接是否有效", "error");
            }
          }
        }}>
          <div className="flex max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-sm flex-col gap-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 shadow-2xl sm:max-h-[min(620px,90dvh)] sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold leading-snug text-on-surface">上传选项图片</h3>
                <p className="mt-1 text-xs leading-snug text-on-surface-variant break-words">{editOptVal}</p>
              </div>
              <button onClick={() => setEditOptVal(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={16} /></button>
            </div>
            {(() => {
              const imgUrl = optImages[optImgField]?.[editOptVal];
              const isUploading = uploadingVal === `${optImgField}::${editOptVal}`;
              return (
                <>
                  <div className="min-h-0 overflow-y-auto">
                    <div className="flex flex-col gap-4">
                      <div className="w-full aspect-[4/3] max-h-[38dvh] rounded-xl bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-outline-variant/10">
                        {isUploading ? (
                          <Icon name="hourglass_empty" size={30} className="text-on-surface-variant animate-spin" />
                        ) : imgUrl ? (
                          <SafeImage src={imgUrl} alt={editOptVal} className="w-full h-full object-contain p-2" fallbackIcon="add_photo_alternate" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-on-surface-variant/40">
                            <Icon name="add_photo_alternate" size={30} />
                            <span className="text-xs">暂无图片</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-on-surface-variant text-center">支持选择本地图片，也可以复制截图或远程图片地址后粘贴。</p>
                    </div>
                  </div>
                  <div className="shrink-0 space-y-2 pt-1">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex-1">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadOptImg(optImgField, editOptVal, f);
                            e.target.value = "";
                          }}
                        />
                        <span className="block text-center px-3 py-3 text-xs font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 cursor-pointer">
                          选择图片
                        </span>
                      </label>
                      <button
                        onClick={async () => {
                          try {
                            const clipboardItems = await navigator.clipboard.read();
                            for (const item of clipboardItems) {
                              for (const type of item.types) {
                                if (type.startsWith("image/")) {
                                  const blob = await item.getType(type);
                                  const file = new File([blob], `${optImgField}_${editOptVal}.png`, { type });
                                  await uploadOptImg(optImgField, editOptVal, file);
                                  return;
                                }
                                // Check for URL in text clipboard
                                if (type === "text/plain") {
                                  const blob = await item.getType(type);
                                  const text = await blob.text();
                                  const url = text.trim();
                                  if (/^https?:\/\/.+/i.test(url)) {
                                    toast("正在下载图片...", "info");
                                    const { url: localUrl } = await uploadOptionImageFromUrl(url);
                                    const updated = { ...optImages, [optImgField]: { ...(optImages[optImgField] || {}), [editOptVal]: localUrl } };
                                    await updateCategory(activeCat!.id, { optionImages: updated });
                                    mutateCats();
                                    toast("图片已下载并保存", "success");
                                    return;
                                  }
                                }
                              }
                            }
                            toast("剪贴板中没有图片，请先截图或复制图片链接", "error");
                          } catch {
                            toast("无法读取剪贴板，请使用 Ctrl+V 粘贴或选择文件上传", "error");
                          }
                        }}
                        className="flex-1 px-3 py-3 text-xs font-medium bg-surface-container-high text-on-surface rounded-lg hover:opacity-90"
                      >
                        从剪贴板粘贴
                      </button>
                    </div>
                    {imgUrl && (
                      <button onClick={() => { removeOptImg(optImgField, editOptVal); }} className="w-full py-2 text-xs text-error/70 hover:text-error text-center">
                        移除图片
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===== Single Rename Dialog ===== */}
      {renameOldVal && renameField && activeCat && (
        <div className="fixed inset-0 z-[330] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setRenameOldVal("")}>
          <div className="max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-xs overflow-y-auto rounded-t-2xl border border-outline-variant/20 bg-surface-container-low p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:max-h-[90dvh] sm:rounded-xl sm:p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-on-surface">修改选项值</h3>
              <button onClick={() => setRenameOldVal("")} className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"><Icon name="close" size={16} /></button>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">当前值</label>
              <p className="text-sm text-on-surface font-medium bg-surface-container-lowest px-3 py-2 rounded border border-outline-variant/10 break-words">{renameOldVal}</p>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">改为</label>
              <input value={renameNewVal} onChange={(e) => setRenameNewVal(e.target.value)} autoFocus className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button onClick={() => setRenameOldVal("")} className="px-3 py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded">取消</button>
              <button
                onClick={async () => {
                  if (!renameNewVal.trim() || renameNewVal === renameOldVal) return;
                  setRenaming(true);
                  try {
                    const newVal = renameNewVal.trim();
                    const { updated } = await renameOptionValue(activeCat.id, renameField, renameOldVal, newVal);
                    toast(`"${renameOldVal}" → "${newVal}"，已替换 ${updated} 个产品`, "success");
                    // Update local orderItems to reflect the rename immediately
                    setOrderItems((prev) => prev.map((v) => (v === renameOldVal ? newVal : v)));
                    mutateCats();
                    mutateProds();
                    setRenameOldVal("");
                    setRenameNewVal("");
                  } catch {
                    toast("替换失败", "error");
                  } finally {
                    setRenaming(false);
                  }
                }}
                disabled={renaming || !renameNewVal.trim() || renameNewVal === renameOldVal}
                className="px-3 py-2 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {renaming ? "替换中..." : "确认替换"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Product Generator Modal ===== */}
      {showGenerateModal && generateCat && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowGenerateModal(false)}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-[min(96vw,1100px)] sm:max-w-none sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 space-y-3">
              <div>
                <h2 className="text-base font-bold text-on-surface">批量生成产品组合</h2>
                <p className="mt-1 text-xs text-on-surface-variant">按当前已选分类的参数列组合生成型号；不允许的组合写到排除规则里。相同型号会自动更新。</p>
              </div>
              <div className="rounded-lg border border-primary-container/15 bg-primary-container/5 px-3 py-2 text-xs text-on-surface-variant">
                将生成到当前分类：<span className="font-bold text-on-surface">{generateCat.name}</span>，共 {selectableGenerateColumns.length} 个生成字段。
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <label>
                  <span className="mb-1 block text-xs text-on-surface-variant">型号模板</span>
                  <input
                    value={generateModelTemplate}
                    onChange={(e) => setGenerateModelTemplate(e.target.value)}
                    placeholder={`如：${generateTemplateExample}`}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                  <span className="mt-1 block text-[10px] text-on-surface-variant">只把需要组成型号的字段写进模板，例如 `[系列]-[规格]`，不要把所有参数都拼进去。</span>
                </label>
                <label>
                  <span className="mb-1 block text-xs text-on-surface-variant">名称模板</span>
                  <input
                    value={generateNameTemplate}
                    onChange={(e) => setGenerateNameTemplate(e.target.value)}
                    placeholder="不填则使用型号"
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                  <span className="mt-1 block text-[10px] text-on-surface-variant">名称建议写产品名称本身，不要带型号编号；不填时会用型号编号兜底。</span>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectableGenerateColumns.map((col) => {
                  const values = parseGenerateValues(generateOptionTexts[col.key] || "");
                  return (
                    <label key={col.key} className="rounded-xl border border-outline-variant/10 bg-surface-container-high/30 p-3">
                      <span className="mb-1 flex items-center justify-between gap-2 text-xs text-on-surface-variant">
                        <span>{col.label || col.key}{col.unit ? ` (${col.unit})` : ""}</span>
                        <span>{values.length} 个</span>
                      </span>
                      <textarea
                        value={generateOptionTexts[col.key] || ""}
                        onChange={(e) => {
                          setGenerateOptionTexts((prev) => ({ ...prev, [col.key]: e.target.value }));
                          setGeneratePreview([]);
                        }}
                        placeholder="一行一个选项，也支持逗号分隔"
                        rows={5}
                        className="w-full resize-y bg-surface-container-lowest text-on-surface text-xs rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                      />
                    </label>
                  );
                })}
              </div>

              <label className="block">
                <span className="mb-1 block text-xs text-on-surface-variant">排除规则（每行一条，全部条件满足时不生成）</span>
                <textarea
                  value={generateExcludeRules}
                  onChange={(e) => {
                    setGenerateExcludeRules(e.target.value);
                    setGeneratePreview([]);
                  }}
                  placeholder={generateExcludeExample}
                  rows={4}
                  className="w-full resize-y bg-surface-container-lowest text-on-surface text-xs rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
                <span className="mt-1 block text-[10px] text-on-surface-variant">`*` 表示该字段有值就匹配；多个禁止值可用 `|` 分隔。</span>
              </label>

              <div className="space-y-2 rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-on-surface">生成预览</p>
                    <p className="text-xs text-on-surface-variant">
                      {generatePreview.length
                        ? `将生成 ${generatePreview.length} 条产品，预览 ${3 + selectableGenerateColumns.length} 列${generatePreviewSearch ? `，已筛选 ${filteredGeneratePreview.length} 条` : ""}`
                        : "点击预览后再确认导入"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshGeneratePreview}
                    className="px-3 py-2 text-xs font-bold bg-surface-container-high text-on-surface rounded-md hover:opacity-90"
                  >
                    生成预览
                  </button>
                </div>
                {generateErrors.length > 0 && (
                  <div className="space-y-1">
                    {generateErrors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-500">{err}</p>
                    ))}
                  </div>
                )}
                {generatePreview.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="relative sm:w-72">
                        <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                        <input
                          value={generatePreviewSearch}
                          onChange={(e) => {
                            setGeneratePreviewSearch(e.target.value);
                            setGeneratePreviewPage(1);
                          }}
                          placeholder="搜索名称、型号或参数"
                          className="w-full rounded-md border border-outline-variant/20 bg-surface-container-low px-8 py-2 text-xs text-on-surface outline-none focus:border-primary-container"
                        />
                        {generatePreviewSearch && (
                          <button
                            type="button"
                            onClick={() => {
                              setGeneratePreviewSearch("");
                              setGeneratePreviewPage(1);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                            title="清空搜索"
                          >
                            <Icon name="close" size={14} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                        <span>每页</span>
                        <select
                          value={generatePreviewPageSize}
                          onChange={(e) => {
                            setGeneratePreviewPageSize(Number(e.target.value));
                            setGeneratePreviewPage(1);
                          }}
                          className="rounded-md border border-outline-variant/20 bg-surface-container-low px-2 py-1.5 text-xs text-on-surface outline-none focus:border-primary-container"
                        >
                          {[30, 50, 100, 200].map((size) => (
                            <option key={size} value={size}>{size} 条</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg border border-outline-variant/10">
                      <table className="min-w-full text-xs">
                        <thead className="sticky top-0 z-10 bg-surface-container-low text-on-surface-variant">
                          <tr>
                            <th className="sticky left-0 z-20 bg-surface-container-low px-2 py-1.5 text-left">#</th>
                            <th className="px-2 py-1.5 text-left whitespace-nowrap">名称</th>
                            <th className="px-2 py-1.5 text-left whitespace-nowrap">型号编号</th>
                            {selectableGenerateColumns.map((col) => (
                              <th key={col.key} className="px-2 py-1.5 text-left whitespace-nowrap">
                                {col.label || col.key}{col.unit ? ` (${col.unit})` : ""}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedGeneratePreview.map((p, i) => (
                            <tr key={`${p.modelNo}-${generatePreviewStart + i}`} className="border-t border-outline-variant/5">
                              <td className="sticky left-0 z-10 bg-surface-container-lowest px-2 py-1 text-on-surface-variant/50">{generatePreviewStart + i + 1}</td>
                              <td className="px-2 py-1 text-on-surface whitespace-nowrap">{p.name}</td>
                              <td className="px-2 py-1 text-on-surface font-mono whitespace-nowrap">{p.modelNo}</td>
                              {selectableGenerateColumns.map((col) => (
                                <td key={col.key} className="px-2 py-1 text-on-surface whitespace-nowrap">
                                  {p.specs[col.key] || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {pagedGeneratePreview.length === 0 && (
                            <tr className="border-t border-outline-variant/5">
                              <td colSpan={3 + selectableGenerateColumns.length} className="px-2 py-6 text-center text-on-surface-variant">没有匹配的预览数据</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col gap-2 text-xs text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        第 {generatePreviewPage} / {generatePreviewTotalPages} 页，显示 {filteredGeneratePreview.length ? `${generatePreviewStart + 1}-${Math.min(generatePreviewStart + generatePreviewPageSize, filteredGeneratePreview.length)}` : "0"} / {filteredGeneratePreview.length} 条
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setGeneratePreviewPage(1)}
                          disabled={generatePreviewPage <= 1}
                          className="rounded border border-outline-variant/20 px-2 py-1 disabled:opacity-40"
                        >
                          首页
                        </button>
                        <button
                          type="button"
                          onClick={() => setGeneratePreviewPage((page) => Math.max(1, page - 1))}
                          disabled={generatePreviewPage <= 1}
                          className="rounded border border-outline-variant/20 px-2 py-1 disabled:opacity-40"
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setGeneratePreviewPage((page) => Math.min(generatePreviewTotalPages, page + 1))}
                          disabled={generatePreviewPage >= generatePreviewTotalPages}
                          className="rounded border border-outline-variant/20 px-2 py-1 disabled:opacity-40"
                        >
                          下一页
                        </button>
                        <button
                          type="button"
                          onClick={() => setGeneratePreviewPage(generatePreviewTotalPages)}
                          disabled={generatePreviewPage >= generatePreviewTotalPages}
                          className="rounded border border-outline-variant/20 px-2 py-1 disabled:opacity-40"
                        >
                          末页
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => setShowGenerateModal(false)} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">取消</button>
              <button
                onClick={importGeneratedProducts}
                disabled={generateImporting || generatePreview.length === 0}
                className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
              >
                {generateImporting ? "导入中..." : `确认导入 ${generatePreview.length} 条`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Batch Import Modal ===== */}
      {showBatchModal && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => { setShowBatchModal(false); setBatchParsed(null); setBatchErrors([]); }}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="shrink-0 space-y-2">
              <h2 className="text-base font-bold text-on-surface">批量导入产品</h2>
              <p className="text-xs text-on-surface-variant">支持 .xlsx / .csv。按当前分类参数列生成模板；相同“型号编号”的产品会自动更新。</p>
              <div className="rounded-lg bg-surface-container-high/40 px-3 py-2 text-[11px] leading-5 text-on-surface-variant">
                <span className="font-bold text-on-surface">填写规则：</span>
                名称只写产品名称，不要带型号编号；型号编号单独填在“型号编号”列。后面的参数列必须和当前分类参数列对应。
              </div>
              <button
                type="button"
                onClick={downloadProductImportTemplate}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2.5 py-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container-high"
              >
                <Icon name="download" size={14} /> 下载当前分类模板
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-4">

            {/* File upload area */}
            {!batchParsed && (
              <div className="space-y-3">
                <label
                  className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-outline-variant/30 rounded-lg cursor-pointer hover:border-primary-container/50 hover:bg-primary-container/5 transition-colors"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("border-primary-container/60", "bg-primary-container/5");
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove("border-primary-container/60", "bg-primary-container/5");
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-primary-container/60", "bg-primary-container/5");
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleExcelFile(f);
                  }}
                >
                  <Icon name="upload_file" size={28} className="text-on-surface-variant/40 mb-2" />
                  <span className="text-sm text-on-surface-variant">点击选择或拖拽导入文件</span>
                  <span className="text-[10px] text-on-surface-variant/50 mt-1">
                    .xlsx / .csv，最大 {uploadPolicy.selectionImportMaxSizeMb}MB，最多 {uploadPolicy.selectionImportMaxRows} 行
                  </span>
                  <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleExcelFile(f);
                    e.target.value = "";
                  }} />
                </label>
                {batchErrors.length > 0 && (
                  <div className="space-y-1">
                    {batchErrors.map((err, i) => (
                      <p key={i} className="text-xs text-error">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Preview parsed data */}
            {batchParsed && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Icon name="check_circle" size={16} className="text-green-500" />
                  <span className="text-on-surface font-medium">解析成功：{batchParsed.length} 条产品</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setBatchParsed(null); setBatchErrors([]); }}
                  className="text-xs text-primary-container hover:underline"
                >
                  重新选择文件
                </button>
                <div className="max-h-48 overflow-y-auto scrollbar-hidden rounded-lg border border-outline-variant/10">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-surface-container-low text-on-surface-variant">
                        <th className="px-2 py-1.5 text-left">#</th>
                        <th className="px-2 py-1.5 text-left">名称</th>
                        <th className="px-2 py-1.5 text-left">型号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchParsed.slice(0, 20).map((p, i) => (
                        <tr key={i} className="border-t border-outline-variant/5">
                          <td className="px-2 py-1 text-on-surface-variant/50">{i + 1}</td>
                          <td className="px-2 py-1 text-on-surface truncate max-w-[150px]">{p.name}</td>
                          <td className="px-2 py-1 text-on-surface font-mono">{p.modelNo}</td>
                        </tr>
                      ))}
                      {batchParsed.length > 20 && (
                        <tr className="border-t border-outline-variant/5">
                          <td colSpan={3} className="px-2 py-1 text-on-surface-variant text-center">... 还有 {batchParsed.length - 20} 条</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {batchErrors.length > 0 && (
                  <div className="space-y-1">
                    {batchErrors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-500">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>

            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button onClick={() => { setShowBatchModal(false); setBatchParsed(null); setBatchErrors([]); }} className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded">
                {batchParsed ? "取消" : "关闭"}
              </button>
              {batchParsed && (
                <button onClick={handleBatchImport} disabled={batchImporting} className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50">
                  {batchImporting ? "导入中..." : `确认导入 ${batchParsed.length} 条`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== Group Management Modal ===== */}
      {showGroupModal && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => { setShowGroupModal(false); setManageGroupCatsId(null); }}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>

            {/* --- Sub-view: manage categories in a group --- */}
            {manageGroupCatsId ? (() => {
              const g = groupItems.find((gi) => gi.id === manageGroupCatsId);
              const catsInGroup = categories.filter((c) => c.groupId === manageGroupCatsId);
              const otherCats = categories.filter((c) => c.groupId !== manageGroupCatsId);
              const updateManagedGroup = (patch: Partial<{ name: string; icon: string; image: string; imageFit: "cover" | "contain" }>) => {
                setGroupItems(items => items.map(item => item.id === manageGroupCatsId ? { ...item, ...patch } : item));
              };
              const saveManagedGroupSettings = async () => {
                if (!g?.name.trim()) {
                  toast("请输入分组名称", "error");
                  return;
                }
                try {
                  for (const c of catsInGroup) {
                    await updateCategory(c.id, {
                      groupName: g.name.trim(),
                      groupIcon: g.icon.trim() || "category",
                      groupImage: g.image || null,
                      groupImageFit: g.imageFit,
                    });
                  }
                  toast("分组设置已保存", "success");
                  mutateCats();
                } catch (err) {
                  toast(getApiErrorMessage(err, "分组设置保存失败"), "error");
                }
              };
              const saveManagedGroupImage = async (image = g?.image || "", imageFit: "cover" | "contain" = g?.imageFit || "cover") => {
                try {
                  for (const c of catsInGroup) {
                    await updateCategory(c.id, { groupImage: image || null, groupImageFit: imageFit });
                  }
                  mutateCats();
                  return true;
                } catch (err) {
                  toast(getApiErrorMessage(err, "封面设置保存失败"), "error");
                  return false;
                }
              };
              const uploadManagedGroupImageFromUrl = async (imageUrl?: string) => {
                const targetUrl = imageUrl?.trim() || "";
                if (!targetUrl) return false;
                if (!/^https?:\/\/.+/i.test(targetUrl)) {
                  return false;
                }
                try {
                  toast("正在下载图片...", "info");
                  const { url } = await uploadOptionImageFromUrl(targetUrl);
                  if (await saveManagedGroupImage(url, g?.imageFit || "cover")) {
                    updateManagedGroup({ image: url });
                    toast("图片已下载并保存", "success");
                  }
                  return true;
                } catch {
                  toast("下载图片失败", "error");
                  return true;
                }
              };
              const uploadManagedGroupFile = async (file: File) => {
                try {
                  const { url } = await uploadOptionImage(file);
                  if (await saveManagedGroupImage(url, g?.imageFit || "cover")) {
                    updateManagedGroup({ image: url });
                    toast("分组封面已上传", "success");
                  }
                } catch (err) {
                  toast(getApiErrorMessage(err, "上传失败"), "error");
                }
              };
              const importManagedGroupCover = async () => {
                try {
                  if (navigator.clipboard?.read) {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                      const imageType = item.types.find((type) => type.startsWith("image/"));
                      if (imageType) {
                        const blob = await item.getType(imageType);
                        await uploadManagedGroupFile(new File([blob], `group-cover.${imageType.split("/")[1] || "png"}`, { type: imageType }));
                        return;
                      }
                    }
                  }
                  const text = await navigator.clipboard?.readText?.();
                  if (text && await uploadManagedGroupImageFromUrl(text)) return;
                } catch {
                  // Clipboard permission may be unavailable; file picker is the graceful fallback.
                }
                groupCoverInputRef.current?.click();
              };
              const handleManagedGroupCoverPaste = async (e: React.ClipboardEvent) => {
                for (const item of Array.from(e.clipboardData.items)) {
                  if (item.type.startsWith("image/")) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) return;
                    await uploadManagedGroupFile(file);
                    return;
                  }
                }
                const text = e.clipboardData.getData("text/plain")?.trim();
                if (text && /^https?:\/\/.+/i.test(text)) {
                  e.preventDefault();
                  await uploadManagedGroupImageFromUrl(text);
                }
              };
              return (
                <>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setManageGroupCatsId(null)} className="text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={18} /></button>
                    <h2 className="text-base font-bold text-on-surface">{g?.name} — 分类管理</h2>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3">
                      <div>
                        <p className="text-xs font-bold text-on-surface">分组设置</p>
                        <p className="text-[10px] text-on-surface-variant mt-0.5">修改当前分组的名称和图标</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                        <input
                          value={g?.icon || ""}
                          onChange={(e) => updateManagedGroup({ icon: e.target.value })}
                          placeholder="图标"
                          className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                        />
                        <input
                          value={g?.name || ""}
                          onChange={(e) => updateManagedGroup({ name: e.target.value })}
                          placeholder="分组名称"
                          className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button onClick={saveManagedGroupSettings} disabled={!g?.name.trim()} className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50">保存设置</button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3" onPaste={handleManagedGroupCoverPaste}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold text-on-surface">分组封面</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">推荐 1880×800 或 940×400，比例约 2.35:1</p>
                        </div>
                        <div className="flex rounded-lg bg-surface-container-high p-0.5 text-[11px]">
                          {[
                            { value: "cover", label: "铺满裁切" },
                            { value: "contain", label: "完整显示" },
                          ].map((mode) => (
                            <button
	                              key={mode.value}
	                              onClick={async () => {
	                                const imageFit = mode.value as "cover" | "contain";
	                                const prevImageFit = g?.imageFit || "cover";
	                                updateManagedGroup({ imageFit });
	                                const saved = await saveManagedGroupImage(g?.image || "", imageFit);
	                                if (!saved) updateManagedGroup({ imageFit: prevImageFit });
	                              }}
                              className={`px-2.5 py-1 rounded-md transition-colors ${g?.imageFit === mode.value ? "bg-primary-container text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="aspect-[2.35/1] rounded-lg overflow-hidden border border-outline-variant/10 bg-surface-container-high">
                        {g?.image ? (
                          <SafeImage src={g.image} alt="" className={g.imageFit === "contain" ? "w-full h-full object-contain p-2" : "w-full h-full object-cover"} fallbackIcon="image" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                            <Icon name={g?.icon || "category"} size={26} />
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 rounded-lg bg-surface-container-high/50 px-2.5 py-2 text-[10px] leading-relaxed text-on-surface-variant sm:grid-cols-2">
                        <span>上传：支持截图粘贴、远程图片地址或本地图片</span>
                        <span>显示：产品影棚图建议“铺满裁切”，带边缘信息建议“完整显示”</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-on-surface-variant">图片主体尽量居中，四周保留 8% 安全边距</p>
                        <input
                          ref={groupCoverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) await uploadManagedGroupFile(f);
                            e.target.value = "";
                          }}
                        />
                        <button onClick={importManagedGroupCover} className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 shrink-0">上传封面</button>
                      </div>
                    </div>
                    <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide">当前分组内（{catsInGroup.length}）</p>
                    {catsInGroup.length === 0 && <p className="text-xs text-on-surface-variant py-2 text-center">暂无分类</p>}
                    {catsInGroup.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest">
                        <Icon name={c.icon || "category"} size={14} className="text-primary-container shrink-0" />
                        <span className="text-sm text-on-surface flex-1 truncate">{c.name}</span>
                        <button
                          onClick={async () => {
                            await updateCategory(c.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                            toast(`"${c.name}" 已移出分组`, "success");
                            mutateCats();
                          }}
                          className="text-error/60 hover:text-error shrink-0"
                          title="移出分组"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}

                    {otherCats.length > 0 && (
                      <>
                        <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide pt-2">其他分类（点击添加到本组）</p>
                        {otherCats.map((c) => {
                          const srcGroup = c.groupId ? groupItems.find((gi) => gi.id === c.groupId) : null;
                          return (
                            <button
                              key={c.id}
                              onClick={async () => {
                                await updateCategory(c.id, { groupId: manageGroupCatsId, groupName: g?.name || "", groupIcon: g?.icon || "category", groupImage: g?.image || null, groupImageFit: g?.imageFit || "cover" });
                                toast(`"${c.name}" 已移入本组`, "success");
                                mutateCats();
                              }}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-lowest hover:border-primary-container/40 hover:bg-primary-container/5 w-full text-left transition-colors"
                            >
                              <Icon name="add" size={14} className="text-primary-container shrink-0" />
                              <span className="text-sm text-on-surface-variant flex-1 truncate">{c.name}</span>
                              {srcGroup ? (
                                <span className="text-[10px] text-on-surface-variant/60 shrink-0">来自: {srcGroup.name}</span>
                              ) : (
                                <span className="text-[10px] text-on-surface-variant/60 shrink-0">未分组</span>
                              )}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>

                  <div className="flex justify-end shrink-0 pt-2 border-t border-outline-variant/10">
                    <button onClick={() => setManageGroupCatsId(null)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">返回</button>
                  </div>
                </>
              );
            })() : (
              <>
                {/* --- Main view: group list --- */}
                <div className="flex items-center justify-between shrink-0">
                  <h2 className="text-base font-bold text-on-surface">分组管理</h2>
                  <button onClick={() => setShowGroupModal(false)} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" size={18} /></button>
                </div>

                {/* Add group form */}
                <div className="shrink-0 space-y-2 border-b border-outline-variant/10 pb-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={groupForm.icon}
                      onChange={(e) => setGroupForm({ ...groupForm, icon: e.target.value })}
                      placeholder="图标"
                      className="w-20 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <input
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      placeholder="分组名称"
                      className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={async () => {
                        if (!groupForm.name.trim()) return;
                        const newId = `group_${Date.now()}`;
                        setGroupItems([...groupItems, { id: newId, name: groupForm.name.trim(), icon: groupForm.icon.trim() || "category", image: "", imageFit: "cover", catCount: 0 }]);
                        toast("分组已创建");
                        setGroupForm({ name: "", icon: "category", image: "", imageFit: "cover" });
                        mutateCats();
                      }}
                      disabled={!groupForm.name.trim()}
                      className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      创建
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-variant">名称、图标、封面和分类归属都在进入分组后的“管理分类”里调整。</p>
                </div>

                {/* Group list */}
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                  {groupItems.length === 0 && (
                    <p className="text-center py-8 text-on-surface-variant text-sm">暂无分组</p>
                  )}
                  {groupItems.map((g, i) => (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={() => setGroupDragIdx(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (groupDragIdx === null || groupDragIdx === i) return;
                        const next = [...groupItems];
                        const [moved] = next.splice(groupDragIdx, 1);
                        next.splice(i, 0, moved);
                        setGroupItems(next);
                        setGroupDragIdx(i);
                      }}
                      onDragEnd={() => setGroupDragIdx(null)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                        groupDragIdx === i
                          ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                          : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                      }`}
                    >
                      <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">⠿</span>
                      {g.image ? (
                        <SafeImage src={g.image} alt="" className={`h-8 w-12 rounded border border-outline-variant/10 shrink-0 ${g.imageFit === "contain" ? "object-contain p-0.5 bg-surface-container-high" : "object-cover"}`} fallbackIcon="image" />
                      ) : (
                        <Icon name={g.icon} size={16} className="text-primary-container shrink-0" />
                      )}
                      <span className="text-sm font-medium text-on-surface flex-1">{g.name}</span>
                      <span className="text-[10px] text-on-surface-variant">{g.catCount} 个分类</span>
                      <button
                        onClick={() => setManageGroupCatsId(g.id)}
                        className="text-primary-container hover:bg-primary-container/10 rounded p-1"
                        title="管理分类"
                      >
                        <Icon name="settings" size={13} />
                      </button>
                      <button
                        onClick={async () => {
                          const catsInGroup = categories.filter((c) => c.groupId === g.id);
                          for (const c of catsInGroup) {
                            await updateCategory(c.id, { groupId: null, groupName: null, groupIcon: null, groupImage: null, groupImageFit: null });
                          }
                          setGroupItems(groupItems.filter((gi) => gi.id !== g.id));
                          toast("分组已删除", "success");
                          mutateCats();
                        }}
                        className={SELECTION_ICON_BUTTON_DELETE}
                        aria-label="删除分组"
                        title="删除分组"
                      >
                        <Icon name="delete" size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Save group order */}
                <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
                  <button onClick={() => setShowGroupModal(false)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">关闭</button>
                  <button
                    onClick={async () => {
                      try {
                        for (const g of groupItems) {
                          const catsInGroup = categories.filter((c) => c.groupId === g.id);
                          for (const c of catsInGroup) {
                            await updateCategory(c.id, { groupName: g.name, groupIcon: g.icon, groupImage: g.image || null, groupImageFit: g.imageFit });
                          }
                        }
                        toast("分组已保存", "success");
                        setShowGroupModal(false);
                        mutateCats();
                      } catch {
                        toast("保存失败", "error");
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
                  >
                    保存设置
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Category Sort Modal ===== */}
      {showCatSortModal && (
        <div className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4" onClick={() => setShowCatSortModal(false)}>
          <div className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-base font-bold text-on-surface">分类排序</h2>
              <button onClick={() => setShowCatSortModal(false)} className="text-on-surface-variant hover:text-on-surface"><Icon name="close" size={18} /></button>
            </div>
            <p className="text-xs text-on-surface-variant shrink-0">拖拽调整分类显示顺序</p>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
              {catSortItems.map((item, i) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setCatSortDragIdx(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (catSortDragIdx === null || catSortDragIdx === i) return;
                    const next = [...catSortItems];
                    const [moved] = next.splice(catSortDragIdx, 1);
                    next.splice(i, 0, moved);
                    setCatSortItems(next);
                    setCatSortDragIdx(i);
                  }}
                  onDragEnd={() => setCatSortDragIdx(null)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                    catSortDragIdx === i
                      ? "opacity-40 border-primary-container/30 bg-primary-container/5"
                      : "border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40"
                  }`}
                >
                  <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">⠿</span>
                  <span className="text-sm font-medium text-on-surface flex-1">{item.name}</span>
                  <span className="text-[10px] text-on-surface-variant">{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
              <button onClick={() => setShowCatSortModal(false)} className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded">取消</button>
              <button
                onClick={async () => {
                  try {
                    await sortCategories(catSortItems.map((item, i) => ({ id: item.id, sortOrder: i })));
                    toast("排序已保存", "success");
                    setShowCatSortModal(false);
                    mutateCats();
                  } catch (err: any) {
                    toast(err.response?.data?.detail || "排序保存失败", "error");
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
              >
                保存排序
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function SelectionAdminPage() {
  useDocumentTitle("选型管理");

  return (
    <AdminPageShell desktopContentClassName="overflow-y-scroll selection-scrollbarless [scrollbar-gutter:stable]">
      <Content />
    </AdminPageShell>
  );
}
