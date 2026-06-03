import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { AdminPageHero } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import QuickReplyChips from '../components/shared/QuickReplyChips';
import SafeImage from '../components/shared/SafeImage';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { openDocumentUrl } from '../lib/browserDownload';
import { getBusinessConfig, statusInfo } from '../lib/businessConfig';
import { getClipboardImageFile } from '../lib/clipboardImages';
import { notifyGlobalError } from '../lib/errorNotifications';
import { usePublicSettings } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

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

function isImageAttachment(url?: string | null) {
  return Boolean(url?.split(/[?#]/)[0].match(/\.(png|jpe?g|gif|webp|svg)$/i));
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTicketCode(id: string) {
  return `#${id.slice(0, 8).toUpperCase()}`;
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

function useVisualViewportBottomOffset(enabled: boolean) {
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setBottomOffset(0);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      setBottomOffset(0);
      return;
    }

    const updateOffset = () => {
      setBottomOffset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    };

    updateOffset();
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);
    window.addEventListener('orientationchange', updateOffset);

    return () => {
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
      window.removeEventListener('orientationchange', updateOffset);
    };
  }, [enabled]);

  return bottomOffset;
}

// Chat bubble for a message
function MessageBubble({ msg }: { msg: TicketMessage }) {
  const { t, i18n } = useTranslation();
  const isRight = msg.isAdmin;
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const attachmentSrc = msg.attachment || '';
  const attachmentIsImage = isImageAttachment(attachmentSrc);
  const dateLocale = i18n.resolvedLanguage || i18n.language;
  return (
    <div className={`flex ${isRight ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[88%] sm:max-w-[80%] min-w-0 ${isRight ? 'order-2' : 'order-1'}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
          {!isRight && (
            <span className="text-[11px] font-medium text-on-surface-variant">
              {msg.user?.username || t('common.user')}
            </span>
          )}
          <span className="text-[10px] text-on-surface-variant/60">
            {new Date(msg.createdAt).toLocaleString(dateLocale)}
          </span>
          {isRight && <span className="text-[11px] font-medium text-primary">{t('common.admin')}</span>}
        </div>
        <div
          className={`rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isRight
              ? 'bg-primary-container/20 text-on-surface border border-primary/10'
              : 'bg-surface-container-high text-on-surface border border-outline-variant/10'
          }`}
        >
          {msg.content}
          {msg.attachment && attachmentIsImage ? (
            <SafeImage
              src={attachmentSrc}
              alt={t('ticketDetail.attachment')}
              className="mt-2 max-w-full max-h-[240px] rounded cursor-pointer hover:opacity-90 transition-opacity object-contain"
              fallbackClassName="min-h-24"
              onClick={() => setPreviewImg(attachmentSrc)}
            />
          ) : msg.attachment ? (
            <a
              href={attachmentSrc}
              target="_blank"
              rel="noopener"
              onClick={(event) => {
                event.preventDefault();
                openDocumentUrl(attachmentSrc, { title: t('ticketDetail.attachmentPreview') });
              }}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-outline-variant/15 px-2 py-1 text-xs text-primary-container"
            >
              <Icon name="attach_file" size={12} />
              {t('ticketDetail.viewAttachment')}
            </a>
          ) : null}
        </div>
      </div>
      {/* Image preview overlay */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setPreviewImg(null)}
        >
          <SafeImage src={previewImg} alt={t('common.preview')} className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}

// Original description shown as first "message"
function OriginalMessage({ ticket }: { ticket: TicketInfo }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.resolvedLanguage || i18n.language;

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[88%] sm:max-w-[80%] min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
          <span className="text-[11px] font-medium text-on-surface-variant">
            {ticket.user?.username || t('common.user')}
          </span>
          <span className="text-[10px] text-on-surface-variant/60">
            {new Date(ticket.createdAt).toLocaleString(dateLocale)}
          </span>
        </div>
        <div className="rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words bg-surface-container-high text-on-surface border border-outline-variant/10">
          {ticket.description}
        </div>
        {ticket.basePart && (
          <p className="text-[11px] text-on-surface-variant mt-1 ml-1 break-words">
            {t('ticketDetail.basePart', { part: ticket.basePart })}
          </p>
        )}
      </div>
    </div>
  );
}

const TICKET_DETAIL_HEADER_ACTION_TONE = {
  info: 'border-blue-500/20 bg-blue-500/10 text-blue-500 hover:border-blue-500/30 hover:bg-blue-500/20 hover:text-blue-500',
  success:
    'border-emerald-500/20 bg-emerald-500/10 text-emerald-500 hover:border-emerald-500/30 hover:bg-emerald-500/20 hover:text-emerald-500',
  neutral:
    'border-outline-variant/20 bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
};

function TicketDetailHeaderAction({
  icon,
  label,
  onClick,
  tone = 'neutral',
}: {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: keyof typeof TICKET_DETAIL_HEADER_ACTION_TONE;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-medium transition-colors md:w-auto md:px-3.5 md:gap-1.5 ${TICKET_DETAIL_HEADER_ACTION_TONE[tone]}`}
      aria-label={label}
    >
      <Icon name={icon} size={16} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// Status action buttons for admin
function StatusActions({ status, onUpdate }: { status: string; onUpdate: (s: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1.5 md:flex-wrap">
      {status === 'open' && (
        <TicketDetailHeaderAction
          icon="progress_activity"
          label={t('ticketDetail.actions.startProgress')}
          tone="info"
          onClick={() => onUpdate('in_progress')}
        />
      )}
      {status === 'in_progress' && (
        <TicketDetailHeaderAction
          icon="check_circle"
          label={t('ticketDetail.actions.markResolved')}
          tone="success"
          onClick={() => onUpdate('resolved')}
        />
      )}
      {status !== 'closed' && (
        <TicketDetailHeaderAction
          icon="close"
          label={t('ticketDetail.actions.closeTicket')}
          onClick={() => onUpdate('closed')}
        />
      )}
      {status === 'closed' && (
        <TicketDetailHeaderAction
          icon="restore"
          label={t('ticketDetail.actions.reopen')}
          onClick={() => onUpdate('open')}
        />
      )}
    </div>
  );
}

function TicketChatLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-[320px]">
      <PageRefreshIndicator label={t('ticketDetail.refreshing')} />
    </div>
  );
}

function ChatContent({ ticketId }: { ticketId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const currentUser = useAuthStore((state) => state.user);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { data: ticket } = useTicket(ticketId);
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);
  const classificationMap = new Map(business.ticketClassifications.map((item) => [item.value, item.label]));
  const { data: messages, mutate: mutateMessages } = useMessages(ticketId);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [pendingAttachmentName, setPendingAttachmentName] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = currentUser?.role === 'ADMIN' && location.pathname.startsWith('/admin/tickets');
  const visualViewportBottomOffset = useVisualViewportBottomOffset(!isDesktop);
  const dateLocale = i18n.resolvedLanguage || i18n.language;
  const quickReplyPhrases = t(isAdmin ? 'ticketDetail.quickReplies.admin' : 'ticketDetail.quickReplies.user', {
    returnObjects: true,
  }) as string[];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
    };
  }, [pendingImageUrl]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingImage) || sending || uploadingAttachment) return;
    setSending(true);
    try {
      await sendTicketMessage(ticketId, input.trim(), pendingImage || undefined);
      setInput('');
      setPendingImage(null);
      setPendingImageUrl(null);
      setPendingAttachmentName(null);
      mutateMessages();
    } catch (err) {
      notifyGlobalError(err, t('ticketDetail.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [input, sending, uploadingAttachment, ticketId, pendingImage, mutateMessages, t]);

  const handleQuickReply = useCallback((phrase: string) => {
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${phrase}` : phrase));
  }, []);

  const uploadComposerAttachment = useCallback(
    async (file: File | null | undefined, source: 'picker' | 'paste') => {
      if (!file) return;
      if (uploadingAttachment) {
        toast(t('ticketDetail.attachmentUploadingWait'), 'info');
        return;
      }
      if (pendingImage || pendingImageUrl || pendingAttachmentName) {
        toast(
          source === 'paste' ? t('ticketDetail.attachmentExistsPaste') : t('ticketDetail.attachmentExistsPicker'),
          'info',
        );
        return;
      }
      if (file.size > business.uploadPolicy.ticketAttachmentMaxSizeMb * 1024 * 1024) {
        toast(t('ticketDetail.attachmentTooLarge', { max: business.uploadPolicy.ticketAttachmentMaxSizeMb }), 'error');
        return;
      }
      const isImage = file.type.startsWith('image/');
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      try {
        setPendingImageUrl(previewUrl);
        setPendingAttachmentName(file.name);
        setUploadingAttachment(true);
        const { url } = await uploadTicketAttachment(ticketId, file);
        setPendingImage(url);
      } catch (err) {
        notifyGlobalError(err, t('ticketDetail.attachmentUploadFailed'));
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPendingImageUrl(null);
        setPendingAttachmentName(null);
        setPendingImage(null);
      } finally {
        setUploadingAttachment(false);
      }
    },
    [
      business.uploadPolicy.ticketAttachmentMaxSizeMb,
      pendingAttachmentName,
      pendingImage,
      pendingImageUrl,
      t,
      ticketId,
      toast,
      uploadingAttachment,
    ],
  );

  const handleImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      await uploadComposerAttachment(file, 'picker');
      e.target.value = '';
    },
    [uploadComposerAttachment],
  );

  const handleComposerPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const file = getClipboardImageFile(event.clipboardData);
      if (!file) return;
      if (!event.clipboardData.getData('text/plain')) {
        event.preventDefault();
      }
      void uploadComposerAttachment(file, 'paste');
    },
    [uploadComposerAttachment],
  );

  const handleStatusUpdate = useCallback(
    async (status: string) => {
      try {
        await updateTicketStatus(ticketId, status);
        toast(t('ticketDetail.statusUpdated'), 'success');
      } catch (err) {
        notifyGlobalError(err, t('ticketDetail.statusUpdateFailed'));
      }
    },
    [t, ticketId, toast],
  );

  if (!ticket) {
    return <TicketChatLoadingState />;
  }

  const info = statusInfo(business.ticketStatuses, ticket.status);
  const classificationLabel = classificationMap.get(ticket.classification) || ticket.classification;
  const metaSeparator = t('ticketDetail.metaSeparator');
  const ticketDescription = [
    formatDateTime(ticket.createdAt, dateLocale),
    classificationLabel,
    isAdmin
      ? ticket.user?.username || t('ticketDetail.unknownUser')
      : ticket.basePart
        ? t('ticketDetail.basePart', { part: ticket.basePart })
        : '',
  ]
    .filter(Boolean)
    .join(metaSeparator);
  const msgList = messages || [];
  const mobileComposerSafeSpace = pendingImageUrl || pendingAttachmentName ? '8.5rem' : '4.75rem';
  const composerBottomOffset = composerFocused ? visualViewportBottomOffset : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 md:px-0 md:pt-0">
        <AdminPageHero
          title={isAdmin ? t('ticketDetail.adminTitle') : t('ticketDetail.userTitle')}
          meta={getTicketCode(ticket.id)}
          description={t('ticketDetail.submittedAt', { detail: ticketDescription })}
          actions={
            <>
              <TicketDetailHeaderAction
                icon="arrow_back"
                label={t('ticketDetail.actions.back')}
                onClick={() => navigate(-1)}
              />
              <span
                className={`inline-flex h-9 shrink-0 items-center rounded-lg px-2.5 text-xs font-bold md:px-3 ${info.color || ''} ${info.bg || ''}`}
              >
                {info.label}
              </span>
              {isAdmin ? <StatusActions status={ticket.status} onUpdate={handleStatusUpdate} /> : null}
            </>
          }
        />
      </div>

      {/* Messages */}
      <div
        id="messages"
        className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-hidden"
        style={
          isDesktop
            ? undefined
            : {
                paddingBottom: `calc(${mobileComposerSafeSpace} + env(safe-area-inset-bottom, 0px) + ${composerBottomOffset}px)`,
              }
        }
      >
        <OriginalMessage ticket={ticket} />
        {msgList.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        className={`border-t border-outline-variant/10 bg-surface-container ${
          isDesktop
            ? 'shrink-0 p-3'
            : 'fixed inset-x-0 z-40 p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-10px_24px_rgba(15,23,42,0.08)]'
        }`}
        style={isDesktop ? undefined : { bottom: `${composerBottomOffset}px` }}
      >
        {pendingImageUrl || pendingAttachmentName ? (
          <div className="mb-2 relative inline-block">
            {pendingImageUrl ? (
              <SafeImage
                src={pendingImageUrl}
                alt={t('ticketDetail.pendingAttachment')}
                className={`${isDesktop ? 'h-20' : 'h-16'} rounded border border-outline-variant/20`}
              />
            ) : (
              <div className="flex max-w-xs items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-high px-3 py-2 text-xs text-on-surface-variant">
                <Icon name="attach_file" size={14} />
                <span className="truncate">{pendingAttachmentName}</span>
              </div>
            )}
            {uploadingAttachment ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                {t('ticketDetail.uploading')}
              </span>
            ) : null}
            <button
              onClick={() => {
                if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
                setPendingImage(null);
                setPendingImageUrl(null);
                setPendingAttachmentName(null);
                setUploadingAttachment(false);
              }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-error text-on-primary rounded-full flex items-center justify-center text-xs"
            >
              <Icon name="close" size={10} />
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleImageSelect} />
          <QuickReplyChips
            phrases={quickReplyPhrases}
            onPick={handleQuickReply}
            title={isAdmin ? t('ticketDetail.quickReplyAdminTitle') : t('ticketDetail.quickReplyUserTitle')}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handleComposerPaste}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isDesktop ? t('ticketDetail.replyPlaceholderDesktop') : t('ticketDetail.replyPlaceholderMobile')
            }
            rows={1}
            className={`flex-1 resize-none bg-surface-container-high border border-outline-variant/20 rounded-lg text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors max-h-28 ${isDesktop ? 'px-3 py-2.5 text-sm' : 'px-2.5 py-2 text-xs'}`}
            style={{ minHeight: isDesktop ? '40px' : '34px' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAttachment}
            aria-label={t('ticketDetail.uploadImage')}
            className={`shrink-0 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest transition-colors ${isDesktop ? 'w-10 h-10' : 'w-9 h-9'}`}
          >
            <Icon name="image" size={isDesktop ? 18 : 16} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAttachment}
            aria-label={t('ticketDetail.uploadAttachment')}
            className={`shrink-0 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest transition-colors ${isDesktop ? 'w-10 h-10' : 'w-9 h-9'}`}
          >
            <Icon name="attachment" size={isDesktop ? 18 : 16} />
          </button>
          <button
            onClick={handleSend}
            disabled={(!input.trim() && !pendingImage) || sending || uploadingAttachment}
            className={`shrink-0 flex items-center justify-center text-on-primary bg-primary-container rounded-lg hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${isDesktop ? 'gap-1.5 px-4 py-2.5 text-sm font-medium' : 'w-9 h-9'}`}
            aria-label={t('ticketDetail.send')}
          >
            <Icon name="send" size={isDesktop ? 14 : 16} />
            {isDesktop && t('ticketDetail.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TicketDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  useDocumentTitle(t('ticketDetail.documentTitle'));

  if (!id) return null;

  const isAdminRoute = location.pathname.startsWith('/admin/tickets');

  if (!isAdminRoute) {
    return (
      <AdminPageShell
        desktopContentClassName="overflow-hidden"
        mobileMainClassName="overflow-hidden"
        mobileContentClassName="h-full !p-0"
        hideMobileBottomNav
      >
        <ChatContent ticketId={id} />
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
      <ChatContent ticketId={id} />
    </AdminPageShell>
  );
}
