import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import { getSettings, updateSettings } from "../api/settings";
import { getSiteTitle, getContactEmail } from "../lib/publicSettings";
import TopNav from "../components/shared/TopNav";
import AppSidebar from "../components/shared/Sidebar";
import BottomNav from "../components/shared/BottomNav";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import { useToast } from "../components/shared/Toast";
import {
  DEFAULT_SECTIONS,
  DEFAULT_CONTRACT_SECTIONS,
  DEFAULT_QUOTE_PAGE,
  DEFAULT_CONTRACT_PAGE,
  SECTION_LABELS,
  SECTION_ICONS,
  parseDocumentTemplates,
  serializeTemplate,
  serializeDocumentTemplates,
  type TemplateSection,
  type TemplatePageConfig,
  type DocumentTemplateKind,
  type DocumentTemplates,
} from "../lib/quoteTemplate";

// ── Drag helpers ──
function moveSection(sections: TemplateSection[], from: number, to: number): TemplateSection[] {
  const arr = [...sections];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return arr;
}

const FIELD_TOKENS = [
  { label: "报价单号", token: "{{报价单号}}" },
  { label: "合同编号", token: "{{合同编号}}" },
  { label: "单据日期", token: "{{单据日期}}" },
  { label: "客户公司", token: "{{客户公司}}" },
  { label: "联系人", token: "{{联系人}}" },
  { label: "联系电话", token: "{{联系电话}}" },
  { label: "报价总额", token: "{{报价总额}}" },
  { label: "公司名称", token: "{{公司名称}}" },
  { label: "联系邮箱", token: "{{联系邮箱}}" },
  { label: "备注", token: "{{备注}}" },
];

const DEFAULT_FIELD_GRID = "客户公司 | {{客户公司}} | 联系人 | {{联系人}}\n联系电话 | {{联系电话}} | 单据日期 | {{单据日期}}\n报价单号 | {{报价单号}} | 合同编号 | {{合同编号}}";

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function renderTokens(text: unknown) {
  const raw = String(text || "");
  return raw.replace(/\{\{([^}]+)\}\}/g, '<span style="display:inline-block;padding:0 4px;border-radius:3px;background:#eef2ff;color:#3730a3;font-weight:600">{{$1}}</span>');
}

function setCfgValue(cfg: TemplateSection["config"], key: string, value: string | number | boolean) {
  return { ...cfg, [key]: value };
}

function sectionStyle(sec: TemplateSection): React.CSSProperties {
  const c = sec.config;
  const borderMode = (c.borderMode as string) || "none";
  const style: React.CSSProperties = {
    fontSize: num(c.fontSize, 10),
    textAlign: ((c.align as string) || "left") as React.CSSProperties["textAlign"],
    padding: num(c.padding, 0),
    marginBottom: num(c.marginBottom, 12),
    background: (c.background as string) || "transparent",
  };
  if (borderMode === "box") style.border = "1px solid #d1d5db";
  if (borderMode === "dashed") style.border = "1px dashed #9ca3af";
  if (borderMode === "bottom") style.borderBottom = "1px solid #111";
  if (style.border || style.borderBottom) style.borderRadius = 3;
  return style;
}

function pageDefaults(kind: DocumentTemplateKind): TemplatePageConfig {
  return kind === "quote" ? DEFAULT_QUOTE_PAGE : DEFAULT_CONTRACT_PAGE;
}

function pageSize(page?: TemplatePageConfig) {
  const isA5 = page?.paperSize === "A5";
  const landscape = page?.orientation === "landscape";
  const width = isA5 ? 420 : 500;
  const height = isA5 ? 594 : 707;
  return landscape ? { width: height, minHeight: width } : { width, minHeight: height };
}

function cloneTemplates(templates: DocumentTemplates): DocumentTemplates {
  return {
    quote: {
      page: { ...templates.quote.page },
      sections: templates.quote.sections.map((section) => ({ ...section, config: { ...section.config } })),
    },
    contract: {
      page: { ...templates.contract.page },
      sections: templates.contract.sections.map((section) => ({ ...section, config: { ...section.config } })),
    },
  };
}

