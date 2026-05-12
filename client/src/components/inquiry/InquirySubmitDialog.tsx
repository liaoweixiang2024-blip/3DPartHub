import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { createInquiry } from '../../api/inquiries';
import { getErrorMessage } from '../../lib/errorNotifications';
import type { InquiryCartItem } from '../../lib/inquiryCart';
import { useAuthStore } from '../../stores/useAuthStore';
import Icon from '../shared/Icon';

type ItemState = {
  qty: number;
  remark: string;
};

type ContactTemplate = {
  company: string;
  contactName: string;
  contactPhone: string;
  contactAddress: string;
};

function templateStorageKey(userId?: string) {
  return userId ? `inquiry-contact-template:${userId}` : 'inquiry-contact-template';
}

function readStoredTemplate(userId?: string): Partial<ContactTemplate> {
  try {
    const raw = window.localStorage.getItem(templateStorageKey(userId));
    return raw ? (JSON.parse(raw) as Partial<ContactTemplate>) : {};
  } catch {
    return {};
  }
}

function writeStoredTemplate(userId: string | undefined, template: ContactTemplate) {
  try {
    window.localStorage.setItem(templateStorageKey(userId), JSON.stringify(template));
  } catch {
    // Local persistence is a convenience; profile save remains the source of truth.
  }
}

function normalizeTemplate(template: ContactTemplate): ContactTemplate {
  return {
    company: template.company.trim(),
    contactName: template.contactName.trim(),
    contactPhone: template.contactPhone.trim(),
    contactAddress: template.contactAddress.trim(),
  };
}

function getMissingContactFields(template: ContactTemplate) {
  const contact = normalizeTemplate(template);
  return [
    !contact.contactName ? '联系人' : '',
    !contact.contactPhone ? '联系电话' : '',
    !contact.contactAddress ? '联系地址' : '',
  ].filter(Boolean);
}

function isContactReady(template: ContactTemplate) {
  return getMissingContactFields(template).length === 0;
}

function getItemTitle(item: InquiryCartItem) {
  if (item.modelNo && item.productName && item.productName !== item.modelNo) {
    return `${item.modelNo} · ${item.productName}`;
  }
  return item.modelNo || item.productName;
}

