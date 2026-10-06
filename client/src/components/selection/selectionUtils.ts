import { useState, useEffect } from 'react';
import type { ColumnDef, SelectionProduct, SelectionComponent } from '../../api/selections';
import type { InquiryCartItem } from '../../lib/inquiryCart';

export function sv(specs: Record<string, string>, key: string): string {
  if (specs[key]) return specs[key];
  return '—';
}

export function isManualColumn(col?: ColumnDef) {
  return col?.inputType === 'manual';
}

export function isPresetColumn(col?: ColumnDef) {
  return col?.inputType === 'preset';
}

export function useDelayedVisible(active: boolean, delayMs: number) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

export function normalizeManualValue(col: ColumnDef | undefined, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!col?.suffix) return trimmed;
  return trimmed.toUpperCase().endsWith(col.suffix.toUpperCase()) ? trimmed : `${trimmed}${col.suffix}`;
}

export function columnLabel(columns: ColumnDef[], key: string) {
  const col = columns.find((item) => item.key === key);
  return col?.label || key;
}

export function replaceManualPlaceholders(
  text: string | null | undefined,
  entries: Array<readonly [string, string]>,
  columns: ColumnDef[],
) {
  if (!text) return text;
  let next = text;
  for (const [key, value] of entries) {
    const col = columns.find((item) => item.key === key);
    next = next.replaceAll(`[${key}]`, value);
    if (col?.legacyPlaceholder) next = next.replaceAll(col.legacyPlaceholder, value);
  }
  return next;
}

export function displayProductName(product: SelectionProduct) {
  const rawName = product.name?.trim();
  const modelNo = product.modelNo?.trim();
  if (!rawName) return modelNo || '';
  if (!modelNo) return rawName;
  // 副标题显示「实际内容」：剥掉型号的「所有」出现（历史数据名称常以「系列号 描述 完整型号」结尾）
  const escaped = modelNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let cleaned = rawName
    .replace(new RegExp(escaped, 'gi'), ' ')
    .replace(/^[\s\-—_]+|[\s\-—_]+$/g, '')
    .trim();
  // 首段（按空格分段，系列号内部的连字符保留）若是型号的系列号前缀
  // （如 TKN-PZA 之于 TKN-PZA10 / PAW 之于 PAW4-01）也剥掉——型号标题已含系列号
  const compact = (s: string) => s.toLowerCase().replace(/[\s\-—_]/g, '');
  const firstSpace = cleaned.indexOf(' ');
  if (firstSpace > 0) {
    const head = cleaned.slice(0, firstSpace);
    if (compact(modelNo).startsWith(compact(head))) {
      cleaned = cleaned
        .slice(firstSpace + 1)
        .replace(/^[\s\-—_]+/, '')
        .trim();
    }
  }
  return cleaned;
}

export function getInquiryCartItemTitle(item: InquiryCartItem) {
  if (item.modelNo && item.productName && item.productName !== item.modelNo) {
    return `${item.modelNo} · ${item.productName}`;
  }
  return item.modelNo || item.productName;
}

export function getInquiryCartItemSummary(item: InquiryCartItem, remarkLabel = 'Remark') {
  const specs = Object.entries(item.specs || {})
    .filter(([, value]) => value && value !== '—')
    .slice(0, 2)
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
  const remark = item.remark ? `${remarkLabel}:${item.remark}` : '';
  return [specs, remark].filter(Boolean).join(' · ');
}

export function applyManualSpecs(
  product: SelectionProduct,
  columns: ColumnDef[],
  specs: Record<string, string>,
  options: { formatGeneratedOutletName?: (routeIndex: number) => string } = {},
): SelectionProduct {
  const userEntries = columns
    .filter((col) => (isManualColumn(col) || isPresetColumn(col)) && specs[col.key])
    .map((col) => {
      const raw = specs[col.key];
      const value = isManualColumn(col) ? normalizeManualValue(col, raw) : raw;
      return [col.key, value] as const;
    });

  if (!userEntries.length) return product;

  const nextSpecs = { ...(product.specs as Record<string, string>) };
  for (const [key, value] of userEntries) nextSpecs[key] = value;
  if (typeof nextSpecs['型号'] === 'string') {
    nextSpecs['型号'] = replaceManualPlaceholders(nextSpecs['型号'], userEntries, columns) || nextSpecs['型号'];
  }

  const modelNo = replaceManualPlaceholders(product.modelNo, userEntries, columns);
  const name = replaceManualPlaceholders(product.name, userEntries, columns) || product.name;

  let nextComponents = product.components;
  const outletComponents: SelectionComponent[] = [];
  for (const col of columns) {
    if (!isPresetColumn(col) || !col.dependsOn || !specs[col.key]) continue;
    const routeIndex = col.dependsOn.minIndex;
    outletComponents.push({
      name: options.formatGeneratedOutletName?.(routeIndex) || `Route ${routeIndex} outlet connector`,
      modelNo: `PL${specs[col.key]}-02`,
      qty: 1,
    });
  }
  if (outletComponents.length > 0) {
    const existing = (nextComponents || []) as SelectionComponent[];
    nextComponents = [...existing, ...outletComponents];
    nextSpecs['BOM条数'] = String(nextComponents.length);
  }

  return { ...product, name, modelNo, specs: nextSpecs, components: nextComponents };
}

export function formatModelCount(count: number) {
  return String(count);
}

export function formatOptionCount(count: number) {
  return String(count);
}

export function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

export const selectionMotion =
  'transition-[transform,border-color,background-color,box-shadow,color,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none motion-reduce:transform-none';
export const selectionPress = `${selectionMotion} active:scale-[0.985]`;
export const mobileCategoryListClass = 'mx-auto flex w-full flex-col';
export const mobileCategoryPanelClass = 'p-0';

export function mobileCategoryCardClass(active: boolean) {
  // 不写 hover/active 视觉样式：iOS WebKit 触摸滚动时 :hover/:active 会全程粘在
  // 手指落点那张卡上不释放（整卡变深+阴影抬起，像被选中）；按压反馈由渲染处的
  // framer-motion whileTap 提供（pointercancel 时正确释放，不会粘住）
  return `group relative flex w-full transform-gpu items-stretch overflow-hidden border-0 border-t border-outline-variant/12 text-left will-change-transform first:border-t-0 first:rounded-t-xl last:rounded-b-xl ${selectionMotion} focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container/60 ${
    active
      ? 'z-[1] bg-primary-container/8 shadow-[inset_3px_0_0_var(--color-primary-container),0_6px_16px_rgba(249,115,22,0.10)]'
      : 'bg-surface-container-low/45 shadow-[0_1px_3px_rgba(15,23,42,0.06)]'
  }`;
}

export type ShareLinkDialogState = {
  title: string;
  description: string;
  url: string;
};
export type ShareTarget = 'entry' | 'category' | 'result' | 'sub';
