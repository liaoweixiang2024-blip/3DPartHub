import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import {
  getInquiry,
  sendInquiryMessage,
  cancelInquiry,
  updateInquiryStatus,
  type Inquiry,
  type InquiryMessage,
} from '../api/inquiries';
import { AdminDetailHeader } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getBusinessConfig, statusInfo, type StatusConfig } from '../lib/businessConfig';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

function StatusBadge({ status, statuses }: { status: string; statuses: StatusConfig[] }) {
  const info = statusInfo(statuses, status);
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-bold ${info.color || ''} ${info.bg || ''}`}
    >
      {info.label}
    </span>
  );
}

// Message bubble
function MessageBubble({ msg }: { msg: InquiryMessage }) {
  const isRight = msg.isAdmin;
  return (
    <div className={`flex ${isRight ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
          isRight ? 'bg-primary-container/15 text-on-surface' : 'bg-surface-container-high text-on-surface'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        {msg.attachment && (
          <a
            href={msg.attachment}
            target="_blank"
            rel="noopener"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary-container"
          >
            <Icon name="attach_file" size={12} />
            附件
          </a>
        )}
        <div className="mt-1 text-[10px] text-on-surface-variant">
          {msg.user?.username || '用户'} · {new Date(msg.createdAt).toLocaleString('zh-CN')}
        </div>
      </div>
    </div>
  );
}

