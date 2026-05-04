import { useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import Icon from '../components/shared/Icon';
import { PageHeader } from '../components/shared/PagePrimitives';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { useToast } from '../components/shared/Toast';
import client from '../api/client';
import useSWR from 'swr';
import { getCachedPublicSettings } from '../lib/publicSettings';
import { getBusinessConfig } from '../lib/businessConfig';

/* ── Context passed via navigate(state) ── */
interface SupportContext {
  modelNo?: string;
  modelName?: string;
  searchQuery?: string;
  classification?: string;
  description?: string;
  specs?: Record<string, string>;
  source?: 'selection' | 'model' | 'model_search';
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

/** Build append-only context string for ticket submission */
function buildContextSuffix(ctx: SupportContext): string {
  let suffix = '';
  if (ctx.source === 'model' && ctx.modelName) suffix += `来源模型：${ctx.modelName}\n`;
  if (ctx.source === 'selection' && ctx.modelNo) suffix += `选型型号：${ctx.modelNo}\n`;
  if (ctx.source === 'model_search' && ctx.searchQuery) suffix += `模型库搜索词：${ctx.searchQuery}\n`;
  if (ctx.specs && Object.keys(ctx.specs).length > 0) {
    const lines = Object.entries(ctx.specs)
      .filter(([, v]) => v && v !== '—')
      .map(([k, v]) => `${k}: ${v}`);
    if (lines.length) suffix += `【产品规格】\n${lines.join('\n')}\n`;
  }
  return suffix;
}

/** Read-only context card shown above the form */
function ContextCard({ ctx }: { ctx: SupportContext }) {
  const label =
    ctx.source === 'model_search'
      ? '来自模型搜索'
      : ctx.source === 'model'
        ? '来自模型'
        : ctx.source === 'selection'
          ? '来自选型'
          : '关联产品';
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
              <span className="text-[11px] text-on-surface-variant">+{specEntries.length - 6} 项</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DesktopContent() {
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
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!formData.classification) {
      toast('请选择请求分类', 'error');
      return;
    }
    if (!formData.description.trim()) {
      toast('请填写问题描述', 'error');
      return;
    }
    setSubmitting(true);
    const suffix = ctx ? buildContextSuffix(ctx) : '';
    try {
      await client.post('/tasks', {
        basePart: formData.basePart || undefined,
        classification: formData.classification,
        description: formData.description + (suffix ? `\n\n${suffix}` : ''),
      });
      setSubmitted(true);
      toast('工单已提交，我们将尽快处理', 'success');
      setFormData({ basePart: '', classification: '', description: '' });
      setTimeout(() => setSubmitted(false), 5000);
    } catch {
      toast('提交失败，请稍后重试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <PageHeader title="技术支持" description="提交定制需求或技术问题，我们的工程师团队将为您处理" className="mb-10" />

      {/* Process Steps */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        {business.supportProcessSteps.map((step, i) => (
          <div
            key={step.title}
            className="flex items-center gap-4 bg-surface-container-low rounded-lg p-4 border border-outline-variant/10"
          >
            <div className="w-10 h-10 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary-container">{i + 1}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">{step.title}</p>
              <p className="text-[11px] text-on-surface-variant truncate">{step.desc}</p>
            </div>
          </div>
        ))}
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
            <h3 className="font-headline text-xl font-bold text-on-surface mb-2">工单提交成功</h3>
            <p className="text-sm text-on-surface-variant mb-6">工程师将在24小时内响应您的请求</p>
            <Link
              to="/my-tickets"
              className="px-6 py-2.5 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:opacity-90"
            >
              查看我的工单
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
                  提交需求
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
                      请求分类
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {business.ticketClassifications.map((c) => (
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
                              {c.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-on-surface-variant sm:ml-7">{c.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Base part + description */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                        基础零件编号
                      </label>
                      <input
                        name="basePart"
                        value={formData.basePart}
                        onChange={handleChange}
                        className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-3 border border-outline-variant/20 outline-none focus:border-primary text-sm"
                        placeholder="例如 882-QX-V2（可选）"
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                        附件
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
                        点击上传附件
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                      问题描述
                    </label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows={5}
                      className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-4 py-3 border border-outline-variant/20 outline-none focus:border-primary text-sm resize-none"
                      placeholder="详细描述您的需求，包括尺寸要求、公差、材料特性等..."
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                    <Link
                      to="/my-tickets"
                      className="text-sm text-on-surface-variant hover:text-on-surface flex items-center gap-1.5"
                    >
                      <Icon name="schedule" size={14} />
                      查看历史工单
                    </Link>
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !formData.classification || !formData.description.trim()}
                      className="flex items-center justify-center gap-2 px-8 py-3 bg-primary-container text-on-primary rounded-sm text-sm font-medium hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Icon name="send" size={16} />
                      {submitting ? '提交中...' : '提交工单'}
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
                  处理时效
                </h4>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon name="check_circle" size={14} className="text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface font-medium">标准修改</p>
                      <p className="text-xs text-on-surface-variant">24小时内完成</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon name="build" size={14} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface font-medium">复杂定制</p>
                      <p className="text-xs text-on-surface-variant">需要工程师初步评估</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 p-6">
                <h4 className="text-xs uppercase tracking-widest text-on-surface-variant mb-5">联系方式</h4>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                      <Icon name="mail" size={16} className="text-on-surface-variant" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface">邮件支持</p>
                      <p className="text-xs text-on-surface-variant">support@example.com</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center shrink-0">
                      <Icon name="support_agent" size={16} className="text-on-surface-variant" />
                    </div>
                    <div>
                      <p className="text-sm text-on-surface">在线咨询</p>
                      <p className="text-xs text-on-surface-variant">工作日 9:00 - 18:00</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MobileContent() {
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
  const { data: settings } = useSWR('publicSettings', () => getCachedPublicSettings());
  const business = getBusinessConfig(settings);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!formData.classification) {
      toast('请选择请求分类', 'error');
      return;
    }
    if (!formData.description.trim()) {
      toast('请填写问题描述', 'error');
      return;
    }
    setSubmitting(true);
    const suffix = ctx ? buildContextSuffix(ctx) : '';
    try {
      await client.post('/tasks', {
        basePart: formData.basePart || undefined,
        classification: formData.classification,
        description: formData.description + (suffix ? `\n\n${suffix}` : ''),
      });
      setSubmitted(true);
      toast('工单已提交，我们将尽快处理', 'success');
      setFormData({ basePart: '', classification: '', description: '' });
      setTimeout(() => setSubmitted(false), 5000);
    } catch {
      toast('提交失败，请稍后重试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 py-4 pb-20 space-y-5">
      <PageHeader title="技术支持" description="提交定制需求，工程师团队为您处理" />

      {ctx && <ContextCard ctx={ctx} />}

      {submitted ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-8 flex flex-col items-center text-center">
          <Icon name="check_circle" size={40} className="text-emerald-400 mb-3" />
          <h3 className="font-bold text-on-surface mb-1">提交成功</h3>
          <p className="text-xs text-on-surface-variant mb-4">工程师将在24小时内响应</p>
          <Link
            to="/my-tickets"
            className="px-5 py-2 bg-primary-container text-on-primary rounded-sm text-xs font-medium"
          >
            查看我的工单
          </Link>
        </div>
      ) : (
        <>
          {/* Classification */}
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
            {business.ticketClassifications.map((c) => (
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
                    {c.label}
                  </span>
                </div>
                <p className="text-[10px] text-on-surface-variant min-[380px]:ml-6 break-words">{c.desc}</p>
              </button>
            ))}
          </div>

          <div className="bg-surface-container-high rounded-lg p-4 space-y-3">
            <input
              name="basePart"
              value={formData.basePart}
              onChange={handleChange}
              className="w-full bg-surface-container-lowest rounded-sm px-3 py-2.5 text-sm text-on-surface border border-outline-variant/20 outline-none focus:border-primary"
              placeholder="基础零件编号（可选）"
            />
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
              className="w-full bg-surface-container-lowest rounded-sm px-3 py-2.5 text-sm text-on-surface border border-outline-variant/20 outline-none focus:border-primary resize-none"
              placeholder="描述您的需求..."
            />
            <input ref={fileInputRef} type="file" className="hidden" accept=".step,.iges,.stl,.pdf" multiple />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-outline-variant/30 rounded-sm text-xs text-on-surface-variant hover:border-outline-variant/60"
            >
              <Icon name="upload_file" size={14} />
              上传附件
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !formData.classification || !formData.description.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary-container text-on-primary rounded-sm text-sm font-medium disabled:opacity-50 active:scale-95"
            >
              <Icon name="send" size={16} />
              {submitting ? '提交中...' : '提交工单'}
            </button>
          </div>

          <Link to="/my-tickets" className="flex items-center justify-center gap-1.5 text-xs text-on-surface-variant">
            <Icon name="schedule" size={14} />
            查看历史工单
          </Link>
        </>
      )}
    </div>
  );
}

export default function SupportPage() {
  useDocumentTitle('技术支持');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  return (
    <AdminPageShell mobileContentClassName="p-0">{isDesktop ? <DesktopContent /> : <MobileContent />}</AdminPageShell>
  );
}