function PageSetupEditor({ page, onChange }: { page: TemplatePageConfig; onChange: (page: TemplatePageConfig) => void }) {
  const update = (key: keyof TemplatePageConfig, value: string | number) => onChange({ ...page, [key]: value });
  return (
    <div className="rounded-xl bg-surface-container-high/50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-on-surface">页面设置</span>
        <Icon name="description" size={14} className="text-on-surface-variant" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] text-on-surface-variant">纸张</span>
          <select value={page.paperSize || "A4"} onChange={(e) => update("paperSize", e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none">
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-on-surface-variant">方向</span>
          <select value={page.orientation || "portrait"} onChange={(e) => update("orientation", e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none">
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="左右边距" value={num(page.marginX, 18)} min={6} max={40} onChange={(v) => update("marginX", v)} />
        <NumberField label="上下边距" value={num(page.marginY, 18)} min={6} max={40} onChange={(v) => update("marginY", v)} />
        <NumberField label="基础字号" value={num(page.baseFontSize, 14)} min={10} max={18} onChange={(v) => update("baseFontSize", v)} />
      </div>
    </div>
  );
}

function FieldPalette({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="rounded-xl bg-surface-container-high/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-on-surface">字段库</span>
        <Icon name="grid_view" size={14} className="text-on-surface-variant" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FIELD_TOKENS.map((field) => (
          <button
            key={field.token}
            type="button"
            onClick={() => onInsert(field.token)}
            className="px-2 py-1 text-[10px] rounded-md bg-surface-container-lowest text-on-surface-variant hover:text-on-surface hover:bg-primary-container/10"
            title={`插入 ${field.token}`}
          >
            {field.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-on-surface-variant">点字段会插入到当前选中区块的内容里，打印时替换成真实数据。</p>
    </div>
  );
}

function SelectedInspector({
  section,
  onChange,
  onDuplicate,
  onRemove,
}: {
  section: TemplateSection | null;
  onChange: (cfg: TemplateSection["config"]) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  if (!section) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/30 bg-surface-container-lowest/40 p-4 text-center">
        <Icon name="crop_free" size={22} className="mx-auto text-on-surface-variant/40 mb-2" />
        <p className="text-xs font-medium text-on-surface">未选中区块</p>
        <p className="text-[10px] text-on-surface-variant mt-1">点预览里的内容，或点右侧图层后再编辑</p>
      </div>
    );
  }
  const label = section.type === "custom" ? (section.config.title as string || "自由正文") : SECTION_LABELS[section.type];
  return (
    <div className="rounded-xl bg-surface shadow-sm ring-1 ring-primary-container/20 overflow-hidden">
      <div className="px-3 py-2.5 bg-primary-container/8 border-b border-outline-variant/10 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-primary-container/15 text-primary-container flex items-center justify-center shrink-0">
          <Icon name={SECTION_ICONS[section.type] || "description"} size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-on-surface truncate">{label}</p>
          <p className="text-[10px] text-on-surface-variant">当前选区</p>
        </div>
        <button type="button" onClick={onDuplicate} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high" title="复制区块">
          <Icon name="content_copy" size={14} />
        </button>
        {(section.type === "custom" || section.type === "fieldGrid") && (
          <button type="button" onClick={onRemove} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/5" title="删除区块">
            <Icon name="delete" size={14} />
          </button>
        )}
      </div>
      <div className="p-3 max-h-[48dvh] md:max-h-[64dvh] overflow-y-auto">
        <ConfigEditor sec={section} onChange={onChange} />
        <SectionStyleEditor sec={section} onChange={onChange} />
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] text-on-surface-variant">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none"
      />
    </label>
  );
}

function SectionStyleEditor({ sec, onChange }: { sec: TemplateSection; onChange: (cfg: TemplateSection["config"]) => void }) {
  const c = sec.config;
  const update = (key: string, value: string | number | boolean) => onChange(setCfgValue(c, key, value));
  return (
    <div className="mt-3 pt-3 border-t border-outline-variant/10 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">版式</span>
        <button type="button" onClick={() => onChange({ ...c, fontSize: "", marginBottom: "", padding: "", align: "", borderMode: "", background: "" })} className="text-[10px] text-on-surface-variant hover:text-on-surface">清除</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="字号" value={num(c.fontSize, 10)} min={8} max={22} onChange={(v) => update("fontSize", v)} />
        <NumberField label="下间距" value={num(c.marginBottom, 12)} min={0} max={48} onChange={(v) => update("marginBottom", v)} />
        <NumberField label="内边距" value={num(c.padding, 0)} min={0} max={28} onChange={(v) => update("padding", v)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] text-on-surface-variant">对齐</span>
          <select value={(c.align as string) || "left"} onChange={(e) => update("align", e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-on-surface-variant">边框</span>
          <select value={(c.borderMode as string) || "none"} onChange={(e) => update("borderMode", e.target.value)} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none">
            <option value="none">无</option>
            <option value="bottom">底线</option>
            <option value="box">实线框</option>
            <option value="dashed">虚线框</option>
          </select>
        </label>
      </div>
      <label className="space-y-1 block">
        <span className="text-[10px] text-on-surface-variant">背景色</span>
        <input value={(c.background as string) || ""} onChange={(e) => update("background", e.target.value)} placeholder="transparent / #f8fafc" className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none" />
      </label>
    </div>
  );
}

// ── Section config editors ──
function ConfigEditor({ sec, onChange }: { sec: TemplateSection; onChange: (cfg: TemplateSection["config"]) => void }) {
  const c = sec.config;
  const toggle = (key: string) => onChange({ ...c, [key]: !c[key] });
  const setText = (key: string, val: string) => onChange({ ...c, [key]: val });

  switch (sec.type) {
    case "header":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showLogo} onChange={() => toggle("showLogo")} className="rounded" />显示 Logo</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showSubtitle} onChange={() => toggle("showSubtitle")} className="rounded" />显示副标题</label>
          <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">标题</span><input type="text" value={c.title as string || ""} onChange={(e) => setText("title", e.target.value)} className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">副标题</span><input type="text" value={c.subtitle as string || ""} onChange={(e) => setText("subtitle", e.target.value)} className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>
        </div>
      );
    case "meta":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showQuoteNo} onChange={() => toggle("showQuoteNo")} className="rounded" />报价单号</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showContractNo} onChange={() => toggle("showContractNo")} className="rounded" />合同编号</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showDate} onChange={() => toggle("showDate")} className="rounded" />单据日期</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showValidDays} onChange={() => toggle("showValidDays")} className="rounded" />有效期</label>
          {c.showValidDays && <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">天数</span><input type="text" value={c.validDays as string || "30"} onChange={(e) => setText("validDays", e.target.value)} className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>}
        </div>
      );
    case "client":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showCompany} onChange={() => toggle("showCompany")} className="rounded" />客户公司</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showContact} onChange={() => toggle("showContact")} className="rounded" />联系人</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showPhone} onChange={() => toggle("showPhone")} className="rounded" />联系电话</label>
        </div>
      );
    case "table":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showIndex} onChange={() => toggle("showIndex")} className="rounded" />序号列</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showSpec} onChange={() => toggle("showSpec")} className="rounded" />规格列</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showPrice} onChange={() => toggle("showPrice")} className="rounded" />单价列</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showSubtotal} onChange={() => toggle("showSubtotal")} className="rounded" />小计列</label>
        </div>
      );
    case "fieldGrid":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">标题</span><input type="text" value={c.title as string || ""} onChange={(e) => setText("title", e.target.value)} placeholder="例：合同信息" className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>
          <textarea
            value={c.rows as string || DEFAULT_FIELD_GRID}
            onChange={(e) => setText("rows", e.target.value)}
            rows={10}
            className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none resize-y font-mono"
          />
          <p className="text-[10px] text-on-surface-variant">一行是一行表格，单元格用 | 分隔；可插入字段占位符。</p>
        </div>
      );
    case "remark":
      return <p className="text-[10px] text-on-surface-variant">自动显示管理员备注内容，无需配置</p>;
    case "terms":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">标题</span><input type="text" value={c.title as string || ""} onChange={(e) => setText("title", e.target.value)} placeholder="合同条款" className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>
          <textarea value={c.content as string || ""} onChange={(e) => setText("content", e.target.value)} placeholder="逐条填写合同条款..." rows={12} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none resize-y" />
        </div>
      );
    case "signature":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showDate} onChange={() => toggle("showDate")} className="rounded" />显示签署日期</label>
        </div>
      );
    case "footer":
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showCompany} onChange={() => toggle("showCompany")} className="rounded" />公司名称</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showEmail} onChange={() => toggle("showEmail")} className="rounded" />联系邮箱</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showGenerated} onChange={() => toggle("showGenerated")} className="rounded" />"系统生成"提示</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showDate} onChange={() => toggle("showDate")} className="rounded" />显示日期</label>
        </div>
      );
    case "custom":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">标题</span><input type="text" value={c.title as string || ""} onChange={(e) => setText("title", e.target.value)} placeholder="例：付款信息" className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none" /></div>
          <textarea value={c.content as string || ""} onChange={(e) => setText("content", e.target.value)} placeholder="像 Word 一样输入正文，也可以插入 {{客户公司}} 字段..." rows={10} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none resize-y" />
        </div>
      );
    default:
      return null;
  }
}