function specSummary(specs?: Record<string, string> | null) {
  return Object.entries(specs || {})
    .filter(([, value]) => value && value !== '—')
    .slice(0, 3)
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
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

export default function InquirySubmitDialog({
  open,
  onClose,
  items,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  items: InquiryCartItem[];
  onSubmitted?: () => void;
}) {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [remark, setRemark] = useState('');
  const [company, setCompany] = useState(user?.company || '');
  const [contactName, setContactName] = useState(user?.username || '');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactAddress, setContactAddress] = useState(user?.address || '');
  const [contactEditing, setContactEditing] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const visualViewportBottomOffset = useVisualViewportBottomOffset(open);

  useEffect(() => {
    if (!open) return;
    setItemStates((prev) => {
      const next: Record<string, ItemState> = {};
      items.forEach((item) => {
        next[item.id] = prev[item.id] || { qty: item.qty || 1, remark: item.remark || '' };
      });
      return next;
    });
  }, [items, open]);

  useEffect(() => {
    if (!open) return;
    const stored = readStoredTemplate(user?.id);
    const next = {
      company: user?.company || stored.company || '',
      contactName: stored.contactName || user?.username || '',
      contactPhone: user?.phone || stored.contactPhone || '',
      contactAddress: user?.address || stored.contactAddress || '',
    };
    setCompany(next.company);
    setContactName(next.contactName);
    setContactPhone(next.contactPhone);
    setContactAddress(next.contactAddress);
    setContactEditing(!isContactReady(next));
    setError('');
  }, [open, user?.address, user?.company, user?.id, user?.phone, user?.username]);

  if (!open) return null;

  const getItem = (id: string): ItemState => itemStates[id] || { qty: 1, remark: '' };
  const updateItem = (id: string, patch: Partial<ItemState>) =>
    setItemStates((prev) => ({ ...prev, [id]: { ...(prev[id] || { qty: 1, remark: '' }), ...patch } }));
  const contactTemplate = { company, contactName, contactPhone, contactAddress };
  const contactReady = isContactReady(contactTemplate);
  const missingContactFields = getMissingContactFields(contactTemplate);

  function validateContactTemplate() {
    const template = normalizeTemplate(contactTemplate);
    const missing = getMissingContactFields(template);
    if (missing.length > 0) {
      setContactEditing(true);
      setError(`请先完善${missing.join('、')}，便于业务人员有效联系和确认需求。`);
      return null;
    }
    return template;
  }

  async function saveContactTemplate() {
    const template = validateContactTemplate();
    if (!template) return null;
    setSavingContact(true);
    setError('');
    try {
      if (user) {
        await authApi.updateProfile({
          company: template.company,
          phone: template.contactPhone,
          address: template.contactAddress,
        });
        updateUser({
          company: template.company,
          phone: template.contactPhone,
          address: template.contactAddress,
        });
      }
      writeStoredTemplate(user?.id, template);
      setCompany(template.company);
      setContactName(template.contactName);
      setContactPhone(template.contactPhone);
      setContactAddress(template.contactAddress);
      setContactEditing(false);
      return template;
    } catch (err) {
      setError(getErrorMessage(err, '保存联系信息失败'));
      return null;
    } finally {
      setSavingContact(false);
    }
  }

  const submit = async () => {
    if (!items.length || submitting || savingContact) return;
    let finalContact = validateContactTemplate();
    if (!finalContact) return;
    setSubmitting(true);
    setError('');
    try {
      if (contactEditing) {
        const saved = await saveContactTemplate();
        if (!saved) return;
        finalContact = saved;
      }
      const inquiry = await createInquiry({
        items: items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          modelNo: item.modelNo || undefined,
          specs: item.specs || undefined,
          unit: item.unit || undefined,
          qty: getItem(item.id).qty,
          remark: getItem(item.id).remark || undefined,
        })),
        remark: remark || undefined,
        company: finalContact.company || undefined,
        contactName: finalContact.contactName,
        contactPhone: finalContact.contactPhone,
        contactAddress: finalContact.contactAddress,
      });
      onSubmitted?.();
      navigate(`/my-inquiries/${inquiry.id}`);
    } catch (err) {
      setError(getErrorMessage(err, '提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] overflow-hidden bg-surface-container-low p-0 md:flex md:items-center md:justify-center md:bg-black/40 md:p-4 md:backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inquiry-submit-dialog-title"
      onClick={onClose}
    >
      <div
        className="fixed inset-x-0 top-0 bottom-[var(--inquiry-dialog-viewport-bottom,0px)] flex min-h-0 w-full flex-col bg-surface-container-low shadow-none md:relative md:inset-auto md:max-h-[85vh] md:w-full md:max-w-xl md:overflow-hidden md:rounded-2xl md:border md:border-outline-variant/20 md:shadow-2xl"
        style={
          {
            '--inquiry-dialog-viewport-bottom': `${visualViewportBottomOffset}px`,
          } as CSSProperties
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-outline-variant/10 px-4 pb-3 pt-[max(0.875rem,env(safe-area-inset-top,0px))] md:px-5 md:py-4">
          <div>
            <h3 id="inquiry-submit-dialog-title" className="text-base font-bold text-on-surface">
              提交询价单
            </h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">共 {items.length} 个待询价产品</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭提交询价弹窗"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 md:space-y-4 md:px-5 md:py-4">
          <div className="overflow-hidden rounded-lg border border-outline-variant/12 bg-surface-container-lowest">
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Icon name="inventory_2" size={14} className="text-primary-container" />
                <p className="text-xs font-semibold text-on-surface md:text-sm">询价产品</p>
                <span className="rounded-md bg-primary-container/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary-container">
                  {items.length} 项
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed text-xs">
                <thead className="border-b border-outline-variant/10 text-[11px] text-on-surface-variant">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold">产品</th>
                    <th className="w-24 px-3 py-2.5 text-right font-semibold">数量</th>
                    <th className="w-40 px-3 py-2.5 text-left font-semibold">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {items.map((item) => {
                    const state = getItem(item.id);
                    const summary = specSummary(item.specs);
                    return (
                      <tr key={item.id} className="align-middle">
                        <td className="px-3 py-2">
                          <p className="break-words text-xs font-medium text-on-surface md:text-[13px]">
                            {getItemTitle(item)}
                          </p>
                          {summary ? (
                            <p className="mt-0.5 break-words text-[11px] text-on-surface-variant/65">{summary}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            aria-label={`${getItemTitle(item)} 数量`}
                            type="number"
                            min={1}
                            value={state.qty}
                            onChange={(event) =>
                              updateItem(item.id, { qty: Math.max(1, parseInt(event.target.value) || 1) })
                            }
                            className="h-8 w-16 rounded-md border border-outline-variant/20 bg-surface-container px-2 text-center text-xs text-on-surface outline-none focus:border-primary-container"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={state.remark}
                            onChange={(event) => updateItem(item.id, { remark: event.target.value })}
                            placeholder="备注（选填）"
                            className="h-8 w-full rounded-md border border-outline-variant/20 bg-surface-container px-2 text-xs text-on-surface outline-none focus:border-primary-container"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/12 bg-surface-container-lowest">
            <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 px-3 py-2.5">
              <div>
                <p className="text-sm font-bold text-on-surface">联系信息模板</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {contactReady ? '提交时自动使用，可随时编辑。' : '请先完善后再提交询价。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContactEditing((value) => !value)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-outline-variant/20 px-2.5 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name={contactEditing ? 'expand_less' : 'edit'} size={13} />
                {contactEditing ? '收起' : '编辑'}
              </button>
            </div>

            {!contactReady && (
              <div className="mx-3 mt-3 rounded-lg border border-error/20 bg-error-container/10 px-3 py-2 text-xs leading-relaxed text-error">
                缺少 {missingContactFields.join('、')}，完善后会保存为下次询价的默认联系信息。
              </div>
            )}

            {contactEditing ? (
              <div className="grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-on-surface-variant">公司名称（选填）</label>
                  <input
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    placeholder="公司或部门名称"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-on-surface-variant">联系人</label>
                  <input
                    value={contactName}
                    onChange={(event) => setContactName(event.target.value)}
                    placeholder="例如 张工"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-on-surface-variant">联系电话</label>
                  <input
                    value={contactPhone}
                    onChange={(event) => setContactPhone(event.target.value)}
                    placeholder="手机号或座机"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-on-surface-variant">联系地址</label>
                  <input
                    value={contactAddress}
                    onChange={(event) => setContactAddress(event.target.value)}
                    placeholder="用于业务对接和交付确认"
                    className="w-full rounded-lg border border-outline-variant/20 bg-surface-container px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 sm:col-span-2">
                  {contactReady ? (
                    <button
                      type="button"
                      onClick={() => setContactEditing(false)}
                      className="rounded-lg px-3 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                    >
                      取消
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={saveContactTemplate}
                    disabled={savingContact || submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-container px-3 py-2 text-xs font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {savingContact ? <Icon name="progress_activity" size={13} className="animate-spin" /> : null}
                    保存为默认信息
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <span className="block text-xs text-on-surface-variant">联系人</span>
                  <span className="block truncate font-medium text-on-surface">{contactName || '未填写'}</span>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <span className="block text-xs text-on-surface-variant">联系电话</span>
                  <span className="block truncate font-medium text-on-surface">{contactPhone || '未填写'}</span>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <span className="block text-xs text-on-surface-variant">公司名称</span>
                  <span className="block truncate font-medium text-on-surface">{company || '未填写'}</span>
                </div>
                <div className="rounded-lg bg-surface-container px-3 py-2">
                  <span className="block text-xs text-on-surface-variant">联系地址</span>
                  <span className="block truncate font-medium text-on-surface">{contactAddress || '未填写'}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-on-surface-variant">整体备注</label>
            <textarea
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              rows={2}
              placeholder="选填：交期要求、包装要求等"
              className="w-full resize-none rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-container"
            />
          </div>

          {error ? <p className="text-xs text-error">{error}</p> : null}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-outline-variant/10 bg-surface-container-low px-4 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] pt-3 md:px-5 md:py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-outline-variant/40 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high/50"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting || savingContact || items.length === 0}
            className="flex-1 rounded-xl bg-primary-container py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting
              ? '提交中...'
              : !contactReady
                ? '先完善联系信息'
                : contactEditing
                  ? '保存并提交询价'
                  : '提交询价'}
          </button>
        </div>
      </div>
    </div>
  );
}
