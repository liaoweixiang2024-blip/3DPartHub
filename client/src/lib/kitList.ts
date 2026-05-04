import type { SelectionComponent, SelectionProduct } from '../api/selections';

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
  return DEFAULT_KIT_LIST_TITLE;
}

export function formatKitList(
  product: SelectionProduct,
  components: SelectionComponent[],
  title = getKitListTitle(null, product),
) {
  const lines = [
    `${title}：${product.modelNo || product.name || ''}`,
    product.name && product.name !== product.modelNo ? `名称：${product.name}` : '',
    '',
    '序号\t名称\t型号\t数量',
    ...components.map((item, index) => [index + 1, item.name || '', item.modelNo || '', item.qty ?? 1].join('\t')),
  ].filter((line) => line !== '');
  return lines.join('\n');
}

export function downloadKitList(
  product: SelectionProduct,
  components: SelectionComponent[],
  title = getKitListTitle(null, product),
) {
  const text = formatKitList(product, components, title);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${cleanFileName(product.modelNo || product.name || title)}-${cleanFileName(title)}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
