import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import {
  assignInquirySales,
  getInquirySalesCandidates,
  type Inquiry,
  type InquirySalesAssignmentParams,
} from '../../api/inquiries';
import { AdminButton, AdminIconButton } from '../shared/AdminControls';
import { APP_FIELD_LABEL_CLASS, AppSelect, AppTextArea, AppTextInput } from '../shared/FormControls';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

type AssignmentMode = InquirySalesAssignmentParams['mode'];

const MODES: Array<{ value: AssignmentMode; labelKey: string; descKey: string; icon: string }> = [
  {
    value: 'manual',
    labelKey: 'inquiryAdminPage.modeManual',
    descKey: 'inquiryAdminPage.modeManualDesc',
    icon: 'person',
  },
  {
    value: 'default',
    labelKey: 'inquiryAdminPage.modeDefault',
    descKey: 'inquiryAdminPage.modeDefaultDesc',
    icon: 'badge',
  },
  {
    value: 'auto',
    labelKey: 'inquiryAdminPage.modeAuto',
    descKey: 'inquiryAdminPage.modeAutoDesc',
    icon: 'sync',
  },
  {
    value: 'region',
    labelKey: 'inquiryAdminPage.modeRegion',
    descKey: 'inquiryAdminPage.modeRegionDesc',
    icon: 'compass',
  },
  {
    value: 'channel',
    labelKey: 'inquiryAdminPage.modeChannel',
    descKey: 'inquiryAdminPage.modeChannelDesc',
    icon: 'compare_arrows',
  },
];

function modeTemplate(t: TFunction, mode: AssignmentMode, channel: string, region: string) {
  if (mode === 'auto') return t('inquiryAdminPage.templateAuto');
  if (mode === 'default') return t('inquiryAdminPage.templateDefault');
  if (mode === 'region') return t('inquiryAdminPage.templateRegion', { region: region ? `「${region}」` : '' });
  if (mode === 'channel') {
    return t('inquiryAdminPage.templateChannel', {
      channel: channel === 'offline' ? t('inquiryAdminPage.channelOffline') : t('inquiryAdminPage.channelOnline'),
    });
  }
  return t('inquiryAdminPage.templateManual');
}

function modeLabel(t: TFunction, mode?: string | null) {
  const key = MODES.find((item) => item.value === mode)?.labelKey || 'inquiryAdminPage.modeManual';
  return t(key);
}

interface InquirySalesAssignmentDialogProps {
  open: boolean;
  inquiry: Inquiry | null;
  onClose: () => void;
  onAssigned: (inquiry: Inquiry) => void;
}