function ItemsTable({ items }: { items: Inquiry['items'] }) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-outline-variant/12 bg-surface-container-low p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-on-surface">{item.modelNo || item.productName}</p>
                {item.modelNo && item.productName !== item.modelNo && (
                  <p className="mt-0.5 break-words text-xs text-on-surface-variant">{item.productName}</p>
                )}
              </div>
              <span className="shrink-0 rounded-md bg-surface-container-high px-2 py-1 text-xs font-semibold tabular-nums text-on-surface">
                x{item.qty}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-outline-variant/8 pt-2 text-xs text-on-surface-variant">
              <span>序号 {index + 1}</span>
              <span className="min-w-0 truncate text-right">{item.remark || '无备注'}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-lg border border-outline-variant/15 max-h-[50vh] md:block">
        <table className="min-w-[520px] w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-container-low">
              <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">型号/产品</th>
              <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">数量</th>
              <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">备注</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-outline-variant/5">
                <td className="px-4 py-2.5">
                  <p className="text-on-surface font-medium break-words">{item.modelNo || item.productName}</p>
                  {item.modelNo && item.productName !== item.modelNo && (
                    <p className="text-xs text-on-surface-variant break-words">{item.productName}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 text-on-surface">{item.qty}</td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">{item.remark || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DetailContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const statuses = getBusinessConfig(settings).inquiryStatuses;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: inquiry, mutate } = useSWR<Inquiry>(id ? `inquiry-${id}` : null, () => getInquiry(id), {
    refreshInterval: 5000,
  });

  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);

  const prevMsgCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = inquiry?.messages?.length;
    if (len !== undefined && prevMsgCount.current !== undefined && len > prevMsgCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCount.current = len;
  }, [inquiry?.messages?.length]);

  if (!inquiry) {
    return (
      <div className="flex h-full min-h-0 flex-col animate-pulse">
        {/* AdminDetailHeader: shrink-0 border-b px-4 py-3 */}
        <div className="shrink-0 border-b border-outline-variant/10 bg-surface-container px-4 py-3">
          <div className="flex min-h-9 items-center gap-3">
            <div className="h-9 w-9 bg-surface-container rounded-lg shrink-0" />
            <div className="h-6 bg-surface-container rounded w-24" />
            <div className="h-5 bg-surface-container rounded-sm w-12 ml-auto" />
          </div>
          <div className="mt-0.5 flex items-center gap-4">
            <div className="h-3 bg-surface-container rounded w-28" />
            <div className="h-3 bg-surface-container rounded w-16" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4 space-y-4">
          {/* Contact info card */}
          <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4 space-y-2">
            <div className="h-4 bg-surface-container rounded w-16" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="h-4 bg-surface-container rounded w-full" />
              <div className="h-4 bg-surface-container rounded w-3/4" />
              <div className="h-4 bg-surface-container rounded w-1/2" />
            </div>
          </div>
          {/* Items */}
          <div>
            <div className="h-4 bg-surface-container rounded w-16 mb-2" />
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-outline-variant/12 bg-surface-container-low p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="h-4 bg-surface-container rounded w-24" />
                      <div className="h-3 bg-surface-container rounded w-36" />
                    </div>
                    <div className="h-5 bg-surface-container-high rounded-md w-10 shrink-0" />
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-outline-variant/8 pt-2">
                    <div className="h-3 bg-surface-container rounded w-10" />
                    <div className="h-3 bg-surface-container rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden overflow-auto rounded-lg border border-outline-variant/15 md:block">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-surface-container-low">
                  <tr>
                    <th className="px-4 py-2.5 text-left">
                      <div className="h-3 w-8" />
                    </th>
                    <th className="px-4 py-2.5 text-left">
                      <div className="h-3 w-12" />
                    </th>
                    <th className="px-4 py-2.5 text-left">
                      <div className="h-3 w-8" />
                    </th>
                    <th className="px-4 py-2.5 text-left">
                      <div className="h-3 w-10" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-t border-outline-variant/5">
                      <td className="px-4 py-2.5">
                        <div className="h-3 bg-surface-container rounded w-6" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-3 bg-surface-container rounded w-24" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-3 bg-surface-container rounded w-6" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="h-3 bg-surface-container rounded w-20" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function handleSendMsg() {
    if (!msgInput.trim()) return;
    setSending(true);
    try {
      await sendInquiryMessage(id, msgInput.trim());
      setMsgInput('');
      mutate();
    } catch {
      toast('发送失败', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelInquiry(id);
      mutate();
      toast('已取消', 'success');
    } catch {
      toast('取消失败', 'error');
    }
  }

  async function handleStatusUpdate(status: string) {
    try {
      await updateInquiryStatus(id, status);
      mutate();
      toast(`状态已更新`, 'success');
    } catch {
      toast('操作失败', 'error');
    }
  }

  const canMessage = inquiry.status !== 'cancelled' && inquiry.status !== 'draft';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AdminDetailHeader
        title="询价单详情"
        onBack={() => navigate(-1)}
        actions={<StatusBadge status={inquiry.status} statuses={statuses} />}
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex min-w-0 items-center gap-1">
              <Icon name="schedule" size={12} className="shrink-0" />
              <span className="truncate">{new Date(inquiry.createdAt).toLocaleString('zh-CN')}</span>
            </span>
            {inquiry.user ? (
              <span className="flex min-w-0 items-center gap-1">
                <Icon name="person" size={12} className="shrink-0" />
                <span className="truncate">{inquiry.user.username}</span>
              </span>
            ) : null}
            {inquiry.company ? <span className="truncate">{inquiry.company}</span> : null}
          </div>
        }
      >
        {inquiry.status === 'submitted' && !isAdmin && (
          <button
            onClick={handleCancel}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high/50"
          >
            取消询价
          </button>
        )}
        {isAdmin && inquiry.status === 'submitted' && (
          <>
            <button
              onClick={() => handleStatusUpdate('quoted')}
              className="rounded-lg bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary transition-opacity hover:opacity-90"
            >
              标记已回复
            </button>
            <button
              onClick={() => handleStatusUpdate('rejected')}
              className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-500 transition-opacity hover:opacity-90"
            >
              关闭
            </button>
          </>
        )}
        {isAdmin && inquiry.status === 'quoted' && (
          <>
            <button
              onClick={() => handleStatusUpdate('accepted')}
              className="rounded-lg bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-600 transition-opacity hover:opacity-90"
            >
              转销售跟进
            </button>
            <button
              onClick={() => handleStatusUpdate('rejected')}
              className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-500 transition-opacity hover:opacity-90"
            >
              关闭
            </button>
          </>
        )}
      </AdminDetailHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-hidden">
        <div className="space-y-6">
          {(inquiry.company || inquiry.contactName || inquiry.contactPhone) && (
            <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
              <h3 className="mb-2 text-sm font-bold text-on-surface">联系信息</h3>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3 sm:gap-4">
                {inquiry.company && (
                  <div className="min-w-0">
                    <span className="text-on-surface-variant">公司：</span>
                    <span className="break-words text-on-surface">{inquiry.company}</span>
                  </div>
                )}
                {inquiry.contactName && (
                  <div className="min-w-0">
                    <span className="text-on-surface-variant">联系人：</span>
                    <span className="break-words text-on-surface">{inquiry.contactName}</span>
                  </div>
                )}
                {inquiry.contactPhone && (
                  <div className="min-w-0">
                    <span className="text-on-surface-variant">电话：</span>
                    <span className="break-words text-on-surface">{inquiry.contactPhone}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-bold text-on-surface">产品明细</h3>
            <ItemsTable items={inquiry.items} />
          </div>

          {inquiry.adminRemark && (
            <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
              <h3 className="mb-1 text-sm font-bold text-on-surface">跟进备注</h3>
              <p className="text-sm text-on-surface-variant">{inquiry.adminRemark}</p>
            </div>
          )}

          {inquiry.remark && (
            <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
              <h3 className="mb-1 text-sm font-bold text-on-surface">用户备注</h3>
              <p className="text-sm text-on-surface-variant">{inquiry.remark}</p>
            </div>
          )}

          <div>
            <h3 className="mb-3 text-sm font-bold text-on-surface">沟通记录</h3>
            <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
              {(inquiry.messages || []).length === 0 ? (
                <p className="flex min-h-32 items-center justify-center text-center text-sm text-on-surface-variant">
                  暂无消息
                </p>
              ) : (
                (inquiry.messages || []).map((msg) => <MessageBubble key={msg.id} msg={msg} />)
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>

      {canMessage && (
        <div className="shrink-0 border-t border-outline-variant/10 bg-surface-container p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-end gap-2">
            <textarea
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMsg();
                }
              }}
              placeholder="输入消息..."
              rows={1}
              className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-lg border border-outline-variant/20 bg-surface-container-high px-3 py-2.5 text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/45 focus:border-primary-container"
            />
            <button
              onClick={handleSendMsg}
              disabled={sending || !msgInput.trim()}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-4 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon name="send" size={14} />
              <span className="hidden sm:inline">发送</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle('询价单详情');

  const content = <DetailContent id={id!} />;

  return (
    <AdminPageShell
      desktopContentClassName="overflow-hidden p-0"
      mobileMainClassName="overflow-hidden"
      mobileContentClassName="h-full p-0"
      hideMobileBottomNav
    >
      {content}
    </AdminPageShell>
  );
}
