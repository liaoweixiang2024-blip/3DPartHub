import type { SheetData } from 'write-excel-file/browser';
import type { Inquiry, InquiryItem } from '../api/inquiries';
import { i18n } from '../i18n';
import { statusInfo, type StatusConfig } from './businessConfig';

const HEADER_KEYS = [
  'inquiryCode',
  'inquiryId',
  'status',
  'submittedAt',
  'updatedAt',
  'company',
  'contactName',
  'contactPhone',
  'contactAddress',
  'customerEmail',
  'salesAssignee',
  'assigneePhone',
  'assigneeEmail',
  'salesMode',
  'salesChannel',
  'salesRegion',
  'handoffNote',
  'itemIndex',
  'productId',
  'modelNo',
  'productName',
  'specs',
  'qty',
  'unit',
  'unitPrice',
  'amount',
  'leadTime',
  'salesRemark',
  'customerRemark',
  'itemRemark',
];

const HEADER_DEFAULTS: Record<string, string> = {
  inquiryCode: '询价单号',
  inquiryId: '询价ID',
  status: '状态',
  submittedAt: '提交时间',
  updatedAt: '更新时间',
  company: '客户公司',
  contactName: '联系人',
  contactPhone: '联系电话',
  contactAddress: '联系地址',
  customerEmail: '客户邮箱',
  salesAssignee: '业务对接人',
  assigneePhone: '对接人电话',
  assigneeEmail: '对接人邮箱',
  salesMode: '分配模式',
  salesChannel: '交易方式',
  salesRegion: '客户区域',
  handoffNote: '交接说明',
  itemIndex: '产品序号',
  productId: '产品ID',
  modelNo: '型号',
  productName: '产品名称',
  specs: '规格参数',
  qty: '数量',
  unit: '单位',
  unitPrice: '单价',
  amount: '金额',
  leadTime: '交期',
  salesRemark: '业务备注',
  customerRemark: '客户备注',
  itemRemark: '明细备注',
};

function formatExportTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function safeSpreadsheetText(value: unknown) {
  const text = String(value ?? '');
  // OWASP 公式注入前缀全集：= + - @ 以及 Tab/CR 开头同样会被 Excel 当公式/引用解析
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function formatDateTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInquiryCode(id: string) {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function getSpecText(specs?: Record<string, string> | null) {
  const entries = Object.entries(specs || {}).filter(([, value]) => value && value !== '—');
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}:${value}`).join(' / ');
}

function getSalesModeLabel(mode?: string | null) {
  const labels: Record<string, string> = {
    manual: '手动分配',
    default: '默认对接人',
    auto: '自动分配',
    region: '按区域分配',
    channel: '按渠道分配',
  };
  if (!mode) return '';
  return i18n.t(`inquiryExport.salesMode.${mode}`, { defaultValue: labels[mode] || mode });
}

function getSalesChannelLabel(channel?: string | null) {
  const labels: Record<string, string> = {
    online: '线上',
    offline: '线下',
  };
  if (!channel) return '';
  return i18n.t(`inquiryExport.salesChannel.${channel}`, { defaultValue: labels[channel] || channel });
}

function buildProductCells(inquiry: Inquiry, item: InquiryItem | null, index: number) {
  return [
    index ? index : '',
    safeSpreadsheetText(item?.productId || ''),
    safeSpreadsheetText(item?.modelNo || item?.productName || ''),
    safeSpreadsheetText(item?.productName || item?.modelNo || ''),
    safeSpreadsheetText(getSpecText(item?.specs)),
    item?.qty ?? '',
    safeSpreadsheetText(item?.unit || i18n.t('inquiryExport.defaultUnit', { defaultValue: '个' })),
    '',
    '',
    '',
    '',
    safeSpreadsheetText(inquiry.remark || ''),
    safeSpreadsheetText(item?.remark || ''),
  ];
}

function buildInquiryCells(inquiry: Inquiry, statuses: StatusConfig[]) {
  const rawStatusLabel = statusInfo(statuses, inquiry.status).label || inquiry.status;
  const statusLabel = i18n.t(`inquiryStatus.${inquiry.status}.label`, { defaultValue: rawStatusLabel });
  return [
    safeSpreadsheetText(getInquiryCode(inquiry.id)),
    safeSpreadsheetText(inquiry.id),
    safeSpreadsheetText(statusLabel),
    formatDateTime(inquiry.createdAt),
    formatDateTime(inquiry.updatedAt),
    safeSpreadsheetText(inquiry.company || inquiry.user?.company || ''),
    safeSpreadsheetText(inquiry.contactName || inquiry.user?.username || ''),
    safeSpreadsheetText(inquiry.contactPhone || inquiry.user?.phone || ''),
    safeSpreadsheetText(inquiry.contactAddress || inquiry.user?.address || ''),
    safeSpreadsheetText(inquiry.user?.email || ''),
    safeSpreadsheetText(inquiry.salesAssignee?.username || ''),
    safeSpreadsheetText(inquiry.salesAssignee?.phone || ''),
    safeSpreadsheetText(inquiry.salesAssignee?.email || ''),
    safeSpreadsheetText(getSalesModeLabel(inquiry.salesMode)),
    safeSpreadsheetText(getSalesChannelLabel(inquiry.salesChannel)),
    safeSpreadsheetText(inquiry.salesRegion || ''),
    safeSpreadsheetText(inquiry.salesHandoffNote || ''),
  ];
}

function buildRows(inquiries: Inquiry[], statuses: StatusConfig[]) {
  const headers = HEADER_KEYS.map((key) =>
    i18n.t(`inquiryExport.header.${key}`, { defaultValue: HEADER_DEFAULTS[key] }),
  );
  const rows: SheetData = [headers.map((header) => ({ value: header, fontWeight: 'bold' as const }))];
  inquiries.forEach((inquiry) => {
    const inquiryCells = buildInquiryCells(inquiry, statuses);
    if (inquiry.items.length === 0) {
      rows.push([...inquiryCells, ...buildProductCells(inquiry, null, 0)]);
      return;
    }
    inquiry.items.forEach((item, itemIndex) => {
      rows.push([...inquiryCells, ...buildProductCells(inquiry, item, itemIndex + 1)]);
    });
  });
  return rows;
}

export async function exportInquiriesEditableXlsx({
  inquiries,
  statuses,
  filenamePrefix = 'inquiries',
  sheetName = i18n.t('inquiryExport.sheetName', { defaultValue: '询价明细' }),
}: {
  inquiries: Inquiry[];
  statuses: StatusConfig[];
  filenamePrefix?: string;
  sheetName?: string;
}) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(buildRows(inquiries, statuses), { sheet: sheetName }).toFile(
    `${filenamePrefix}_${formatExportTimestamp()}.xlsx`,
  );
}

export async function exportInquiryEditableXlsx({ inquiry, statuses }: { inquiry: Inquiry; statuses: StatusConfig[] }) {
  await exportInquiriesEditableXlsx({
    inquiries: [inquiry],
    statuses,
    filenamePrefix: `inquiry_${inquiry.id.slice(0, 8)}`,
    sheetName: i18n.t('inquiryExport.sheetName', { defaultValue: '询价明细' }),
  });
}