// ── Preview renderer ──
function PreviewPanel({ sections, page, selectedId, onSelect, onMoveUp, onMoveDown, className = "" }: {
  sections: TemplateSection[];
  page: TemplatePageConfig;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  className?: string;
}) {
  const siteTitle = getSiteTitle();
  const contactEmail = getContactEmail();
  const pageRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; sectionId?: string } | null>(null);
  const [selectBox, setSelectBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [showGuides, setShowGuides] = useState(true);

  const visibleSections = useMemo(() => sections.filter((s) => s.visible), [sections]);
  const size = pageSize(page);

  const selectByRect = useCallback((rect: DOMRect) => {
    const root = pageRef.current;
    if (!root) return;
    let best: { id: string; area: number } | null = null;
    root.querySelectorAll<HTMLElement>("[data-section-id]").forEach((node) => {
      const r = node.getBoundingClientRect();
      const xOverlap = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left));
      const yOverlap = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
      const area = xOverlap * yOverlap;
      if (area > (best?.area || 0)) best = { id: node.dataset.sectionId || "", area };
    });
    if (best?.id) onSelect(best.id);
  }, [onSelect]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const root = pageRef.current;
    if (!root) return;
    const targetSection = (e.target as HTMLElement).closest<HTMLElement>("[data-section-id]");
    if (targetSection?.dataset.sectionId) {
      setShowGuides(true);
      onSelect(targetSection.dataset.sectionId);
    }
    const pageRect = root.getBoundingClientRect();
    dragStartRef.current = { x: e.clientX, y: e.clientY, sectionId: targetSection?.dataset.sectionId };
    setSelectBox({
      left: e.clientX - pageRect.left,
      top: e.clientY - pageRect.top,
      width: 0,
      height: 0,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const root = pageRef.current;
    if (!start || !root) return;
    const pageRect = root.getBoundingClientRect();
    const left = Math.min(start.x, e.clientX) - pageRect.left;
    const top = Math.min(start.y, e.clientY) - pageRect.top;
    setSelectBox({
      left,
      top,
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y),
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    dragStartRef.current = null;
    const width = Math.abs(e.clientX - start.x);
    const height = Math.abs(e.clientY - start.y);
    setSelectBox(null);
    if (width < 6 && height < 6) {
      if (!start.sectionId) setShowGuides(false);
      return;
    }
    selectByRect(new DOMRect(Math.min(start.x, e.clientX), Math.min(start.y, e.clientY), width, height));
  };

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto bg-surface-dim ${className}`}
      onMouseDown={(e) => {
        const root = pageRef.current;
        if (e.button === 0 && root && !root.contains(e.target as Node)) setShowGuides(false);
      }}
    >
      <div className="sticky top-0 z-20 bg-surface/95 border-b border-outline-variant/10 px-3 md:px-4 py-2 flex flex-wrap items-center justify-center gap-2 md:gap-4 text-xs text-on-surface-variant backdrop-blur">
        <span>{page.paperSize || "A4"} {page.orientation === "landscape" ? "横向" : "纵向"}</span>
        <span>边距 {num(page.marginX, 18)} / {num(page.marginY, 18)}</span>
        <span>基础字号 {num(page.baseFontSize, 14)}</span>
        <button
          type="button"
          onClick={() => setShowGuides((v) => !v)}
          className={`px-2 py-1 rounded-md text-[11px] font-medium ${showGuides ? "bg-primary-container/10 text-primary-container" : "bg-surface-container-high text-on-surface-variant"}`}
        >
          {showGuides ? "隐藏辅助层" : "显示辅助层"}
        </button>
      </div>
      <div className="p-3 md:p-6 flex justify-center">
      <div
        ref={pageRef}
        className="relative bg-white rounded-lg shadow-lg border border-outline-variant/10 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ width: `min(${size.width}px, 100%)`, minHeight: size.minHeight, padding: `${num(page.marginY, 18)}px ${num(page.marginX, 18)}px` }}
      >
        {selectBox && (
          <div
            className="pointer-events-none absolute z-30 rounded border border-primary-container bg-primary-container/10"
            style={selectBox}
          />
        )}
        <div style={{ fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif', color: "#000", fontSize: num(page.baseFontSize, 14) }}>
          {visibleSections.map((sec, idx) => {
            const isSelected = selectedId === sec.id;
            const label = sec.type === "custom" ? (sec.config.title as string || "自定义内容") : SECTION_LABELS[sec.type];
            const icon = SECTION_ICONS[sec.type] || "widget";
            const html = renderSectionHtml(sec, siteTitle, contactEmail);
            return (
              <div
                key={sec.id}
                data-section-id={sec.id}
                className={`group relative cursor-crosshair transition-all duration-150 rounded-sm ${showGuides ? (isSelected ? "ring-2 ring-primary-container ring-offset-2 bg-primary-container/[0.025]" : "hover:ring-1 hover:ring-primary-container/45 hover:bg-primary-container/[0.018]") : ""}`}
                style={sectionStyle(sec)}
              >
                {showGuides && (
                  <>
                    <div className={`absolute -top-5 left-0 z-20 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border shadow-sm transition-opacity ${isSelected ? "opacity-100 bg-primary-container text-on-primary border-primary-container" : "opacity-0 group-hover:opacity-100 bg-white text-primary-container border-primary-container/30"}`}>
                      <Icon name={icon} size={10} />
                      <span className="font-medium">{label}</span>
                    </div>
                    <div className={`pointer-events-none absolute inset-0 z-10 rounded-sm border transition-colors ${isSelected ? "border-primary-container bg-primary-container/5" : "border-transparent group-hover:border-primary-container/45 group-hover:bg-primary-container/5"}`} />
                    {isSelected && <div className="absolute -right-1 -top-1 z-20 h-2.5 w-2.5 rounded-full border border-white bg-primary-container" />}
                    <div className={`absolute top-0 right-0 z-30 flex items-center justify-between px-1.5 py-0.5 text-[10px] rounded-bl transition-opacity ${isSelected ? "opacity-100 bg-primary-container/10 text-primary-container" : "opacity-0 group-hover:opacity-100 bg-white/90 text-on-surface-variant"}`}>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); onMoveUp(sec.id); }}
                          disabled={idx === 0}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-surface-container-high disabled:opacity-20"
                          title="上移"
                        >
                          <Icon name="keyboard_arrow_up" size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onMoveDown(sec.id); }}
                          disabled={idx === visibleSections.length - 1}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-surface-container-high disabled:opacity-20"
                          title="下移"
                        >
                          <Icon name="keyboard_arrow_down" size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div style={{ height: 8 }} />}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}

// Render a single section to HTML string
function renderSectionHtml(sec: TemplateSection, siteTitle: string, contactEmail: string): string {
  const c = sec.config;
  switch (sec.type) {
    case "header": {
      const logoHtml = c.showLogo ? '<div style="width:32px;height:32px;background:#e5e7eb;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999">Logo</div>' : "";
      const subtitleHtml = c.showSubtitle ? `<p style="font-size:10px;color:#999;margin:2px 0 0">${c.subtitle || "QUOTATION"}</p>` : "";
      return `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:8px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px">${logoHtml}<span style="font-size:14px;font-weight:700">${siteTitle}</span></div>
        <div style="text-align:right"><span style="font-size:16px;font-weight:700;letter-spacing:2px">${c.title || "报 价 单"}</span>${subtitleHtml}</div>
      </div>`;
    }
    case "meta": {
      const lines: string[] = [];
      if (c.showQuoteNo) lines.push(`<span style="color:#888;font-size:11px">报价单号：</span><span style="font-size:11px">QT-20260425</span>`);
      if (c.showContractNo) lines.push(`<span style="color:#888;font-size:11px">合同编号：</span><span style="font-size:11px">HT-20260425</span>`);
      if (c.showDate) lines.push(`<span style="color:#888;font-size:11px">日期：</span><span style="font-size:11px">2026/04/25</span>`);
      if (c.showValidDays) lines.push(`<span style="color:#888;font-size:11px">有效期：</span><span style="font-size:11px">${c.validDays || "30"}天</span>`);
      return `<div style="display:flex;gap:12px;margin-bottom:12px;font-size:11px">${lines.map((l) => `<p style="margin:0">${l}</p>`).join("")}</div>`;
    }
    case "client": {
      const lines: string[] = [];
      if (c.showCompany) lines.push(`<span style="color:#888;font-size:11px">公司：</span><span style="font-size:11px">示例公司</span>`);
      if (c.showContact) lines.push(`<span style="color:#888;font-size:11px">联系人：</span><span style="font-size:11px">张三</span>`);
      if (c.showPhone) lines.push(`<span style="color:#888;font-size:11px">电话：</span><span style="font-size:11px">138****1234</span>`);
      return `<div style="margin-bottom:12px;font-size:11px">${lines.map((l) => `<p style="margin:0">${l}</p>`).join("")}</div>`;
    }
    case "table": {
      const heads: string[] = [];
      if (c.showIndex) heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:center">#</th>');
      heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:left">型号</th>');
      if (c.showSpec) heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:left">规格</th>');
      heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:center">数量</th>');
      if (c.showPrice) heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:right">单价</th>');
      if (c.showSubtotal) heads.push('<th style="padding:3px 6px;font-size:10px;border-bottom:1px solid #ddd;text-align:right">小计</th>');
      const row1Cells: string[] = [];
      if (c.showIndex) row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee;text-align:center">1</td>');
      row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee">KQ2H06-01A</td>');
      if (c.showSpec) row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee;color:#666">管径:6</td>');
      row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee;text-align:center">100</td>');
      if (c.showPrice) row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee;text-align:right">12.50</td>');
      if (c.showSubtotal) row1Cells.push('<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #eee;text-align:right">1250.00</td>');
      const colspan = heads.length - 1;
      return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <thead><tr style="background:#f3f4f6">${heads.join("")}</tr></thead>
        <tbody><tr>${row1Cells.join("")}</tr></tbody>
        <tfoot><tr style="background:#f3f4f6;font-weight:700"><td colspan="${colspan}" style="padding:3px 6px;font-size:10px;text-align:right;border-top:1px solid #ddd">合计</td><td style="padding:3px 6px;font-size:10px;text-align:right;border-top:1px solid #ddd">¥1250.00</td></tr></tfoot>
      </table>`;
    }
    case "fieldGrid": {
      const rows = String(c.rows || DEFAULT_FIELD_GRID).split("\n").filter(Boolean);
      const body = rows.map((row) => `<tr>${row.split("|").map((cell) => `<td style="border:1px solid #d1d5db;padding:5px 7px;font-size:10px">${renderTokens(cell.trim())}</td>`).join("")}</tr>`).join("");
      return `<div style="margin-bottom:12px">${c.title ? `<p style="font-weight:600;margin:0 0 5px;font-size:11px">${renderTokens(c.title)}</p>` : ""}<table style="width:100%;border-collapse:collapse">${body}</table></div>`;
    }
    case "remark":
      return `<div style="border:1px solid #e5e7eb;border-radius:3px;padding:8px;margin-bottom:12px;font-size:10px"><p style="font-weight:500;margin:0 0 2px">备注</p><p style="color:#666;margin:0">示例备注内容...</p></div>`;
    case "terms":
      return `<div style="margin-bottom:12px;font-size:10px"><p style="font-weight:600;margin:0 0 4px">${renderTokens(c.title || "合同条款")}</p><p style="color:#555;margin:0;white-space:pre-wrap;line-height:1.7">${renderTokens(c.content || "1. 付款方式：双方协商确认。\\n2. 交货周期：以实际确认为准。")}</p></div>`;
    case "signature":
      return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0 12px;font-size:10px"><div><p style="font-weight:600;margin:0 0 16px">甲方（采购方）：</p><p style="margin:0">签章：</p>${c.showDate ? '<p style="margin:12px 0 0">日期：</p>' : ""}</div><div><p style="font-weight:600;margin:0 0 16px">乙方（供货方）：</p><p style="margin:0">签章：</p>${c.showDate ? '<p style="margin:12px 0 0">日期：</p>' : ""}</div></div>`;
    case "custom":
      return `<div style="margin-bottom:12px;font-size:10px">${c.title ? `<p style="font-weight:500;margin:0 0 2px">${renderTokens(c.title)}</p>` : ""}${c.content ? `<p style="color:#666;margin:0;white-space:pre-wrap;line-height:1.7">${renderTokens(c.content)}</p>` : ""}</div>`;
    case "footer": {
      const left: string[] = [];
      if (c.showCompany) left.push(`<span style="font-weight:500;color:#374151">${siteTitle}</span>`);
      if (c.showEmail && contactEmail) left.push(`邮箱：${contactEmail}`);
      const right: string[] = [];
      if (c.showGenerated) right.push("系统自动生成");
      if (c.showDate) right.push("2026/04/25");
      return `<div style="border-top:1px solid #e5e7eb;padding-top:8px;font-size:10px;color:#999;display:flex;justify-content:space-between"><div>${left.join(" ")}</div><div style="text-align:right">${right.join(" ")}</div></div>`;
    }
    default: return "";
  }
}

