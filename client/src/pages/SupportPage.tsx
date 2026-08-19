import { motion, AnimatePresence } from 'framer-motion';
import type { TFunction } from 'i18next';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import client from '../api/client';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getBusinessConfig } from '../lib/businessConfig';
import { notifyGlobalError } from '../lib/errorNotifications';
import { usePublicSettings } from '../lib/publicSettings';

/* ── Context passed via navigate(state) ── */
interface SupportContext {
  modelNo?: string;
  modelName?: string;
  searchQuery?: string;
  sourceUrl?: string;
  classification?: string;
  description?: string;
  specs?: Record<string, string>;
  source?: 'selection' | 'model' | 'model_search';
}

// 与后端 cleanTicketSourceUrl 同口径：仅接受站内白名单相对路径
function isSafeSourceUrl(value?: string): value is string {
  if (!value) return false;
  return value.startsWith('/model/') || value.startsWith('/selection') || value.startsWith('/?q=');
}

function useContextState(): { basePart: string; ctx: SupportContext | null } {
  const location = useLocation();
  const ctx = (location.state as SupportContext) || {};
  const hasCtx = ctx.modelNo || ctx.modelName || ctx.searchQuery || ctx.description;
  return {
    basePart: ctx.modelNo || ctx.modelName || ctx.searchQuery || '',
    ctx: hasCtx ? ctx : null,
  };
}

const DEFAULT_TICKET_CLASSIFICATION_KEYS = new Set(['dimension', 'material', 'novel', 'topology']);

function getTicketClassificationCopy(
  value: string,
  fallback: { label: string; desc: string },
  t: TFunction,
): { label: string; desc: string } {
  if (!DEFAULT_TICKET_CLASSIFICATION_KEYS.has(value)) return fallback;
  return {
    label: t(`ticketClassification.${value}.label`),
    desc: t(`ticketClassification.${value}.desc`),
  };
}

function getSupportStepCopy(step: { icon: string; title: string; desc: string }, t: TFunction) {
  const stepKey = step.icon.replace(/[^a-z0-9_]/gi, '');
  const title = t(`supportSteps.${stepKey}.title`, { defaultValue: step.title });
  const desc = t(`supportSteps.${stepKey}.desc`, { defaultValue: step.desc });
  return { title, desc };
}

function buildContextSuffix(ctx: SupportContext, t: TFunction): string {
  let suffix = '';
  if (ctx.source === 'model' && ctx.modelName) suffix += `${t('support.contextLine.model', { name: ctx.modelName })}\n`;
  if (ctx.source === 'selection' && ctx.modelNo) {
    suffix += `${t('support.contextLine.selection', { modelNo: ctx.modelNo })}\n`;
  }
  if (ctx.source === 'model_search' && ctx.searchQuery) {
    suffix += `${t('support.contextLine.model_search', { query: ctx.searchQuery })}\n`;
  }
  if (ctx.specs && Object.keys(ctx.specs).length > 0) {
    const lines = Object.entries(ctx.specs)
      .filter(([, v]) => v && v !== '—')
      .map(([k, v]) => `${k}: ${v}`);
    if (lines.length) suffix += `${t('support.contextLine.specs')}\n${lines.join('\n')}\n`;
  }
  return suffix;
}