export default function InquirySalesAssignmentDialog({
  open,
  inquiry,
  onClose,
  onAssigned,
}: InquirySalesAssignmentDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: candidates = [], isLoading } = useSWR(
    open ? 'inquiry-sales-candidates' : null,
    getInquirySalesCandidates,
  );
  const [mode, setMode] = useState<AssignmentMode>('manual');
  const [assigneeId, setAssigneeId] = useState('');
  const [channel, setChannel] = useState<'online' | 'offline'>('offline');
  const [region, setRegion] = useState('');
  const [handoffNote, setHandoffNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !inquiry) return;
    const nextMode = (inquiry.salesMode as AssignmentMode) || 'manual';
    const nextChannel = inquiry.salesChannel === 'online' ? 'online' : 'offline';
    const nextRegion = inquiry.salesRegion || '';
    setMode(nextMode);
    setAssigneeId(inquiry.salesAssigneeId || '');
    setChannel(nextChannel);
    setRegion(nextRegion);
    setHandoffNote(inquiry.salesHandoffNote || modeTemplate(t, nextMode, nextChannel, nextRegion));
  }, [inquiry, open, t]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === assigneeId),
    [assigneeId, candidates],
  );

  if (!open || !inquiry) return null;

  async function handleSubmit() {
    if (!inquiry) return;
    if (mode === 'manual' && !assigneeId) {
      toast(t('inquiryAdminPage.selectAssigneeError'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await assignInquirySales(inquiry.id, {
        mode,
        assigneeId: assigneeId || undefined,
        channel: mode === 'channel' ? channel : '',
        region,
        handoffNote,
      });
      toast(t('inquiryAdminPage.assignedToast'), 'success');
      onAssigned(updated);
      onClose();
    } catch (err: unknown) {
      const resp = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).response : undefined;
      const data = typeof resp === 'object' && resp !== null ? (resp as Record<string, unknown>).data : undefined;
      const detail = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).detail : undefined;
      const errMsg = err instanceof Error ? err.message : t('inquiryAdminPage.assignFail');
      toast(String(detail) || errMsg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant/12 px-4 py-4 md:px-5">
          <div className="min-w-0">
            <p className="text-base font-bold text-on-surface">{t('inquiryAdminPage.dialogTitle')}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{t('inquiryAdminPage.dialogDesc')}</p>
          </div>
          <AdminIconButton icon="close" onClick={onClose} variant="ghost" aria-label={t('common.close')} />
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4 md:px-5">
          <div className="grid gap-2 md:grid-cols-5">
            {MODES.map((item) => {
              const active = mode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setMode(item.value);
                    setHandoffNote(modeTemplate(t, item.value, channel, region));
                  }}
                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-primary-container bg-primary-container/10 text-on-surface'
                      : 'border-outline-variant/15 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  <span className="mb-2 flex items-center gap-1.5 text-xs font-bold">
                    <Icon name={item.icon} size={14} />
                    {t(item.labelKey)}
                  </span>
                  <span className="block text-[11px] leading-relaxed">{t(item.descKey)}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-3">
              <label className="block">
                <span className={APP_FIELD_LABEL_CLASS}>{t('inquiryAdminPage.labelAssignee')}</span>
                <AppSelect
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  disabled={isLoading}
                >
                  <option value="">
                    {mode === 'manual'
                      ? t('inquiryAdminPage.selectPlaceholderManual')
                      : t('inquiryAdminPage.selectPlaceholderAuto')}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.username}
                      {candidate.department ? ` / ${candidate.department}` : ''}
                      {candidate.role ? ` / ${candidate.role}` : ''}
                    </option>
                  ))}
                </AppSelect>
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className={APP_FIELD_LABEL_CLASS}>{t('inquiryAdminPage.labelRegion')}</span>
                  <AppTextInput
                    value={region}
                    onChange={(event) => {
                      setRegion(event.target.value);
                      if (mode === 'region') setHandoffNote(modeTemplate(t, mode, channel, event.target.value));
                    }}
                    placeholder={t('inquiryAdminPage.regionPlaceholder')}
                  />
                </label>
                <label className="block">
                  <span className={APP_FIELD_LABEL_CLASS}>{t('inquiryAdminPage.labelChannel')}</span>
                  <AppSelect
                    value={channel}
                    onChange={(event) => {
                      const next = event.target.value as 'online' | 'offline';
                      setChannel(next);
                      if (mode === 'channel') setHandoffNote(modeTemplate(t, mode, next, region));
                    }}
                  >
                    <option value="offline">{t('inquiryAdminPage.channelOffline')}</option>
                    <option value="online">{t('inquiryAdminPage.channelOnline')}</option>
                  </AppSelect>
                </label>
              </div>

              <label className="block">
                <span className={APP_FIELD_LABEL_CLASS}>{t('inquiryAdminPage.labelNote')}</span>
                <AppTextArea
                  value={handoffNote}
                  onChange={(event) => setHandoffNote(event.target.value)}
                  rows={4}
                  className="resize-none leading-relaxed"
                />
              </label>
            </div>

            <aside className="rounded-xl border border-outline-variant/12 bg-surface-container-low p-3">
              <p className="text-xs font-bold text-on-surface">{t('inquiryAdminPage.currentTitle')}</p>
              <div className="mt-3 space-y-2 text-xs text-on-surface-variant">
                <p>
                  {t('inquiryAdminPage.modeLabel')}：
                  <span className="font-semibold text-on-surface">{modeLabel(t, mode)}</span>
                </p>
                <p>
                  {t('inquiryAdminPage.assigneeLabel')}：
                  <span className="font-semibold text-on-surface">
                    {selectedCandidate?.username ||
                      (mode === 'manual' ? t('inquiryAdminPage.notSelected') : t('inquiryAdminPage.systemAuto'))}
                  </span>
                </p>
                <p>
                  {t('inquiryAdminPage.regionLabel')}：{region || t('inquiryAdminPage.noRegion')}
                </p>
                <p>
                  {t('inquiryAdminPage.channelLabel')}：
                  {channel === 'offline' ? t('inquiryAdminPage.channelOffline') : t('inquiryAdminPage.channelOnline')}
                </p>
              </div>
              {selectedCandidate ? (
                <div className="mt-3 rounded-lg bg-surface-container-high p-3 text-xs text-on-surface-variant">
                  <p className="font-semibold text-on-surface">{selectedCandidate.username}</p>
                  <p className="mt-1">
                    {selectedCandidate.department || selectedCandidate.company || t('inquiryAdminPage.noDept')}
                  </p>
                  <p className="mt-1">
                    {selectedCandidate.phone || selectedCandidate.email || t('inquiryAdminPage.noContact')}
                  </p>
                </div>
              ) : null}
            </aside>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-outline-variant/12 px-4 py-3 md:px-5">
          <AdminButton onClick={onClose} variant="secondary">
            {t('common.cancel')}
          </AdminButton>
          <AdminButton onClick={handleSubmit} disabled={submitting} icon="send" variant="primary">
            {submitting ? t('inquiryAdminPage.submitting') : t('inquiryAdminPage.confirmTransfer')}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
