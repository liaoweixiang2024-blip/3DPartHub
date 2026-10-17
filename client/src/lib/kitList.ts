import type { SelectionComponent, SelectionProduct } from '../api/selections';
import { i18n } from '../i18n';

export const KIT_LIST_TITLE_OPTION_KEY = '__kitListTitle';
const DEFAULT_KIT_LIST_TITLE = '子零件清单';

function cleanFileName(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'kit-list'
  );
}

export function getKitListTitle(optionOrder?: Record<string, unknown> | null, product?: SelectionProduct) {
  const specs = (product?.specs || {}) as Record<string, string>;
  const productTitle = specs['套件清单标题'] || specs['子零件清单标题'] || specs['清单标题'] || specs['清单名称'];
  if (productTitle?.trim()) return productTitle.trim();
  const configuredTitle = optionOrder?.[KIT_LIST_TITLE_OPTION_KEY];
  if (typeof configuredTitle === 'string' && configuredTitle.trim()) return configuredTitle.trim();
  return i18n.t('bizConfig.kitListDefaultTitle', { defaultValue: DEFAULT_KIT_LIST_TITLE });
}

export function formatKitList(
  product: SelectionProduct,
  components: SelectionComponent[],
  title = getKitListTitle(null, product),
) {
  // 子零件附加参数列（批量导入表头识别，如「编码」）：与选型页清单表同列序输出
  const specKeys = [...new Set(components.flatMap((c) => Object.keys(c.specs || {})))];
  const header = [
    i18n.t('bizConfig.kitListColIndex', { defaultValue: '序号' }),
    i18n.t('bizConfig.kitListColName', { defaultValue: '名称' }),
    i18n.t('bizConfig.kitListColModelNo', { defaultValue: '型号' }),
    i18n.t('bizConfig.kitListColQty', { defaultValue: '数量' }),
    ...specKeys,
  ].join('\t');
  const rows = components.map((item, index) =>
    [
      index + 1,
      item.name || '',
      item.modelNo || '',
      item.qty ?? 1,
      ...specKeys.map((key) => item.specs?.[key] ?? ''),
    ].join('\t'),
  );
  const lines = [
    i18n.t('bizConfig.kitListTitleLine', {
      defaultValue: '{{title}}：{{value}}',
      title,
      value: product.modelNo || product.name || '',
    }),
    product.name && product.name !== product.modelNo
      ? i18n.t('bizConfig.kitListNameLine', { defaultValue: '名称：{{name}}', name: product.name })
      : '',
    '',
    header,
    ...rows,
  ].filter((line) => line !== '');
  return lines.join('\n');
}

export async function downloadKitList(
  product: SelectionProduct,
  components: SelectionComponent[],
  title = getKitListTitle(null, product),
) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  // 与选型页清单表同列：序号/名称/型号/数量 + 子零件附加参数列并集（如「编码」）
  const specKeys = [...new Set(components.flatMap((c) => Object.keys(c.specs || {})))];
  const headers = [
    i18n.t('bizConfig.kitListColIndex', { defaultValue: '序号' }),
    i18n.t('bizConfig.kitListColName', { defaultValue: '名称' }),
    i18n.t('bizConfig.kitListColModelNo', { defaultValue: '型号' }),
    i18n.t('bizConfig.kitListColQty', { defaultValue: '数量' }),
    ...specKeys,
  ];
  const rows = components.map((item, index) => [
    index + 1,
    item.name || '',
    item.modelNo || '',
    item.qty ?? 1,
    ...specKeys.map((key) => item.specs?.[key] ?? ''),
  ]);
  // sheet 名非法字符与 31 字符上限（Excel 约束），超长截断
  const sheetName = title.replace(/[\\/:*?[\]]/g, ' ').slice(0, 31) || 'Kit List';
  await writeXlsxFile([headers, ...rows], { sheet: sheetName }).toFile(
    `${cleanFileName(product.modelNo || product.name || title)}-${cleanFileName(title)}.xlsx`,
  );
}
