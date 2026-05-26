import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import useSWR from 'swr';
import {
  getInquiry,
  sendInquiryMessage,
  cancelInquiry,
  updateInquiryItems,
  updateInquiryStatus,
  uploadInquiryAttachment,
  type Inquiry,
  type InquiryItem,
  type InquiryMessage,
} from '../api/inquiries';
import InquirySalesAssignmentDialog from '../components/inquiry/InquirySalesAssignmentDialog';
import { AdminPageHero } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import QuickReplyChips from '../components/shared/QuickReplyChips';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { openDocumentUrl } from '../lib/browserDownload';
import { getBusinessConfig, statusInfo, type StatusConfig } from '../lib/businessConfig';
import { getClipboardImageFile } from '../lib/clipboardImages';
import { getErrorMessage, notifyGlobalError } from '../lib/errorNotifications';
import { getCustomerInquiryFlow, getCustomerInquiryStatusView } from '../lib/inquiryCustomerStatus';
import { exportInquiryEditableXlsx } from '../lib/inquiryExport';
import { buildInquiryPrintCss } from '../lib/printTheme';
import { usePublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

function CustomerStatusBadge({ status }: { status: string }) {
  const info = getCustomerInquiryStatusView(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold ${info.badgeClassName}`}>
      {info.label}
    </span>
  );
}

const INQUIRY_ADMIN_QUICK_REPLIES = [
  '已收到询价，正在核对产品规格和数量。',
  '请补充采购数量、期望交期或收货地区。',
  '该型号需要确认适配参数，我们会尽快反馈。',
  '报价和交期已更新，请查看确认。',
  '已分配销售对接，稍后会与您联系。',
];

const INQUIRY_USER_QUICK_REPLIES = [
  '请帮我确认报价和预计交期。',
  '数量或规格有调整，请以最新清单为准。',
  '收货地区和使用场景我补充如下。',
  '可以安排销售联系我。',
  '这个报价方案可以，麻烦推进下一步。',
  '如果还需要补充资料，请告诉我。',
];

type InquiryItemDraft = {
  id: string;
  qty: number;
  remark: string;
};

function createItemDrafts(items: InquiryItem[]): InquiryItemDraft[] {
  return items.map((item) => ({
    id: item.id,
    qty: Math.max(1, Number(item.qty) || 1),
    remark: item.remark || '',
  }));
}

function InquiryDetailLoadingState() {
  return (
    <div className="flex h-full min-h-[320px]">
      <PageRefreshIndicator label="询价单详情刷新中" />
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInquiryCode(id: string) {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function isImageAttachment(url?: string | null) {
  return Boolean(url?.split(/[?#]/)[0].match(/\.(png|jpe?g|gif|webp|svg)$/i));
}

function getSpecEntries(specs?: Record<string, string> | null) {
  return Object.entries(specs || {}).filter(([, value]) => value && value !== '—');
}

function getSpecSummary(specs?: Record<string, string> | null) {
  const entries = getSpecEntries(specs).filter(([key]) => key !== '型号');
  if (entries.length === 0) return '—';
  const preferred = ['系列', '内径', '外径', '长度'];
  const ordered = [
    ...preferred.flatMap((label) => entries.filter(([key]) => key.includes(label))),
    ...entries.filter(([key]) => !preferred.some((label) => key.includes(label))),
  ];
  return ordered
    .slice(0, 6)
    .map(([key, value]) => `${key}：${value}`)
    .join(' / ');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForInlineScript(value: string) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildQuotePrintHtml({
  inquiry,
  companyName,
  companyLogo,
  statuses,
  fallbackUrl = '/',
}: {
  inquiry: Inquiry;
  companyName: string;
  companyLogo?: string;
  statuses: StatusConfig[];
  fallbackUrl?: string;
}) {
  const info = statusInfo(statuses, inquiry.status);
  const customerCompany = inquiry.company || inquiry.user?.company || '—';
  const contactName = inquiry.contactName || inquiry.user?.username || '—';
  const contactPhone = inquiry.contactPhone || inquiry.user?.phone || '—';
  const contactAddress = inquiry.contactAddress || inquiry.user?.address || '—';
  const totalQty = inquiry.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const rows = inquiry.items
    .map(
      (item, index) => `
        <tr>
          <td class="center">${String(index + 1).padStart(2, '0')}</td>
          <td class="strong">${escapeHtml(item.modelNo || item.productName)}</td>
          <td>${escapeHtml(item.productName || item.modelNo || '—')}</td>
          <td>${escapeHtml(getSpecSummary(item.specs))}</td>
          <td class="right strong">${escapeHtml(item.qty)}</td>
          <td class="center">${escapeHtml(item.unit || '个')}</td>
          <td class="center muted">待报价</td>
          <td class="center muted">待报价</td>
          <td>${escapeHtml(item.remark || '—')}</td>
        </tr>`,
    )
    .join('');
  const logoHtml = companyLogo
    ? `<img src="${escapeHtml(companyLogo)}" alt="${escapeHtml(companyName)}" />`
    : `<span class="logo-fallback">${escapeHtml(companyName.slice(0, 1))}</span>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>${escapeHtml(companyName)} ${escapeHtml(getInquiryCode(inquiry.id))} 报价单</title>
  <style>${buildInquiryPrintCss()}
    .print-actions { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 12px; right: 12px; z-index: 99; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; }
    .print-actions button { pointer-events: auto; height: 36px; border: 0; border-radius: 18px; padding: 0 14px; background: #0f172a; color: #fff; font-size: 14px; font-weight: 800; box-shadow: 0 8px 24px rgba(15, 23, 42, .18); }
    .print-actions button:last-child { margin-left: auto; background: #2563eb; }
    @media print { .print-actions { display: none; } }
  </style>
</head>
<body>
  <div class="print-actions"><button id="closePrintPage" type="button">退出</button><button id="printAgain" type="button">打印</button></div>
  <main class="page">
    <header>
      <div class="brand">
        ${logoHtml}
        <div>
          <div class="company">${escapeHtml(companyName)}</div>
          <div class="en">Quotation Sheet</div>
        </div>
      </div>
      <div class="title">
        <h1>报价单</h1>
        <p>产品询价明细</p>
      </div>
    </header>
    <section class="meta">
      <div class="meta-block">
        <div class="label">客户公司</div><div class="value">${escapeHtml(customerCompany)}</div>
        <div class="label">联系人</div><div class="value">${escapeHtml(contactName)}</div>
        <div class="label">联系电话</div><div class="value">${escapeHtml(contactPhone)}</div>
        <div class="label">联系地址</div><div class="value">${escapeHtml(contactAddress)}</div>
      </div>
      <div class="meta-block">
        <div class="label">单据编号</div><div class="value">${escapeHtml(getInquiryCode(inquiry.id))}</div>
        <div class="label">提交时间</div><div class="value">${escapeHtml(formatDateTime(inquiry.createdAt))}</div>
        <div class="label">当前状态</div><div class="value">${escapeHtml(info.label)}</div>
        <div class="label">产品数量</div><div class="value">${inquiry.items.length} 项 / ${totalQty}</div>
      </div>
    </section>
    <section>
      <div class="section-head">
        <h2>一、产品明细</h2>
        <span>共 ${inquiry.items.length} 项 / 合计数量 ${totalQty}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:42px;text-align:center;">序号</th>
            <th style="width:148px;">型号</th>
            <th style="width:126px;">产品名称</th>
            <th>规格摘要</th>
            <th style="width:56px;text-align:right;">数量</th>
            <th style="width:52px;text-align:center;">单位</th>
            <th style="width:70px;text-align:center;">单价</th>
            <th style="width:70px;text-align:center;">金额</th>
            <th style="width:78px;">备注</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <section class="note">
      <div class="label">备注说明</div>
      <div class="body">本单为询价明细确认版，规格、数量和备注用于业务核价；最终报价、交期与生产要求以双方确认结果为准。</div>
    </section>
    <footer>
      <div class="sign"><p>制单：</p><div class="line">系统生成</div></div>
      <div class="sign"><p>审核：</p><div class="line">业务确认</div></div>
      <div class="sign"><p>客户确认：</p><div class="line">签字 / 盖章</div></div>
    </footer>
  </main>
  <script>const fallbackUrl=${jsonForInlineScript(
    fallbackUrl,
  )};document.getElementById('closePrintPage').addEventListener('click',function(){try{window.close()}catch(e){}setTimeout(function(){if(!window.closed)location.href=fallbackUrl},80)});document.getElementById('printAgain').addEventListener('click',function(){window.print()});window.addEventListener('load', () => setTimeout(() => window.print(), 120));</script>
</body>
</html>`;
}

function MessageBubble({ msg, isAdminView }: { msg: InquiryMessage; isAdminView: boolean }) {
  const isOwn = isAdminView ? msg.isAdmin : !msg.isAdmin;
  const sender = msg.isAdmin ? '管理员' : msg.user?.username || '用户';
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const attachment = msg.attachment || '';
  const attachmentIsImage = isImageAttachment(attachment);
  return (
    <div className={`mb-3 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] rounded-2xl px-4 py-2.5 shadow-sm md:max-w-[72%] ${
          isOwn
            ? 'rounded-br-md bg-primary-container text-on-primary'
            : 'rounded-bl-md border border-outline-variant/12 bg-surface-container-high text-on-surface'
        }`}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
        {attachment && attachmentIsImage ? (
          <SafeImage
            src={attachment}
            alt="附件"
            className="mt-2 max-h-[240px] max-w-full cursor-pointer rounded object-contain transition-opacity hover:opacity-90"
            fallbackClassName="min-h-24"
            onClick={() => setPreviewImg(attachment)}
          />
        ) : attachment ? (
          <a
            href={attachment}
            target="_blank"
            rel="noopener"
            onClick={(event) => {
              event.preventDefault();
              openDocumentUrl(attachment, { title: '附件预览' });
            }}
            className={`mt-2 inline-flex items-center gap-1 rounded-md border border-outline-variant/15 px-2 py-1 text-xs ${
              isOwn ? 'text-on-primary/80' : 'text-primary-container'
            }`}
          >
            <Icon name="attach_file" size={12} />
            查看附件
          </a>
        ) : null}
        <div className={`mt-1 text-[10px] ${isOwn ? 'text-on-primary/65' : 'text-on-surface-variant'}`}>
          {isOwn ? '我' : sender} · {formatDateTime(msg.createdAt)}
        </div>
      </div>
      {previewImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPreviewImg(null)}
        >
          <SafeImage src={previewImg} alt="预览" className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </div>
  );
}

function getInquiryItemName(item: Inquiry['items'][number]) {
  return item.productName || item.modelNo || '—';
}

function getInquiryItemSpec(item: Inquiry['items'][number]) {
  const specs = item.specs || {};
  const directSpec =
    specs['规格'] || specs['规格型号'] || specs['型号规格'] || specs['尺寸'] || specs['型号'] || specs['参数'];
  const candidates = [item.modelNo, directSpec]
    .map((value) => String(value || '').trim())
    .filter((value) => value && value !== '—' && value !== item.productName);
  if (candidates.length > 0) return Array.from(new Set(candidates)).slice(0, 2).join(' / ');

  const fallback = getSpecEntries(specs).find(([key]) => !['名称', '产品名称'].includes(key))?.[1];
  return fallback || '—';
}

function getInquiryMessages(inquiry: Inquiry) {
  return (inquiry.messages || []).filter((message) => message.inquiryId === inquiry.id);
}

type InquiryItemsEditProps = {
  editing?: boolean;
  drafts?: InquiryItemDraft[];
  onDraftChange?: (id: string, patch: Partial<InquiryItemDraft>) => void;
  onDraftRemove?: (id: string) => void;
};

function ItemsTable({
  inquiry,
  flat = false,
  editing = false,
  drafts = [],
  onDraftChange,
  onDraftRemove,
}: { inquiry: Inquiry; flat?: boolean } & InquiryItemsEditProps) {
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const visibleItems = editing ? inquiry.items.filter((item) => draftById.has(item.id)) : inquiry.items;
  const totalQty = editing
    ? drafts.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
    : inquiry.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  return (
    <div
      className={
        flat
          ? 'overflow-hidden'
          : 'overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-lowest'
      }
    >
      {!flat ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="inventory_2" size={14} className="text-primary-container" />
            <span className="text-xs font-medium text-on-surface">产品明细</span>
            <span className="rounded-md bg-primary-container/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary-container">
              {visibleItems.length} 项
            </span>
          </div>
          <span className="text-[11px] font-medium text-on-surface-variant">合计 {totalQty}</span>
        </div>
      ) : null}

      <div className="divide-y divide-outline-variant/10 md:hidden">
        {visibleItems.map((item, index) => {
          const draft = draftById.get(item.id);
          const itemName = getInquiryItemName(item);
          const itemSpec = getInquiryItemSpec(item);
          const remark = editing && draft ? draft.remark : item.remark || '';

          return (
            <article key={item.id} className="px-3 py-3">
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-2">
                <span className="pt-0.5 text-[11px] font-semibold tabular-nums text-on-surface-variant">
                  {String(index + 1).padStart(2, '0')}
                </span>

                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold leading-5 text-on-surface">{itemName}</p>
                  <p className="mt-1 break-words text-xs leading-5 text-on-surface-variant">{itemSpec}</p>
                </div>

                <div className="flex shrink-0 items-start gap-1">
                  {editing && draft ? (
                    <input
                      type="number"
                      min={1}
                      value={draft.qty}
                      onChange={(event) =>
                        onDraftChange?.(item.id, { qty: Math.max(1, parseInt(event.target.value) || 1) })
                      }
                      className="h-8 w-16 rounded-md border border-outline-variant/20 bg-surface-container-lowest px-2 text-center text-xs font-semibold tabular-nums text-on-surface outline-none focus:border-primary-container"
                      aria-label={`${itemName} 数量`}
                    />
                  ) : (
                    <p className="rounded-lg bg-surface-container px-2 py-1 text-sm font-semibold tabular-nums text-on-surface">
                      {item.qty}
                      <span className="ml-1 text-[11px] font-medium text-on-surface-variant">{item.unit || '个'}</span>
                    </p>
                  )}

                  {editing ? (
                    <button
                      type="button"
                      onClick={() => onDraftRemove?.(item.id)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                      aria-label="移出询价清单"
                    >
                      <Icon name="delete" size={15} />
                    </button>
                  ) : null}
                </div>
              </div>

              {editing && draft ? (
                <textarea
                  value={draft.remark}
                  onChange={(event) => onDraftChange?.(item.id, { remark: event.target.value })}
                  placeholder="备注"
                  rows={2}
                  className="mt-2 w-full resize-none rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-xs leading-5 text-on-surface outline-none focus:border-primary-container"
                />
              ) : remark ? (
                <p className="ml-9 mt-2 break-words rounded-lg bg-surface-container px-3 py-2 text-xs leading-5 text-on-surface-variant">
                  {remark}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className={`w-full table-fixed text-xs ${editing ? 'min-w-[700px]' : 'min-w-[560px]'}`}>
          <thead
            className={
              flat
                ? 'border-b border-outline-variant/10 text-[11px] text-on-surface-variant'
                : 'border-b border-outline-variant/10 text-[11px] text-on-surface-variant'
            }
          >
            <tr>
              <th className="w-12 px-3 py-2.5 text-left font-semibold">序号</th>
              <th className="w-[220px] px-3 py-2.5 text-left font-semibold">名称</th>
              <th className="px-3 py-2.5 text-left font-semibold">规格</th>
              <th className="w-20 px-3 py-2.5 text-right font-semibold">数量</th>
              <th className="w-32 px-3 py-2.5 text-left font-semibold">备注</th>
              {editing ? <th className="w-12 px-3 py-2.5 text-right font-semibold">操作</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {visibleItems.map((item, index) => {
              const draft = draftById.get(item.id);
              return (
                <tr
                  key={item.id}
                  className={`align-top transition-colors ${
                    flat ? 'hover:bg-surface-container-lowest/60' : 'hover:bg-surface-container-low'
                  }`}
                >
                  <td className="px-3 py-2.5 text-[11px] font-semibold tabular-nums text-on-surface-variant">
                    {String(index + 1).padStart(2, '0')}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="break-words text-xs font-semibold text-on-surface md:text-[13px]">
                      {getInquiryItemName(item)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="break-words text-[11px] leading-5 text-on-surface-variant">
                      {getInquiryItemSpec(item)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {editing && draft ? (
                      <input
                        type="number"
                        min={1}
                        value={draft.qty}
                        onChange={(event) =>
                          onDraftChange?.(item.id, { qty: Math.max(1, parseInt(event.target.value) || 1) })
                        }
                        className="h-8 w-16 rounded-md border border-outline-variant/20 bg-surface-container px-2 text-center text-xs text-on-surface outline-none focus:border-primary-container"
                        aria-label={`${getInquiryItemName(item)} 数量`}
                      />
                    ) : (
                      <>
                        <span className="font-semibold tabular-nums text-on-surface">{item.qty}</span>
                        <span className="ml-1 text-[11px] text-on-surface-variant">{item.unit || '个'}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] leading-5 text-on-surface-variant">
                    {editing && draft ? (
                      <input
                        value={draft.remark}
                        onChange={(event) => onDraftChange?.(item.id, { remark: event.target.value })}
                        placeholder="备注"
                        className="h-8 w-full rounded-md border border-outline-variant/20 bg-surface-container px-2 text-xs text-on-surface outline-none focus:border-primary-container"
                      />
                    ) : (
                      item.remark || '—'
                    )}
                  </td>
                  {editing ? (
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onDraftRemove?.(item.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                        aria-label="移出询价清单"
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type MobileCollapseProps = {
  mobileOpen?: boolean;
  onMobileToggle?: () => void;
};

type CustomerMobileSection = 'progress' | 'summary' | 'items' | 'messages';

const DEFAULT_CUSTOMER_MOBILE_SECTIONS: Record<CustomerMobileSection, boolean> = {
  progress: false,
  summary: false,
  items: true,
  messages: false,
};

function CustomerStatusPanel({
  inquiry,
  renderActions,
  mobileOpen = false,
  onMobileToggle,
}: { inquiry: Inquiry; renderActions?: () => ReactNode } & MobileCollapseProps) {
  const assignee = inquiry.salesAssignee;
  const flow = getCustomerInquiryFlow(inquiry.status, assignee?.username);
  const totalQty = inquiry.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const messageCount = getInquiryMessages(inquiry).length;
  const currentStep = flow.steps[Math.min(flow.activeIndex, flow.steps.length - 1)] || flow.steps[0];
  const nextText = flow.nextText.replace(/^下一步：/, '');

  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low md:sticky md:top-0 md:z-20">
      <button
        type="button"
        onClick={onMobileToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left md:hidden"
        aria-expanded={mobileOpen}
      >
        <span className="min-w-0">
          <span className="mb-1.5 flex items-center gap-2">
            <CustomerStatusBadge status={inquiry.status} />
            <span className="truncate text-xs font-semibold text-on-surface">当前：{currentStep.title}</span>
          </span>
          <span className="block truncate text-[11px] text-on-surface-variant">
            {inquiry.items.length} 项产品 · 合计 {totalQty} · {messageCount} 条消息
          </span>
        </span>
        <Icon
          name="expand_more"
          size={17}
          className={`shrink-0 text-on-surface-variant transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div className="hidden items-center justify-between gap-4 px-5 py-3 md:flex">
        <div className="flex min-w-0 items-center gap-2.5">
          <CustomerStatusBadge status={inquiry.status} />
          <span className="shrink-0 text-[11px] font-medium text-on-surface-variant">{getInquiryCode(inquiry.id)}</span>
          <span className="h-4 w-px shrink-0 bg-outline-variant/20" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-on-surface">当前进度：{nextText}</h2>
          <span className="shrink-0 text-[11px] text-on-surface-variant">
            {inquiry.items.length} 项 · 合计 {totalQty} · {messageCount} 条消息
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {renderActions ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">{renderActions()}</div>
          ) : null}
          <ol className="flex shrink-0 items-center gap-2" aria-label="询价进度">
            {flow.steps.map((step, index) => {
              const isDone = index < flow.activeIndex;
              const isActive = index === flow.activeIndex;
              const dotClass = isActive
                ? 'bg-primary-container ring-primary-container/25'
                : isDone
                  ? 'bg-primary-container/70 ring-primary-container/15'
                  : 'bg-outline-variant/35 ring-outline-variant/10';
              const labelClass = isActive
                ? 'text-on-surface'
                : isDone
                  ? 'text-on-surface-variant'
                  : 'text-on-surface-variant/60';
              return (
                <li key={step.key} className="flex min-w-0 items-center gap-2">
                  {index > 0 ? <span className="h-px w-7 shrink-0 bg-outline-variant/20" aria-hidden /> : null}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ring-4 ${dotClass}`}
                    title={`${step.title}：${step.description}`}
                  />
                  <span className={`max-w-20 truncate text-[11px] font-medium ${labelClass}`}>{step.title}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className={`${mobileOpen ? 'block' : 'hidden'} border-t border-outline-variant/10 px-3 py-2 md:hidden`}>
        <ol className="relative grid grid-cols-4 gap-0" aria-label="询价进度">
          <span className="absolute left-[12.5%] right-[12.5%] top-2.5 h-px bg-outline-variant/15" aria-hidden />
          {flow.steps.map((step, index) => {
            const isDone = index < flow.activeIndex;
            const isActive = index === flow.activeIndex;
            const dotClass = isActive
              ? 'border-primary-container bg-primary-container text-on-primary'
              : isDone
                ? 'border-primary-container/40 bg-primary-container/12 text-primary-container'
                : 'border-outline-variant/20 bg-surface-container-high text-on-surface-variant/60';
            return (
              <li key={step.key} className="relative z-10 min-w-0 text-center">
                <span
                  className={`mx-auto grid h-5 w-5 place-items-center rounded-full border text-[9px] font-bold ${dotClass}`}
                  title={step.title}
                >
                  {isDone ? (
                    <Icon name="check" size={10} />
                  ) : isActive ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  ) : (
                    index + 1
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {renderActions ? <div className="mt-3 flex flex-wrap items-center gap-1.5">{renderActions()}</div> : null}
      </div>
    </section>
  );
}

function SummaryLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-b border-outline-variant/10 py-2.5 last:border-b-0">
      <dt className="text-xs text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-on-surface">{value}</dd>
    </div>
  );
}

function CustomerDetailSummary({
  inquiry,
  mobileOpen = false,
  onMobileToggle,
}: { inquiry: Inquiry } & MobileCollapseProps) {
  const assignee = inquiry.salesAssignee;
  const contact = assignee ? [assignee.phone, assignee.email].filter(Boolean).join(' · ') : '';
  const customerCompany = inquiry.company || inquiry.user?.company;
  const contactName = inquiry.contactName || inquiry.user?.username;
  const contactPhone = inquiry.contactPhone || inquiry.user?.phone;
  const contactAddress = inquiry.contactAddress || inquiry.user?.address;
  const totalQty = inquiry.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const statusView = getCustomerInquiryStatusView(inquiry.status);

  return (
    <aside className="overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
      <button
        type="button"
        onClick={onMobileToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left md:hidden"
        aria-expanded={mobileOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="receipt_long" size={15} className="text-primary-container" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-on-surface">单据信息</span>
            <span className="block truncate text-[11px] text-on-surface-variant">
              {statusView.label} · {inquiry.items.length} 项 / {totalQty}
            </span>
          </span>
        </span>
        <Icon
          name="expand_more"
          size={17}
          className={`shrink-0 text-on-surface-variant transition-transform ${mobileOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div className="hidden items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3 md:flex">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="receipt_long" size={15} className="text-primary-container" />
          <h3 className="text-sm font-semibold text-on-surface">单据信息</h3>
        </div>
        <span className="rounded-md bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
          {getInquiryCode(inquiry.id)}
        </span>
      </div>
      <div
        className={`${mobileOpen ? 'grid' : 'hidden'} gap-0 border-t border-outline-variant/10 md:grid md:grid-cols-2 md:border-t-0 xl:block`}
      >
        <section className="border-b border-outline-variant/10 px-4 py-2 md:border-b-0 md:border-r md:py-3 xl:border-b xl:border-r-0">
          <dl>
            <SummaryLine label="当前状态" value={statusView.label} />
            <SummaryLine label="产品合计" value={`${inquiry.items.length} 项 / ${totalQty}`} />
            <SummaryLine label="提交时间" value={formatShortDate(inquiry.createdAt)} />
            <SummaryLine label="最近更新" value={formatShortDate(inquiry.updatedAt)} />
          </dl>
        </section>

        <section className="px-4 py-2 md:py-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-on-surface">
            <Icon name="badge" size={15} className="text-primary-container" />
            <span>联系与对接</span>
          </div>
          <dl>
            <SummaryLine label="公司" value={customerCompany || '未填写'} />
            <SummaryLine label="联系人" value={contactName || '未填写'} />
            <SummaryLine label="电话" value={contactPhone || '未填写'} />
            <SummaryLine label="地址" value={contactAddress || '未填写'} />
          </dl>

          <div className="mt-3 rounded-lg bg-surface-container-lowest px-3 py-2.5">
            {assignee ? (
              <div className="text-sm">
                <p className="font-semibold text-on-surface">{assignee.username}</p>
                <p className="mt-1 text-xs leading-5 text-on-surface-variant">
                  {[assignee.department, assignee.company].filter(Boolean).join(' / ') || '业务对接人'}
                </p>
                {contact ? (
                  <p className="mt-1 break-words text-xs leading-5 text-on-surface-variant">{contact}</p>
                ) : null}
                {inquiry.salesHandoffNote ? (
                  <p className="mt-2 border-t border-outline-variant/10 pt-2 text-xs leading-5 text-on-surface-variant">
                    {inquiry.salesHandoffNote}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs leading-5 text-on-surface-variant">
                业务确认后，如需线下推进，会在这里显示对接人信息。
              </p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function CustomerItemsList({
  inquiry,
  canEdit,
  editing,
  saving,
  drafts,
  onEdit,
  onCancel,
  onSave,
  onDraftChange,
  onDraftRemove,
  mobileOpen = false,
  onMobileToggle,
}: {
  inquiry: Inquiry;
  canEdit: boolean;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
} & InquiryItemsEditProps &
  MobileCollapseProps) {
  const totalQty = editing
    ? (drafts || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
    : inquiry.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const itemCount = editing ? drafts?.length || 0 : inquiry.items.length;
  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low">
      <button
        type="button"
        onClick={onMobileToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left md:hidden"
        aria-expanded={mobileOpen || editing}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="inventory_2" size={15} className="text-primary-container" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-on-surface">询价产品</span>
            <span className="block truncate text-[11px] text-on-surface-variant">
              {itemCount} 项 · 合计数量 {totalQty}
            </span>
          </span>
        </span>
        <Icon
          name="expand_more"
          size={17}
          className={`shrink-0 text-on-surface-variant transition-transform ${mobileOpen || editing ? 'rotate-180' : ''}`}
        />
      </button>
      {canEdit && (mobileOpen || editing) ? (
        <div className="flex items-center justify-end gap-1.5 border-t border-outline-variant/10 px-4 py-2 md:hidden">
          {editing ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="h-7 px-2 text-xs font-medium text-on-surface-variant hover:text-on-surface disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-primary-container px-2 text-xs font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="check" size={12} />
                {saving ? '保存中' : '保存'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-outline-variant/20 px-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            >
              <Icon name="edit" size={12} />
              编辑
            </button>
          )}
        </div>
      ) : null}
      <div className="hidden flex-wrap items-center justify-between gap-2 border-b border-outline-variant/10 px-4 py-3 md:flex">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="inventory_2" size={15} className="text-primary-container" />
          <h2 className="text-xs font-semibold text-on-surface md:text-sm">询价产品</h2>
          <span className="rounded-md bg-primary-container/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary-container">
            {itemCount} 项
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] font-medium text-on-surface-variant">合计数量 {totalQty}</span>
          {canEdit ? (
            editing ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="h-7 px-2 text-xs font-medium text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary-container px-2 text-xs font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
                >
                  <Icon name="check" size={12} />
                  {saving ? '保存中' : '保存'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-outline-variant/20 px-2 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="edit" size={12} />
                编辑
              </button>
            )
          ) : null}
        </div>
      </div>
      <div
        className={`${mobileOpen || editing ? 'block' : 'hidden'} border-t border-outline-variant/10 md:block md:border-t-0`}
      >
        <ItemsTable
          inquiry={inquiry}
          flat
          editing={editing}
          drafts={drafts}
          onDraftChange={onDraftChange}
          onDraftRemove={onDraftRemove}
        />
      </div>
    </section>
  );
}

const INQUIRY_DETAIL_HEADER_ACTION_TONE = {
  danger:
    'border-error/25 bg-error-container/15 text-error hover:border-error/35 hover:bg-error-container/25 hover:text-error',
  neutral:
    'border-outline-variant/20 bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
};

function InquiryDetailHeaderAction({
  icon,
  label,
  shortLabel,
  onClick,
  tone = 'neutral',
}: {
  icon: string;
  label: string;
  shortLabel?: string;
  onClick: () => void;
  tone?: keyof typeof INQUIRY_DETAIL_HEADER_ACTION_TONE;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-medium transition-colors md:w-auto md:px-3.5 ${
        shortLabel ? 'flex-col gap-0.5 md:flex-row md:gap-1.5' : 'gap-1.5'
      } ${INQUIRY_DETAIL_HEADER_ACTION_TONE[tone]}`}
      aria-label={label}
    >
      <Icon name={icon} size={shortLabel ? 14 : 16} />
      {shortLabel ? <span className="text-[8px] font-black leading-none md:hidden">{shortLabel}</span> : null}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function InquiryDetailHeader({
  title,
  inquiry,
  description,
  actions,
}: {
  title: string;
  inquiry: Inquiry;
  description: ReactNode;
  actions: ReactNode;
}) {
  return <AdminPageHero title={title} meta={getInquiryCode(inquiry.id)} description={description} actions={actions} />;
}

function CustomerInquiryDetailSkeleton({ inquiryId, onBack }: { inquiryId: string; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 scrollbar-hidden md:px-0 md:pb-0 md:pt-0">
        <main className="flex flex-col gap-3 md:gap-4">
          <AdminPageHero
            title="我的询价详情"
            meta={getInquiryCode(inquiryId)}
            description="提交于 -- · -- 项产品"
            actions={
              <>
                <InquiryDetailHeaderAction icon="arrow_back" label="返回" onClick={onBack} />
                <span className="hidden h-10 w-[102px] rounded-lg border border-transparent sm:block" aria-hidden />
              </>
            }
          />
          <section className="rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 md:px-5">
            <div className="mb-4 h-4 w-28 rounded bg-surface-container-high" />
            <div className="grid gap-4 md:grid-cols-4 md:gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex gap-3 md:block md:text-center">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-outline-variant/20 bg-surface-container-high md:mx-auto" />
                  <div className="min-w-0 flex-1 md:mt-2">
                    <div className="h-4 rounded bg-surface-container-high" />
                    <div className="mt-2 h-3 rounded bg-surface-container" />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-outline-variant/15 bg-surface-container-low">
            <div className="border-b border-outline-variant/10 px-4 py-3 md:px-5">
              <div className="h-4 w-24 rounded bg-surface-container-high" />
              <div className="mt-2 h-3 w-32 rounded bg-surface-container" />
            </div>
            <div className="px-4 py-3 md:px-5">
              <div className="h-5 rounded bg-surface-container-high" />
              <div className="mt-2 h-3 w-2/3 rounded bg-surface-container" />
            </div>
          </section>
        </main>
      </div>
      <div className="shrink-0 border-t border-outline-variant/10 bg-surface-container p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="mb-2 h-7 rounded-full bg-surface-container-high" />
        <div className="h-10 rounded-lg bg-surface-container-high" />
      </div>
      <PageRefreshIndicator label="询价单详情刷新中" />
    </div>
  );
}

function InquiryMessagesSection({
  inquiry,
  isAdmin,
  messagesEndRef,
  flat = false,
  mobileOpen = false,
  onMobileToggle,
}: {
  inquiry: Inquiry;
  isAdmin: boolean;
  messagesEndRef: { current: HTMLDivElement | null };
  flat?: boolean;
} & MobileCollapseProps) {
  const messages = getInquiryMessages(inquiry);
  const isCollapsible = Boolean(onMobileToggle);
  const isOpen = !isCollapsible || mobileOpen;
  const titleText = '沟通记录';
  const descriptionText = flat
    ? `${messages.length} 条消息`
    : `${messages.length} 条消息，记录这张询价单的客户和业务确认过程`;

  return (
    <section
      className={
        flat
          ? 'overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low'
          : 'rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4'
      }
    >
      {flat ? (
        <button
          type="button"
          onClick={onMobileToggle}
          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
            isOpen ? 'border-b border-outline-variant/10' : ''
          }`}
          aria-expanded={isOpen}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-on-surface">{titleText}</span>
            <span className="block truncate text-[11px] text-on-surface-variant">{descriptionText}</span>
          </span>
          <Icon
            name="expand_more"
            size={17}
            className={`shrink-0 text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      ) : isCollapsible ? (
        <button
          type="button"
          onClick={onMobileToggle}
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={isOpen}
        >
          <span>
            <span className="block text-sm font-semibold text-on-surface">{titleText}</span>
            <span className="mt-1 block text-xs text-on-surface-variant">{descriptionText}</span>
          </span>
          <Icon
            name="expand_more"
            size={17}
            className={`shrink-0 text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      ) : null}
      {!flat && !isCollapsible ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">{titleText}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">{descriptionText}</p>
          </div>
        </div>
      ) : null}
      <div
        className={
          flat
            ? `${isOpen ? 'block' : 'hidden'} px-4 py-4`
            : `${isOpen ? 'block' : 'hidden'} mt-3 rounded-xl bg-surface-container-lowest p-3 md:p-4`
        }
      >
        {messages.length === 0 ? (
          <p className="flex min-h-32 items-center justify-center text-center text-sm text-on-surface-variant">
            暂无沟通记录，业务回复后会显示在这里
          </p>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} isAdminView={isAdmin} />)
        )}
        <div ref={messagesEndRef} />
      </div>
    </section>
  );
}

function NoteCard({ title, content, icon }: { title: string; content?: string | null; icon: string }) {
  if (!content) return null;
  return (
    <section className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon name={icon} size={16} className="text-on-surface-variant" />
        <h3 className="text-sm font-bold text-on-surface">{title}</h3>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-on-surface-variant">{content}</p>
    </section>
  );
}

function DetailContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isAdmin = user?.role === 'ADMIN' && location.pathname.startsWith('/admin/inquiries');
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);
  const statuses = business.inquiryStatuses;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: inquiry, mutate } = useSWR<Inquiry>(id ? `inquiry-${id}` : null, () => getInquiry(id), {
    refreshInterval: 5000,
  });

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [pendingAttachmentPreviewUrl, setPendingAttachmentPreviewUrl] = useState<string | null>(null);
  const [pendingAttachmentName, setPendingAttachmentName] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [salesAssignOpen, setSalesAssignOpen] = useState(false);
  const [itemsEditing, setItemsEditing] = useState(false);
  const [itemDrafts, setItemDrafts] = useState<InquiryItemDraft[]>([]);
  const [savingItems, setSavingItems] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancellingInquiry, setCancellingInquiry] = useState(false);
  const [mobileSections, setMobileSections] = useState<Record<CustomerMobileSection, boolean>>(
    DEFAULT_CUSTOMER_MOBILE_SECTIONS,
  );
  const messageCount = inquiry ? getInquiryMessages(inquiry).length : undefined;

  const prevMsgCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = messageCount;
    if (len !== undefined && prevMsgCount.current !== undefined && len > prevMsgCount.current) {
      setMobileSections((prev) => ({ ...prev, messages: true }));
      window.setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 0);
    }
    prevMsgCount.current = len;
  }, [messageCount]);

  useEffect(() => {
    setMobileSections(DEFAULT_CUSTOMER_MOBILE_SECTIONS);
  }, [id]);

  useEffect(() => {
    return () => {
      if (pendingAttachmentPreviewUrl) URL.revokeObjectURL(pendingAttachmentPreviewUrl);
    };
  }, [pendingAttachmentPreviewUrl]);

  function toggleMobileSection(section: CustomerMobileSection) {
    setMobileSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  if (!inquiry) {
    if (!isAdmin) {
      return <CustomerInquiryDetailSkeleton inquiryId={id} onBack={() => navigate(-1)} />;
    }
    return <InquiryDetailLoadingState />;
  }

  async function handleSendMsg() {
    if ((!msgInput.trim() && !pendingAttachment) || sending || uploadingAttachment) return;
    setSending(true);
    try {
      await sendInquiryMessage(id, msgInput.trim(), pendingAttachment || undefined);
      setMsgInput('');
      setPendingAttachment(null);
      setPendingAttachmentPreviewUrl(null);
      setPendingAttachmentName(null);
      setMobileSections((prev) => ({ ...prev, messages: true }));
      mutate();
    } catch (err) {
      notifyGlobalError(err, '发送失败');
    } finally {
      setSending(false);
    }
  }

  function handleQuickReply(phrase: string) {
    setMsgInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${phrase}` : phrase));
  }

  async function uploadComposerAttachment(file: File | null | undefined, source: 'picker' | 'paste') {
    if (!file) return;
    if (uploadingAttachment) {
      toast('附件正在上传，请稍后再试', 'info');
      return;
    }
    if (pendingAttachment || pendingAttachmentPreviewUrl || pendingAttachmentName) {
      toast(
        source === 'paste' ? '已有待发送附件，请先发送或移除后再粘贴截图' : '已有待发送附件，请先发送或移除后再上传',
        'info',
      );
      return;
    }

    const maxMb = Math.max(1, Number(business.uploadPolicy.ticketAttachmentMaxSizeMb) || 100);
    if (file.size > maxMb * 1024 * 1024) {
      toast(`附件不能超过 ${maxMb}MB`, 'error');
      return;
    }

    const isImage = file.type.startsWith('image/');
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    setPendingAttachmentPreviewUrl(previewUrl);
    setPendingAttachmentName(file.name);
    setUploadingAttachment(true);
    try {
      const { url } = await uploadInquiryAttachment(id, file);
      setPendingAttachment(url);
    } catch (err) {
      notifyGlobalError(err, '附件上传失败');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPendingAttachmentPreviewUrl(null);
      setPendingAttachmentName(null);
      setPendingAttachment(null);
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleAttachmentSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    await uploadComposerAttachment(file, 'picker');
    event.target.value = '';
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = getClipboardImageFile(event.clipboardData);
    if (!file) return;
    if (!event.clipboardData.getData('text/plain')) {
      event.preventDefault();
    }
    void uploadComposerAttachment(file, 'paste');
  }

  function clearPendingAttachment() {
    if (pendingAttachmentPreviewUrl) URL.revokeObjectURL(pendingAttachmentPreviewUrl);
    setPendingAttachment(null);
    setPendingAttachmentPreviewUrl(null);
    setPendingAttachmentName(null);
    setUploadingAttachment(false);
  }

  function requestCancelInquiry() {
    setCancelConfirmOpen(true);
  }

  async function confirmCancelInquiry() {
    if (cancellingInquiry) return;
    setCancellingInquiry(true);
    try {
      await cancelInquiry(id);
      await mutate();
      setCancelConfirmOpen(false);
      toast('已取消', 'success');
    } catch (err) {
      notifyGlobalError(err, '取消失败');
    } finally {
      setCancellingInquiry(false);
    }
  }

  async function handleStatusUpdate(status: string) {
    try {
      await updateInquiryStatus(id, status);
      setItemsEditing(false);
      mutate();
      toast(`状态已更新`, 'success');
    } catch (err) {
      notifyGlobalError(err, '操作失败');
    }
  }

  const canMessage = inquiry.status !== 'cancelled' && inquiry.status !== 'draft' && inquiry.status !== 'rejected';
  const canEditItems = isAdmin ? ['submitted', 'quoted'].includes(inquiry.status) : inquiry.status === 'draft';
  const canAssignSales = isAdmin && !['cancelled', 'rejected'].includes(inquiry.status);
  const canMarkReplied = isAdmin && inquiry.status === 'submitted';
  const canCloseInquiry = isAdmin && ['submitted', 'quoted'].includes(inquiry.status);
  const quotationCompanyName = String(settings?.site_title || '3DPartHub').trim() || '3DPartHub';
  const quotationCompanyLogo = typeof settings?.site_logo === 'string' ? settings.site_logo : '';

  function renderAdminTimelineActions() {
    if (!isAdmin || (!canAssignSales && !canMarkReplied && !canCloseInquiry)) return null;
    return (
      <>
        {canAssignSales ? (
          <button
            type="button"
            onClick={() => setSalesAssignOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-green-500/12 px-2.5 text-xs font-semibold text-green-600 transition-colors hover:bg-green-500/18"
          >
            <Icon name="badge" size={13} />
            分配销售
          </button>
        ) : null}
        {canMarkReplied ? (
          <button
            type="button"
            onClick={() => handleStatusUpdate('quoted')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary-container px-2.5 text-xs font-semibold text-on-primary transition-opacity hover:opacity-90"
          >
            <Icon name="send" size={13} />
            标记已回复
          </button>
        ) : null}
        {canCloseInquiry ? (
          <button
            type="button"
            onClick={() => handleStatusUpdate('rejected')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-500/12 px-2.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/18"
          >
            <Icon name="close" size={13} />
            关闭
          </button>
        ) : null}
      </>
    );
  }

  function handleStartItemsEdit() {
    setMobileSections((prev) => ({ ...prev, items: true }));
    setItemDrafts(createItemDrafts(inquiry!.items));
    setItemsEditing(true);
  }

  function handleCancelItemsEdit() {
    setItemsEditing(false);
    setItemDrafts([]);
  }

  function handleItemDraftChange(itemId: string, patch: Partial<InquiryItemDraft>) {
    setItemDrafts((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  function handleItemDraftRemove(itemId: string) {
    if (itemDrafts.length <= 1) {
      toast('至少保留一个询价产品', 'error');
      return;
    }
    setItemDrafts((prev) => prev.filter((item) => item.id !== itemId));
  }

  async function handleSaveItems() {
    const items = itemDrafts.map((item) => ({
      id: item.id,
      qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
      remark: item.remark.trim(),
    }));
    if (items.length === 0) {
      toast('至少保留一个询价产品', 'error');
      return;
    }
    setSavingItems(true);
    try {
      const updated = await updateInquiryItems(id, { items });
      mutate(updated, { revalidate: false });
      setItemsEditing(false);
      setItemDrafts([]);
      toast('询价产品已更新', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '更新询价产品失败'), 'error');
    } finally {
      setSavingItems(false);
    }
  }

  function handleExportQuote() {
    const html = buildQuotePrintHtml({
      inquiry: inquiry!,
      companyName: quotationCompanyName,
      companyLogo: quotationCompanyLogo,
      statuses,
      fallbackUrl: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
    const printWindow = window.open('', '_blank', 'width=960,height=900');
    if (!printWindow) {
      toast('浏览器拦截了导出窗口，请允许弹窗后重试', 'error');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  async function handleExportExcel() {
    try {
      await exportInquiryEditableXlsx({ inquiry: inquiry!, statuses });
      toast('已导出询价明细表，可直接编辑报价信息', 'success');
    } catch (err) {
      toast(getErrorMessage(err, '导出询价明细失败'), 'error');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 scrollbar-hidden md:px-0 md:pb-0 md:pt-0">
        {isAdmin ? (
          <main className="flex w-full min-w-0 flex-col gap-3 md:gap-4">
            <InquiryDetailHeader
              title="询价处理详情"
              inquiry={inquiry}
              description={`提交于 ${formatDateTime(inquiry.createdAt)} · ${inquiry.items.length} 项产品 · ${
                inquiry.company || inquiry.contactName || inquiry.user?.username || '客户'
              }`}
              actions={
                <>
                  <InquiryDetailHeaderAction icon="arrow_back" label="返回" onClick={() => navigate(-1)} />
                  <InquiryDetailHeaderAction
                    icon="description"
                    label="导出PDF"
                    shortLabel="PDF"
                    onClick={handleExportQuote}
                  />
                  <InquiryDetailHeaderAction
                    icon="spreadsheet"
                    label="导出Excel"
                    shortLabel="XLS"
                    onClick={handleExportExcel}
                  />
                </>
              }
            />
            <CustomerStatusPanel
              inquiry={inquiry}
              renderActions={renderAdminTimelineActions}
              mobileOpen={mobileSections.progress}
              onMobileToggle={() => toggleMobileSection('progress')}
            />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
              <div className="min-w-0 space-y-4">
                <CustomerItemsList
                  inquiry={inquiry}
                  canEdit={canEditItems}
                  editing={itemsEditing}
                  saving={savingItems}
                  drafts={itemDrafts}
                  onEdit={handleStartItemsEdit}
                  onCancel={handleCancelItemsEdit}
                  onSave={handleSaveItems}
                  onDraftChange={handleItemDraftChange}
                  onDraftRemove={handleItemDraftRemove}
                  mobileOpen={mobileSections.items}
                  onMobileToggle={() => toggleMobileSection('items')}
                />
                {inquiry.remark || inquiry.adminRemark ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <NoteCard title="用户备注" content={inquiry.remark} icon="description" />
                    <NoteCard title="跟进备注" content={inquiry.adminRemark} icon="edit" />
                  </div>
                ) : null}
                <InquiryMessagesSection
                  inquiry={inquiry}
                  isAdmin
                  messagesEndRef={messagesEndRef}
                  flat
                  mobileOpen={mobileSections.messages}
                  onMobileToggle={() => toggleMobileSection('messages')}
                />
              </div>
              <div className="order-first md:sticky md:top-[4.25rem] md:z-10 md:self-start xl:order-none">
                <div className="space-y-4">
                  <CustomerDetailSummary
                    inquiry={inquiry}
                    mobileOpen={mobileSections.summary}
                    onMobileToggle={() => toggleMobileSection('summary')}
                  />
                </div>
              </div>
            </div>
          </main>
        ) : (
          <main className="flex w-full min-w-0 flex-col gap-3 md:gap-4">
            <InquiryDetailHeader
              title="我的询价详情"
              inquiry={inquiry}
              description={`提交于 ${formatDateTime(inquiry.createdAt)} · ${inquiry.items.length} 项产品`}
              actions={
                <>
                  <InquiryDetailHeaderAction icon="arrow_back" label="返回" onClick={() => navigate(-1)} />
                  {inquiry.status === 'submitted' ? (
                    <InquiryDetailHeaderAction
                      icon="close"
                      label="取消询价"
                      onClick={requestCancelInquiry}
                      tone="danger"
                    />
                  ) : null}
                </>
              }
            />
            <CustomerStatusPanel
              inquiry={inquiry}
              mobileOpen={mobileSections.progress}
              onMobileToggle={() => toggleMobileSection('progress')}
            />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
              <div className="min-w-0 space-y-4">
                <CustomerItemsList
                  inquiry={inquiry}
                  canEdit={canEditItems}
                  editing={itemsEditing}
                  saving={savingItems}
                  drafts={itemDrafts}
                  onEdit={handleStartItemsEdit}
                  onCancel={handleCancelItemsEdit}
                  onSave={handleSaveItems}
                  onDraftChange={handleItemDraftChange}
                  onDraftRemove={handleItemDraftRemove}
                  mobileOpen={mobileSections.items}
                  onMobileToggle={() => toggleMobileSection('items')}
                />
                <InquiryMessagesSection
                  inquiry={inquiry}
                  isAdmin={false}
                  messagesEndRef={messagesEndRef}
                  flat
                  mobileOpen={mobileSections.messages}
                  onMobileToggle={() => toggleMobileSection('messages')}
                />
              </div>
              <div className="order-first md:sticky md:top-[4.25rem] md:z-10 md:self-start xl:order-none">
                <div className="space-y-4">
                  <CustomerDetailSummary
                    inquiry={inquiry}
                    mobileOpen={mobileSections.summary}
                    onMobileToggle={() => toggleMobileSection('summary')}
                  />
                </div>
              </div>
            </div>
          </main>
        )}
      </div>

      {canMessage && (
        <div className="shrink-0 border-t border-outline-variant/10 bg-surface-container p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:p-3">
          {pendingAttachmentPreviewUrl || pendingAttachmentName ? (
            <div className="relative mb-2 inline-block">
              {pendingAttachmentPreviewUrl ? (
                <SafeImage
                  src={pendingAttachmentPreviewUrl}
                  alt="待发送"
                  className="h-16 rounded border border-outline-variant/20 object-contain md:h-20"
                />
              ) : (
                <div className="flex max-w-xs items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-high px-3 py-2 text-xs text-on-surface-variant">
                  <Icon name="attach_file" size={14} />
                  <span className="truncate">{pendingAttachmentName}</span>
                </div>
              )}
              {uploadingAttachment ? (
                <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  上传中
                </span>
              ) : null}
              <button
                type="button"
                onClick={clearPendingAttachment}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-xs text-on-primary"
                aria-label="移除附件"
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-1.5">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachmentSelect} />
            <QuickReplyChips
              phrases={isAdmin ? INQUIRY_ADMIN_QUICK_REPLIES : INQUIRY_USER_QUICK_REPLIES}
              onPick={handleQuickReply}
              title={isAdmin ? '询价处理快捷词' : '我的询价快捷词'}
            />
            <textarea
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onPaste={handleComposerPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMsg();
                }
              }}
              placeholder={
                isDesktop ? '输入回复内容... (Enter 发送, Shift+Enter 换行，可粘贴截图)' : '输入回复 / 粘贴截图'
              }
              rows={1}
              className="max-h-28 min-h-9 min-w-0 flex-1 resize-none rounded-lg border border-outline-variant/20 bg-surface-container-high px-2.5 py-2 text-xs text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/40 focus:border-primary-container focus:ring-1 focus:ring-primary-container/20 md:min-h-10 md:px-3 md:py-2.5 md:text-sm"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAttachment}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high active:bg-surface-container-highest md:h-10 md:w-10"
              aria-label="上传图片"
            >
              <Icon name="image" size={isDesktop ? 18 : 16} />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAttachment}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high active:bg-surface-container-highest md:h-10 md:w-10"
              aria-label="上传附件"
            >
              <Icon name="attachment" size={isDesktop ? 18 : 16} />
            </button>
            <button
              onClick={handleSendMsg}
              disabled={sending || uploadingAttachment || (!msgInput.trim() && !pendingAttachment)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-container text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 md:h-10 md:w-auto md:px-4"
            >
              <Icon name="send" size={isDesktop ? 14 : 16} />
              <span className="hidden md:inline">发送</span>
            </button>
          </div>
        </div>
      )}
      {!canMessage && (
        <div className="shrink-0 border-t border-outline-variant/10 bg-surface-container px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-center text-xs text-on-surface-variant">
          当前询价已结束，沟通记录仅供查看。
        </div>
      )}
      <InquirySalesAssignmentDialog
        open={salesAssignOpen}
        inquiry={inquiry}
        onClose={() => setSalesAssignOpen(false)}
        onAssigned={(updated) => mutate(updated, { revalidate: false })}
      />
      <ConfirmDialog
        open={cancelConfirmOpen}
        onClose={() => {
          if (!cancellingInquiry) setCancelConfirmOpen(false);
        }}
        onConfirm={confirmCancelInquiry}
        icon="close"
        title="确认取消询价？"
        description="取消后该询价单将结束处理，业务人员不会继续按这份询价单报价。沟通记录仍会保留用于查看。"
        confirmLabel={cancellingInquiry ? '取消中...' : '确认取消'}
        confirmDisabled={cancellingInquiry}
      />
    </div>
  );
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  useDocumentTitle('询价单详情');

  const content = <DetailContent id={id!} />;
  const isAdminRoute = location.pathname.startsWith('/admin/inquiries');

  if (!isAdminRoute) {
    return (
      <AdminPageShell
        desktopContentClassName="overflow-hidden"
        mobileMainClassName="overflow-hidden"
        mobileContentClassName="h-full !p-0"
        hideMobileBottomNav
      >
        {content}
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      desktopContentClassName="overflow-hidden p-0"
      mobileMainClassName="overflow-hidden"
      mobileContentClassName="h-full !p-0"
      hideMobileBottomNav
    >
      {content}
    </AdminPageShell>
  );
}