// ── Main editor ──
export default function QuoteTemplateEditor() {
  useDocumentTitle("单据模板编辑");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeKind, setActiveKind] = useState<DocumentTemplateKind>("quote");
  const [templates, setTemplates] = useState<DocumentTemplates>({
    quote: { page: DEFAULT_QUOTE_PAGE, sections: DEFAULT_SECTIONS },
    contract: { page: DEFAULT_CONTRACT_PAGE, sections: DEFAULT_CONTRACT_SECTIONS },
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobilePane, setMobilePane] = useState<"edit" | "preview">("edit");
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const historyRef = useRef<DocumentTemplates[]>([]);
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    getSettings().then((s) => {
      const parsed = parseDocumentTemplates((s as any).document_templates || "", (s as any).quote_template || "");
      setTemplates(parsed);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [setSections]);

  const sections = templates[activeKind].sections;
  const selectedSection = sections.find((s) => s.id === expandedId) || null;
  const page = { ...pageDefaults(activeKind), ...templates[activeKind].page };

  const commitTemplates = useCallback((updater: DocumentTemplates | ((prev: DocumentTemplates) => DocumentTemplates)) => {
    const nextTemplates = typeof updater === "function" ? updater(templates) : updater;
    historyRef.current = [...historyRef.current.slice(-49), cloneTemplates(templates)];
    setHistoryCount(historyRef.current.length);
    setTemplates(nextTemplates);
  }, [templates]);

  const handleUndo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setTemplates(previous);
    setHistoryCount(historyRef.current.length);
    if (expandedId && !previous[activeKind].sections.some((section) => section.id === expandedId)) {
      setExpandedId(null);
    }
  }, [activeKind, expandedId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = !!target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable || event.shiftKey || event.key.toLowerCase() !== "z" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      handleUndo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo]);

  const setSections = useCallback((updater: TemplateSection[] | ((prev: TemplateSection[]) => TemplateSection[])) => {
    commitTemplates((prev) => {
      const nextSections = typeof updater === "function" ? updater(prev[activeKind].sections) : updater;
      return { ...prev, [activeKind]: { ...prev[activeKind], sections: nextSections } };
    });
  }, [activeKind, commitTemplates]);
  const setPage = useCallback((nextPage: TemplatePageConfig) => {
    commitTemplates((prev) => ({ ...prev, [activeKind]: { ...prev[activeKind], page: nextPage } }));
  }, [activeKind, commitTemplates]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSettings({
        document_templates: serializeDocumentTemplates(templates),
        quote_template: serializeTemplate(templates.quote),
      } as any);
      toast("模板已保存", "success");
    } catch {
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }, [templates, toast]);

  const handleReset = () => {
    commitTemplates((prev) => ({
      ...prev,
      [activeKind]: {
        page: pageDefaults(activeKind),
        sections: activeKind === "quote" ? DEFAULT_SECTIONS : DEFAULT_CONTRACT_SECTIONS,
      },
    }));
    setExpandedId(null);
  };

  const addCustomBlock = () => {
    const id = `custom_${Date.now()}`;
    const newSec: TemplateSection = { id, type: "custom", visible: true, config: { title: "", content: "" } };
    setSections((prev) => [...prev, newSec]);
    setExpandedId(id);
  };

  const addFieldGrid = () => {
    const id = `field_grid_${Date.now()}`;
    const newSec: TemplateSection = { id, type: "fieldGrid", visible: true, config: { title: "单据信息", rows: DEFAULT_FIELD_GRID, borderMode: "none" } };
    setSections((prev) => [...prev, newSec]);
    setExpandedId(id);
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const duplicateSection = (id: string) => {
    const source = sections.find((s) => s.id === id);
    if (!source) return;
    const copy: TemplateSection = {
      ...source,
      id: `${source.type}_${Date.now()}`,
      config: { ...source.config, title: source.type === "custom" && source.config.title ? `${source.config.title} 副本` : source.config.title },
    };
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setExpandedId(copy.id);
    requestAnimationFrame(() => layerRefs.current[copy.id]?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const updateSection = (id: string, cfg: TemplateSection["config"]) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, config: cfg } : s)));
  };

  const insertToken = (token: string) => {
    const targetId = expandedId || sections.find((s) => s.type === "custom" || s.type === "terms" || s.type === "fieldGrid")?.id;
    if (!targetId) {
      const id = `custom_${Date.now()}`;
      setSections((prev) => [...prev, { id, type: "custom", visible: true, config: { title: "", content: token } }]);
      setExpandedId(id);
      return;
    }
    setSections((prev) => prev.map((s) => {
      if (s.id !== targetId) return s;
      const key = s.type === "fieldGrid" ? "rows" : "content";
      const current = String(s.config[key] || "");
      return { ...s, config: { ...s.config, [key]: current ? `${current}${token}` : token } };
    }));
    setExpandedId(targetId);
  };

  const toggleVisible = (id: string) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)));
  };

  // Drag handlers using HTML5 API
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (idx: number) => { if (dragIdx !== null && dragIdx !== idx) setDropIdx(idx); };
  const handleDrop = () => {
    if (dragIdx !== null && dropIdx !== null) {
      setSections((prev) => moveSection(prev, dragIdx, dropIdx));
    }
    setDragIdx(null);
    setDropIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDropIdx(null); };

  // Move section up/down by id
  const moveUp = useCallback((id: string) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx <= 0) return prev;
      return moveSection(prev, idx, idx - 1);
    });
  }, [setSections]);
  const moveDown = useCallback((id: string) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      return moveSection(prev, idx, idx + 1);
    });
  }, [setSections]);

  // Select section from preview
  const handlePreviewSelect = useCallback((id: string) => {
    setExpandedId(id);
    if (!isDesktop) setMobilePane("edit");
    requestAnimationFrame(() => layerRefs.current[id]?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [isDesktop]);

  const handleLayerSelect = useCallback((id: string) => {
    setExpandedId(id);
    requestAnimationFrame(() => layerRefs.current[id]?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col h-dvh">
        <TopNav compact={!isDesktop} onMenuToggle={() => setNavOpen(true)} />
        <div className="flex-1 flex items-center justify-center"><Icon name="autorenew" size={24} className="text-on-surface-variant/30 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <TopNav compact={!isDesktop} onMenuToggle={() => setNavOpen(true)} />
      {!isDesktop && <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />}
      {!isDesktop && (
        <div className="px-3 py-2 border-b border-outline-variant/10 bg-surface-container-low">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container-high p-1">
            <button
              type="button"
              onClick={() => setMobilePane("edit")}
              className={`py-2 text-xs font-bold rounded-md transition-colors ${mobilePane === "edit" ? "bg-surface text-on-surface shadow-sm" : "text-on-surface-variant"}`}
            >
              编辑
            </button>
            <button
              type="button"
              onClick={() => setMobilePane("preview")}
              className={`py-2 text-xs font-bold rounded-md transition-colors ${mobilePane === "preview" ? "bg-surface text-on-surface shadow-sm" : "text-on-surface-variant"}`}
            >
              预览
            </button>
          </div>
        </div>
      )}
      <div
        className="flex flex-1 overflow-hidden"
        style={!isDesktop ? { paddingBottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" } : undefined}
      >
        {isDesktop && <AppSidebar />}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden flex-col md:flex-row">
          {/* Left panel: editor */}
          <div className={`w-full md:w-[640px] xl:w-[720px] md:shrink-0 border-b md:border-b-0 md:border-r border-outline-variant/10 flex flex-col bg-surface-container-low min-h-0 ${!isDesktop && mobilePane !== "edit" ? "hidden" : ""}`}>
            <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
              <div className="md:h-full md:min-h-0 md:grid md:grid-cols-[minmax(0,1fr)_250px] xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="px-4 py-3 border-b md:border-b-0 md:border-r border-outline-variant/10 space-y-3 md:min-h-0 md:overflow-y-auto">
                <div className="flex items-center justify-between">
                  <h2 className="font-headline text-sm font-bold text-on-surface uppercase tracking-wide">单据模板</h2>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={historyCount === 0}
                      className="w-8 h-8 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                      title="撤销上一步 (Ctrl/⌘ + Z)"
                    >
                      <Icon name="undo" size={16} />
                    </button>
                    <button onClick={addFieldGrid} className="px-2.5 py-1.5 text-[11px] font-bold bg-surface-container-highest text-on-surface rounded-lg hover:opacity-90 flex items-center gap-1" title="添加字段表格">
                      <Icon name="grid_view" size={14} /> 表格
                    </button>
                    <button onClick={addCustomBlock} className="px-2.5 py-1.5 text-[11px] font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 flex items-center gap-1" title="添加自由正文">
                      <Icon name="add" size={14} /> 正文
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-container-high p-1">
                  {([{ key: "quote", label: "报价单" }, { key: "contract", label: "合同" }] as const).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => { setActiveKind(item.key); setExpandedId(null); }}
                      className={`py-1.5 text-xs font-bold rounded-md transition-colors ${activeKind === item.key ? "bg-surface text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <PageSetupEditor page={page} onChange={setPage} />
                <FieldPalette onInsert={insertToken} />
                <SelectedInspector
                  section={selectedSection}
                  onChange={(cfg) => selectedSection && updateSection(selectedSection.id, cfg)}
                  onDuplicate={() => selectedSection && duplicateSection(selectedSection.id)}
                  onRemove={() => selectedSection && removeSection(selectedSection.id)}
                />
              </div>

              <div className="md:min-h-0 md:overflow-y-auto">
                <div className="sticky top-0 z-10 px-4 py-2 border-y md:border-t-0 border-outline-variant/10 bg-surface-container-low/95 backdrop-blur flex items-center justify-between">
                  <span className="text-xs font-bold text-on-surface">图层</span>
                  <span className="text-[10px] text-on-surface-variant">{sections.length} 个区块</span>
                </div>

                <div className="px-3 py-3 space-y-2">
                  {sections.map((sec, idx) => {
                    const isExpanded = expandedId === sec.id;
                    const isDragging = dragIdx === idx;
                    const isDropTarget = dropIdx === idx;
                    const label = sec.type === "custom" ? (sec.config.title as string || "自定义内容") : SECTION_LABELS[sec.type];
                    const icon = SECTION_ICONS[sec.type] || "dashboard";
                    const canDelete = sec.type === "custom" || sec.type === "fieldGrid";

                    return (
                      <div
                        key={sec.id}
                        ref={(node) => { layerRefs.current[sec.id] = node; }}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => { e.preventDefault(); handleDragOver(idx); }}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        className={`rounded-xl transition-all duration-150 ${isDropTarget ? "border-2 border-dashed border-primary-container/50 bg-primary-container/5" : isDragging ? "opacity-30 scale-95" : ""} ${!sec.visible ? "opacity-40" : ""} ${isExpanded ? "bg-surface shadow-sm ring-2 ring-primary-container/35" : "bg-surface-container-high/50 hover:bg-surface-container-high"}`}
                      >
                        <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={() => handleLayerSelect(sec.id)}>
                          <span className="text-on-surface-variant/30 hover:text-on-surface-variant/60 cursor-grab active:cursor-grabbing shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                            <Icon name="drag_indicator" size={16} />
                          </span>
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${sec.visible ? "bg-primary-container/15" : "bg-surface-container-highest/50"}`}>
                            <Icon name={icon} size={14} className={sec.visible ? "text-primary-container" : "text-on-surface-variant/30"} />
                          </div>
                          <span className={`text-xs font-medium flex-1 truncate ${sec.visible ? "text-on-surface" : "text-on-surface-variant/50 line-through"}`}>{label}</span>
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { if (idx > 0) { setSections((prev) => moveSection(prev, idx, idx - 1)); } }} disabled={idx === 0} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container disabled:opacity-20 disabled:cursor-not-allowed" title="上移">
                              <Icon name="expand_more" size={14} style={{ transform: "rotate(180deg)" }} />
                            </button>
                            <button onClick={() => { if (idx < sections.length - 1) { setSections((prev) => moveSection(prev, idx, idx + 1)); } }} disabled={idx === sections.length - 1} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container disabled:opacity-20 disabled:cursor-not-allowed" title="下移">
                              <Icon name="expand_more" size={14} />
                            </button>
                            {canDelete && (
                              <button onClick={() => removeSection(sec.id)} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-error hover:bg-error/5" title="删除">
                                <Icon name="close" size={14} />
                              </button>
                            )}
                            <button onClick={() => toggleVisible(sec.id)} className={`w-8 h-[18px] rounded-full transition-colors relative ${sec.visible ? "bg-primary-container" : "bg-outline/30"}`} title={sec.visible ? "隐藏" : "显示"}>
                              <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all duration-150 ${sec.visible ? "left-[15px]" : "left-[2px]"}`} />
                            </button>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
              </div>
            </div>

            {/* Bottom actions */}
            <div className="px-3 py-3 border-t border-outline-variant/10 space-y-2 shrink-0 bg-surface-container-low">
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50">
                  {saving ? "保存中..." : "保存全部模板"}
                </button>
                <button onClick={handleReset} className="px-3 py-2 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded-lg">
                  恢复默认
                </button>
              </div>
              <button onClick={() => navigate(-1)} className="w-full py-1.5 text-xs text-on-surface-variant/60 hover:text-on-surface">
                ← 返回
              </button>
            </div>
          </div>

          {/* Right panel: preview */}
          <PreviewPanel
            sections={sections}
            page={page}
            selectedId={expandedId}
            onSelect={handlePreviewSelect}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
            className={!isDesktop && mobilePane !== "preview" ? "hidden" : ""}
          />
        </div>
      </div>
      {!isDesktop && <BottomNav />}
    </div>
  );
}
