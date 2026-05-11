import type { SheetData } from 'write-excel-file/browser';
import type { Inquiry, InquiryItem } from '../api/inquiries';
import { statusInfo, type StatusConfig } from './businessConfig';

function formatExportTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function safeSpreadsheetText(value: unknown) {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
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
  return mode ? labels[mode] || mode : '';
}

function getSalesChannelLabel(channel?: string | null) {
  const labels: Record<string, string> = {
    online: '线上',
    offline: '线下',
  };
  return channel ? labels[channel] || channel : '';
}

function buildProductCells(inquiry: Inquiry, item: InquiryItem | null, index: number) {
  return [
    index ? index : '',
    safeSpreadsheetText(item?.productId || ''),
    safeSpreadsheetText(item?.modelNo || item?.productName || ''),
    safeSpreadsheetText(item?.productName || item?.modelNo || ''),
    safeSpreadsheetText(getSpecText(item?.specs)),
    item?.qty ?? '',
    safeSpreadsheetText(item?.unit || '个'),
    '',
    '',
    '',
    '',
    safeSpreadsheetText(inquiry.remark || ''),
    safeSpreadsheetText(item?.remark || ''),
  ];
}

function buildInquiryCells(inquiry: Inquiry, statuses: StatusConfig[]) {
  const statusLabel = statusInfo(statuses, inquiry.status).label || inquiry.status;
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
  const headers = [
    '询价单号',
    '询价ID',
    '状态',
    '提交时间',
    '更新时间',
    '客户公司',
    '联系人',
    '联系电话',
    '联系地址',
    '客户邮箱',
    '业务对接人',
    '对接人电话',
    '对接人邮箱',
    '分配模式',
    '交易方式',
    '客户区域',
    '交接说明',
    '产品序号',
    '产品ID',
    '型号',
    '产品名称',
    '规格参数',
    '数量',
    '单位',
    '单价',
    '金额',
    '交期',
    '业务备注',
    '客户备注',
    '明细备注',
  ];
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
  sheetName = '询价明细',
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
    sheetName: '询价明细',
  });
}
