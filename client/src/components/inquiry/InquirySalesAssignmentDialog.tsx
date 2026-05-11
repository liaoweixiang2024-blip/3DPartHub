import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  assignInquirySales,
  getInquirySalesCandidates,
  type Inquiry,
  type InquirySalesAssignmentParams,
} from '../../api/inquiries';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

type AssignmentMode = InquirySalesAssignmentParams['mode'];

const MODES: Array<{ value: AssignmentMode; label: string; desc: string; icon: string }> = [
  { value: 'manual', label: '手动指定', desc: '明确指定某个业务对接人。', icon: 'person' },
  { value: 'default', label: '默认负责人', desc: '使用系统默认业务负责人。', icon: 'badge' },
  { value: 'auto', label: '自动分配', desc: '按当前跟进量自动选择较空闲人员。', icon: 'sync' },
  { value: 'region', label: '按区域', desc: '按客户区域辅助匹配业务人员。', icon: 'compass' },
  { value: 'channel', label: '按交易方式', desc: '区分线上/线下交易后再转交。', icon: 'compare_arrows' },
];

function modeTemplate(mode: AssignmentMode, channel: string, region: string) {
  if (mode === 'auto') return '系统按当前跟进量自动分配，请核对客户需求并继续对接报价。';
  if (mode === 'default') return '按默认负责人转交，请继续跟进客户询价需求。';
  if (mode === 'region') return `按区域${region ? `「${region}」` : ''}转交，请结合客户所在地安排后续对接。`;
  if (mode === 'channel') {
    return `${channel === 'offline' ? '线下交易' : '线上交易'}场景转交，请按对应业务流程继续跟进。`;
  }
  return '请继续跟进客户询价需求，确认报价、交期和后续对接方式。';
}

function modeLabel(mode?: string | null) {
  return MODES.find((item) => item.value === mode)?.label || '手动指定';
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
    setHandoffNote(inquiry.salesHandoffNote || modeTemplate(nextMode, nextChannel, nextRegion));
  }, [inquiry, open]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === assigneeId),
    [assigneeId, candidates],
  );

  if (!open || !inquiry) return null;

  async function handleSubmit() {
    if (!inquiry) return;
    if (mode === 'manual' && !assigneeId) {
      toast('请选择业务对接人', 'error');
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
      toast('已转交销售跟进', 'success');
      onAssigned(updated);
      onClose();
    } catch (err: any) {
      toast(err?.response?.data?.detail || err?.message || '转交销售失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant/12 px-4 py-4 md:px-5">
          <div className="min-w-0">
            <p className="text-base font-bold text-on-surface">转交销售跟进</p>
            <p className="mt-1 text-xs text-on-surface-variant">
              选择分配模式和对接人，客户将在询价详情里看到跟进进度与业务联系方式。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
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
                    setHandoffNote(modeTemplate(item.value, channel, region));
                  }}
                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-primary-container bg-primary-container/10 text-on-surface'
                      : 'border-outline-variant/15 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  <span className="mb-2 flex items-center gap-1.5 text-xs font-bold">
                    <Icon name={item.icon} size={14} />
                    {item.label}
                  </span>
                  <span className="block text-[11px] leading-relaxed">{item.desc}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-on-surface-variant">业务对接人</span>
                <select
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  disabled={isLoading}
                  className="h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary-container"
                >
                  <option value="">{mode === 'manual' ? '请选择对接人' : '由系统选择或手动指定'}</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.username}
                      {candidate.department ? ` / ${candidate.department}` : ''}
                      {candidate.role ? ` / ${candidate.role}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-on-surface-variant">客户区域</span>
                  <input
                    value={region}
                    onChange={(event) => {
                      setRegion(event.target.value);
                      if (mode === 'region') setHandoffNote(modeTemplate(mode, channel, event.target.value));
                    }}
                    placeholder="例如：华东 / 上海 / 广东"
                    className="h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary-container"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-on-surface-variant">交易方式</span>
                  <select
                    value={channel}
                    onChange={(event) => {
                      const next = event.target.value as 'online' | 'offline';
                      setChannel(next);
                      if (mode === 'channel') setHandoffNote(modeTemplate(mode, next, region));
                    }}
                    className="h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 text-sm text-on-surface outline-none focus:border-primary-container"
                  >
                    <option value="offline">线下交易</option>
                    <option value="online">线上交易</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-on-surface-variant">交接说明模板</span>
                <textarea
                  value={handoffNote}
                  onChange={(event) => setHandoffNote(event.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm leading-relaxed text-on-surface outline-none focus:border-primary-container"
                />
              </label>
            </div>

            <aside className="rounded-xl border border-outline-variant/12 bg-surface-container-low p-3">
              <p className="text-xs font-bold text-on-surface">当前分配</p>
              <div className="mt-3 space-y-2 text-xs text-on-surface-variant">
                <p>
                  模式：<span className="font-semibold text-on-surface">{modeLabel(mode)}</span>
                </p>
                <p>
                  对接人：
                  <span className="font-semibold text-on-surface">
                    {selectedCandidate?.username || (mode === 'manual' ? '未选择' : '系统自动选择')}
                  </span>
                </p>
                <p>区域：{region || '未填写'}</p>
                <p>方式：{channel === 'offline' ? '线下交易' : '线上交易'}</p>
              </div>
              {selectedCandidate ? (
                <div className="mt-3 rounded-lg bg-surface-container-high p-3 text-xs text-on-surface-variant">
                  <p className="font-semibold text-on-surface">{selectedCandidate.username}</p>
                  <p className="mt-1">{selectedCandidate.department || selectedCandidate.company || '未设置部门'}</p>
                  <p className="mt-1">{selectedCandidate.phone || selectedCandidate.email || '未设置联系方式'}</p>
                </div>
              ) : null}
            </aside>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-outline-variant/12 px-4 py-3 md:px-5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-outline-variant/20 px-4 text-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-container px-4 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Icon name="send" size={14} />
            {submitting ? '转交中...' : '确认转交'}
          </button>
        </div>
      </div>
    </div>
  );
}
