import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import {
  getTicketMessages,
  sendTicketMessage,
  updateTicketStatus,
  uploadTicketAttachment,
  type TicketMessage,
} from '../api/tickets';
import { AdminDetailHeader } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import SafeImage from '../components/shared/SafeImage';
import { SkeletonList } from '../components/shared/Skeleton';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { getCachedPublicSettings } from '../lib/publicSettings';

interface TicketInfo {
  id: string;
  userId: string;
  basePart: string | null;
  classification: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  user: { username: string; email: string; role?: string } | null;
}

function useTicket(id: string) {
  return useSWR<TicketInfo | null>(
    `/ticket-${id}`,
    () =>
      client
        .get(`/tickets/${id}`)
        .then((response) => unwrapResponse<TicketInfo>(response))
        .catch(() => null),
    { revalidateOnFocus: false },
  );
}

function useMessages(ticketId: string) {
  return useSWR<TicketMessage[]>(`/ticket-messages-${ticketId}`, () => getTicketMessages(ticketId).catch(() => []), {
    refreshInterval: 5000,
  });
}

// Chat bubble for a message
function MessageBubble({ msg }: { msg: TicketMessage }) {
  const isRight = msg.isAdmin;
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const attachmentSrc = msg.attachment || '';
  return (
    <div className={`flex ${isRight ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[88%] sm:max-w-[80%] min-w-0 ${isRight ? 'order-2' : 'order-1'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
          {!isRight && (
            <span className="text-[11px] font-medium text-on-surface-variant">{msg.user?.username || '用户'}</span>
          )}
          <span className="text-[10px] text-on-surface-variant/60">
            {new Date(msg.createdAt).toLocaleString('zh-CN')}
          </span>
          {isRight && <span className="text-[11px] font-medium text-primary">管理员</span>}
        </div>
        <div
          className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isRight
              ? 'bg-primary-container/20 text-on-surface border border-primary/10'
              : 'bg-surface-container-high text-on-surface border border-outline-variant/10'
          }`}
        >
          {msg.content}
          {msg.attachment && (
            <SafeImage
              src={attachmentSrc}
              alt="附件"
              className="mt-2 max-w-full max-h-[240px] rounded cursor-pointer hover:opacity-90 transition-opacity object-contain"
              fallbackClassName="min-h-24"
              onClick={() => setPreviewImg(attachmentSrc)}
            />
          )}
        </div>
      </div>
      {/* Image preview overlay */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setPreviewImg(null)}
        >
          <SafeImage src={previewImg} alt="预览" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}

// Original description shown as first "message"
function OriginalMessage({ ticket }: { ticket: TicketInfo }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[88%] sm:max-w-[80%] min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
          <span className="text-[11px] font-medium text-on-surface-variant">{ticket.user?.username || '用户'}</span>
          <span className="text-[10px] text-on-surface-variant/60">
            {new Date(ticket.createdAt).toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-surface-container-high text-on-surface border border-outline-variant/10">
          {ticket.description}
        </div>
        {ticket.basePart && (
          <p className="text-[11px] text-on-surface-variant mt-1 ml-1 break-words">基准零件: {ticket.basePart}</p>
        )}
      </div>
    </div>
  );
}

// Status action buttons for admin
function StatusActions({ status, onUpdate }: { ticketId: string; status: string; onUpdate: (s: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {status === 'open' && (
        <button
          onClick={() => onUpdate('in_progress')}
          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 active:scale-[0.96] transition-all"
        >
          开始处理
        </button>
      )}
      {status === 'in_progress' && (
        <button
          onClick={() => onUpdate('resolved')}
          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-[0.96] transition-all"
        >
          标记解决
        </button>
      )}
      {status !== 'closed' && (
        <button
          onClick={() => onUpdate('closed')}
          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-on-surface-variant bg-surface-container-highest/70 hover:bg-surface-container-highest active:scale-[0.96] transition-all"
        >
          关闭工单
        </button>
      )}
      {status === 'closed' && (
        <button
          onClick={() => onUpdate('open')}
          className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium text-primary-container bg-primary-container/10 hover:bg-primary-container/20 active:scale-[0.96] transition-all"
        >
          重新打开
        </button>
      )}
    </div>
  );
}

function ChatContent({ ticketId }: { ticketId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { data: ticket } = useTicket(ticketId);
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const { data: messages, mutate: mutateMessages } = useMessages(ticketId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = ticket?.user?.role !== undefined;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || sending) return;
    setSending(true);
    try {
      await sendTicketMessage(ticketId, input.trim(), pendingImage || undefined);
      setInput('');
      setPendingImage(null);
      setPendingImageUrl(null);
      mutateMessages();
    } catch {
      toast('发送失败', 'error');
    } finally {
      setSending(false);
    }
  }, [input, sending, ticketId, pendingImage, mutateMessages, toast]);

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast('请选择图片文件', 'error');
        return;
      }
      if (file.size > business.uploadPolicy.ticketAttachmentMaxSizeMb * 1024 * 1024) {
        toast(`附件不能超过 ${business.uploadPolicy.ticketAttachmentMaxSizeMb}MB`, 'error');
        return;
      }
      try {
        setPendingImageUrl(URL.createObjectURL(file));
        const { url } = await uploadTicketAttachment(ticketId, file);
        setPendingImage(url);
      } catch {
        toast('图片上传失败', 'error');
        setPendingImageUrl(null);
      }
      e.target.value = '';
    },
    [ticketId, toast, business.uploadPolicy.ticketAttachmentMaxSizeMb],
  );

  const handleStatusUpdate = useCallback(
    async (status: string) => {
      try {
        await updateTicketStatus(ticketId, status);
        toast('状态已更新', 'success');
      } catch {
        toast('更新状态失败', 'error');
      }
    },
    [ticketId, toast],
  );

  if (!ticket) {
    return <SkeletonList rows={4} />;
  }

  const info = statusInfo(business.ticketStatuses, ticket.status);
  const msgList = messages || [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AdminDetailHeader
        title={classificationMap.get(ticket.classification) || ticket.classification}
        onBack={() => navigate(-1)}
        actions={
          <span
            className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-bold ${info.color || ''} ${info.bg || ''}`}
          >
            {info.label}
          </span>
        }
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1 min-w-0">
              <Icon name="person" size={12} className="shrink-0" />
              <span className="truncate">{ticket.user?.username || '未知'}</span>
            </span>
            <span className="flex items-center gap-1">
              <Icon name="schedule" size={12} className="shrink-0" />
              {new Date(ticket.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>
        }
      >
        {isAdmin && <StatusActions ticketId={ticketId} status={ticket.status} onUpdate={handleStatusUpdate} />}
      </AdminDetailHeader>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-hidden">
        <OriginalMessage ticket={ticket} />
        {msgList.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className={`shrink-0 border-t border-outline-variant/10 bg-surface-container ${isDesktop ? 'p-3' : 'p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]'}`}
      >
        {pendingImageUrl && (
          <div className="mb-2 relative inline-block">
            <SafeImage
              src={pendingImageUrl}
              alt="待发送"
              className={`${isDesktop ? 'h-20' : 'h-16'} rounded border border-outline-variant/20`}
            />
            <button
              onClick={() => {
                setPendingImage(null);
                setPendingImageUrl(null);
              }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-on-primary rounded-full flex items-center justify-center text-xs"
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isDesktop ? '输入回复内容... (Enter 发送, Shift+Enter 换行)' : '输入回复...'}
            rows={1}
            className={`flex-1 resize-none bg-surface-container-high border border-outline-variant/20 rounded-lg text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors max-h-28 ${isDesktop ? 'px-3 py-2.5 text-sm' : 'px-2.5 py-2 text-xs'}`}
            style={{ minHeight: isDesktop ? '40px' : '34px' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`shrink-0 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest transition-colors ${isDesktop ? 'w-10 h-10' : 'w-9 h-9'}`}
          >
            <Icon name="image" size={isDesktop ? 18 : 16} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`shrink-0 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest transition-colors ${isDesktop ? 'w-10 h-10' : 'w-9 h-9'}`}
          >
            <Icon name="attachment" size={isDesktop ? 18 : 16} />
          </button>
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingImage) || sending}
            className={`shrink-0 flex items-center justify-center text-on-primary bg-primary-container rounded-lg hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${isDesktop ? 'gap-1.5 px-4 py-2.5 text-sm font-medium' : 'w-9 h-9'}`}
          >
            <Icon name="send" size={isDesktop ? 14 : 16} />
            {isDesktop && '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle('工单详情');

  if (!id) return null;

  return (
    <AdminPageShell
      desktopContentClassName="overflow-hidden p-0"
      mobileMainClassName="overflow-hidden"
      mobileContentClassName="h-full p-0"
      hideMobileBottomNav
    >
      <ChatContent ticketId={id} />
    </AdminPageShell>
  );
}