function SupportHeaderAction({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();

  return (
    <Link
      to="/my-tickets"
      className={`inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface ${
        compact ? 'w-9' : 'gap-1.5 px-3.5'
      }`}
      aria-label={t('support.myTickets')}
    >
      <Icon name="schedule" size={16} />
      {compact ? null : <span>{t('support.myTickets')}</span>}
    </Link>
  );
}

/** Read-only context card shown above the form */
function ContextCard({ ctx }: { ctx: SupportContext }) {
  const { t } = useTranslation();
  const label =
    ctx.source === 'model_search'
      ? t('support.contextLabel.model_search')
      : ctx.source === 'model'
        ? t('support.contextLabel.model')
        : ctx.source === 'selection'
          ? t('support.contextLabel.selection')
          : t('support.contextLabel.unknown');
  const name = ctx.modelName || ctx.modelNo || ctx.searchQuery || '';
  const specEntries = Object.entries(ctx.specs || {}).filter(([, v]) => v && v !== '—');
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg bg-primary-container/8 border border-primary-container/15">
      <Icon name="link" size={14} className="text-primary-container shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-primary-container break-all">
          {label}：{name}
        </p>
        {specEntries.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {specEntries.slice(0, 6).map(([k, v]) => (
              <span key={k} className="text-[11px] text-on-surface-variant break-words">
                {k}: {v}
              </span>
            ))}
            {specEntries.length > 6 && (
              <span className="text-[11px] text-on-surface-variant">
                {t('support.moreSpecs', { count: specEntries.length - 6 })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopContent() {
  const { t } = useTranslation();
  const { basePart: initBasePart, ctx } = useContextState();
  const [formData, setFormData] = useState({
    basePart: initBasePart,
    classification: ctx?.classification || '',
    description: ctx?.description || '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!formData.classification) {
      toast(t('support.errorCategoryRequired'), 'error');
      return;
    }
    if (!formData.description.trim()) {
      toast(t('support.errorDescriptionRequired'), 'error');
      return;
    }
    setSubmitting(true);
    const suffix = ctx ? buildContextSuffix(ctx, t) : '';
    try {
      await client.post('/tasks', {
        basePart: formData.basePart || undefined,
        sourceUrl: isSafeSourceUrl(ctx?.sourceUrl) ? ctx.sourceUrl : undefined,
        classification: formData.classification,
        description: formData.description + (suffix ? `\n\n${suffix}` : ''),
      });
      setSubmitted(true);
      toast(t('support.toastSubmitSuccess'), 'success');
      setFormData({ basePart: '', classification: '', description: '' });
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      notifyGlobalError(err, t('support.toastSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminManagementPage
      title={t('support.title')}
      meta={t('support.meta')}
      description={t('support.description')}
      actions={<SupportHeaderAction />}
      className="app-public-tool-page app-public-tool-page-support mx-auto w-full max-w-6xl"
      contentClassName="gap-8"
    >
      {/* Process Steps */}
      <div className="grid grid-cols-4 gap-4">
        {business.supportProcessSteps.map((step, i) => {
          const stepCopy = getSupportStepCopy(step, t);
          return (
            <div
              key={step.title}
              className="flex items-center gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant/10"
            >
              <div className="w-10 h-10 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary-container">{i + 1}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface truncate">{stepCopy.title}</p>
                <p className="text-[11px] text-on-surface-variant truncate">{stepCopy.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-10 flex flex-col items-center justify-center text-center"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
              <Icon name="check_circle" size={32} className="text-emerald-400" />
            </div>
            <h3 className="font-headline text-xl font-bold text-on-surface mb-2">{t('support.successTitle')}</h3>
            <p className="text-sm text-on-surface-variant mb-6">{t('support.successDescription')}</p>
            <Link
              to="/my-tickets"
              className="px-6 py-2.5 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:opacity-90"
            >
              {t('support.successAction')}
            </Link>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            {/* Form */}
            <div className="lg:col-span-2">
              <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-8">
                <h3 className="font-headline text-lg font-bold text-on-surface mb-6 flex items-center gap-2">
                  <Icon name="assignment_add" size={20} className="text-primary-container" />
                  {t('supportSteps.assignment_add.title')}
                </h3>
                {ctx && (
                  <div className="mb-5">
                    <ContextCard ctx={ctx} />
                  </div>
                )}

                <div className="space-y-6">
                  {/* Classification cards */}
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-3">
                      {t('support.requestCategory')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {business.ticketClassifications.map((c) => {
                        const classificationCopy = getTicketClassificationCopy(c.value, c, t);
                        return (
                          <button
                            key={c.value}
                            onClick={() => setFormData((prev) => ({ ...prev, classification: c.value }))}
                            className={`text-left p-4 rounded-lg border transition-all ${
                              formData.classification === c.value
                                ? 'border-primary bg-primary-container/10'
                                : 'border-outline-variant/15 bg-surface-container-lowest hover:border-outline-variant/40'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 mb-1">
                              <Icon
                                name={c.icon}
                                size={16}
                                className={
                                  formData.classification === c.value
                                    ? 'text-primary-container'
                                    : 'text-on-surface-variant'
                                }
                              />
                              <span
                                className={`text-sm font-medium ${formData.classification === c.value ? 'text-primary-container' : 'text-on-surface'}`}
                              >
                                {classificationCopy.label}
                              </span>
                            </div>
                            <p className="text-[11px] text-on-surface-variant sm:ml-7">{classificationCopy.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Base part + description */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                        {t('support.basePart')}
                      </label>
                      <input
                        name="basePart"
                        value={formData.basePart}
                        onChange={handleChange}
                        className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-3 border border-outline-variant/20 outline-none focus:border-primary text-sm"
                        placeholder={t('support.basePartPlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                        {t('support.attachment')}
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".step,.iges,.stl,.pdf"
                        multiple
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full bg-surface-container-lowest text-on-surface-variant rounded-sm px-4 py-3 border border-dashed border-outline-variant/30 hover:border-outline-variant/60 transition-colors text-sm text-left flex items-center gap-2"
                      >
                        <Icon name="upload_file" size={16} />
                        {t('support.attachmentUpload')}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                      {t('support.descriptionLabel')}
                    </label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows={5}
                      className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-3 border border-outline-variant/20 outline-none focus:border-primary text-sm resize-none"
                      placeholder={t('support.descriptionPlaceholder')}
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                    <Link
                      to="/my-tickets"
                      className="text-sm text-on-surface-variant hover:text-on-surface flex items-center gap-1.5"
                    >
                      <Icon name="schedule" size={14} />
                      {t('support.history')}
                    </Link>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !formData.classification || !formData.description.trim()}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Icon name="send" size={16} />
                      {submitting ? t('support.submitting') : t('support.submit')}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar info */}
            <div className="flex flex-col gap-5">
              <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-6">
                <h4 className="text-xs uppercase tracking-widest text-on-surface-variant mb-5 flex items-center gap-2">
                  <Icon name="schedule" size={14} />
                  {t('support.processTitle')}
                </h4>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon name="check_circle" size={14} className="text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface font-medium">{t('support.sidebarStandardTitle')}</p>
                      <p className="text-xs text-on-surface-variant">{t('support.sidebarStandardDesc')}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon name="build" size={14} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface font-medium">{t('support.sidebarComplexTitle')}</p>
                      <p className="text-xs text-on-surface-variant">{t('support.sidebarComplexDesc')}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-6">
                <h4 className="text-xs uppercase tracking-widest text-on-surface-variant mb-5">
                  {t('support.contact')}
                </h4>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                      <Icon name="mail" size={16} className="text-on-surface-variant" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface">{t('support.mailSupport')}</p>
                      <p className="text-xs text-on-surface-variant">support@example.com</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                      <Icon name="support_agent" size={16} className="text-on-surface-variant" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface">{t('support.onlineConsult')}</p>
                      <p className="text-xs text-on-surface-variant">{t('support.workHours')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminManagementPage>
  );
}

function MobileContent() {
  const { t } = useTranslation();
  const { basePart: initBasePart, ctx } = useContextState();
  const [formData, setFormData] = useState({
    basePart: initBasePart,
    classification: ctx?.classification || '',
    description: ctx?.description || '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { settings } = usePublicSettings();
  const business = getBusinessConfig(settings);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!formData.classification) {
      toast(t('support.errorCategoryRequired'), 'error');
      return;
    }
    if (!formData.description.trim()) {
      toast(t('support.errorDescriptionRequired'), 'error');
      return;
    }
    setSubmitting(true);
    const suffix = ctx ? buildContextSuffix(ctx, t) : '';
    try {
      await client.post('/tasks', {
        basePart: formData.basePart || undefined,
        sourceUrl: isSafeSourceUrl(ctx?.sourceUrl) ? ctx.sourceUrl : undefined,
        classification: formData.classification,
        description: formData.description + (suffix ? `\n\n${suffix}` : ''),
      });
      setSubmitted(true);
      toast(t('support.toastSubmitSuccess'), 'success');
      setFormData({ basePart: '', classification: '', description: '' });
      setTimeout(() => setSubmitted(false), 5000);
    } catch (err) {
      notifyGlobalError(err, t('support.toastSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminManagementPage
      title={t('support.title')}
      meta={t('support.meta')}
      description={t('support.compactDescription')}
      actions={<SupportHeaderAction compact />}
      className="app-public-tool-page app-public-tool-page-support px-4 py-4 pb-20"
      contentClassName="space-y-5"
    >
      {ctx && <ContextCard ctx={ctx} />}

      {submitted ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-8 flex flex-col items-center text-center">
          <Icon name="check_circle" size={40} className="text-emerald-400 mb-3" />
          <h3 className="font-bold text-on-surface mb-1">{t('support.successTitleShort')}</h3>
          <p className="text-xs text-on-surface-variant mb-4">{t('support.successDescriptionShort')}</p>
          <Link
            to="/my-tickets"
            className="px-5 py-2 bg-primary-container text-on-primary rounded-sm text-xs font-medium"
          >
            {t('support.successAction')}
          </Link>
        </div>
      ) : (
        <>
          {/* Classification */}
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
            {business.ticketClassifications.map((c) => {
              const classificationCopy = getTicketClassificationCopy(c.value, c, t);
              return (
                <button
                  key={c.value}
                  onClick={() => setFormData((prev) => ({ ...prev, classification: c.value }))}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    formData.classification === c.value
                      ? 'border-primary bg-primary-container/10'
                      : 'border-outline-variant/15 bg-surface-container-high'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5 min-w-0">
                    <Icon
                      name={c.icon}
                      size={14}
                      className={
                        formData.classification === c.value ? 'text-primary-container' : 'text-on-surface-variant'
                      }
                    />
                    <span
                      className={`text-xs font-medium break-words ${formData.classification === c.value ? 'text-primary-container' : 'text-on-surface'}`}
                    >
                      {classificationCopy.label}
                    </span>
                  </div>
                  <p className="text-[10px] text-on-surface-variant min-[380px]:ml-6 break-words">
                    {classificationCopy.desc}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="bg-surface-container-high rounded-lg p-4 space-y-3">
            <input
              name="basePart"
              value={formData.basePart}
              onChange={handleChange}
              className="w-full bg-surface-container-lowest rounded-sm px-3 py-2.5 text-sm text-on-surface border border-outline-variant/20 outline-none focus:border-primary"
              placeholder={t('support.basePartPlaceholder')}
            />
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              className="w-full bg-surface-container-lowest rounded-sm px-3 py-2.5 text-sm text-on-surface border border-outline-variant/20 outline-none focus:border-primary resize-none"
              placeholder={t('support.descriptionPlaceholderMobile')}
            />
            <input ref={fileInputRef} type="file" className="hidden" accept=".step,.iges,.stl,.pdf" multiple />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-outline-variant/30 rounded-sm text-xs text-on-surface-variant hover:border-outline-variant/60"
            >
              <Icon name="upload_file" size={14} />
              {t('support.attachmentUpload')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !formData.classification || !formData.description.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary-container text-on-primary rounded-sm text-sm font-medium disabled:opacity-50 active:scale-95"
            >
              <Icon name="send" size={16} />
              {submitting ? t('support.submitting') : t('support.submit')}
            </button>
          </div>

          <Link to="/my-tickets" className="flex items-center justify-center gap-1.5 text-xs text-on-surface-variant">
            <Icon name="schedule" size={14} />
            {t('support.history')}
          </Link>
        </>
      )}
    </AdminManagementPage>
  );
}

export default function SupportPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('support.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell mobileContentClassName="p-0">{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>
  );
}
