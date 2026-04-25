import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { getSettings, updateSettings } from "../api/settings";
import { getSiteTitle, getSiteLogo, getContactEmail } from "../lib/publicSettings";
import TopNav from "../components/shared/TopNav";
import AppSidebar from "../components/shared/Sidebar";
import Icon from "../components/shared/Icon";
import { useToast } from "../components/shared/Toast";
import {
  DEFAULT_SECTIONS,
  SECTION_LABELS,
  SECTION_ICONS,
  serializeTemplate,
  parseTemplate,
  type TemplateSection,
  type QuoteTemplate,
} from "../lib/quoteTemplate";

// ── Drag helpers ──
function moveSection(sections: TemplateSection[], from: number, to: number): TemplateSection[] {
  const arr = [...sections];
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return arr;
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
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.showDate} onChange={() => toggle("showDate")} className="rounded" />报价日期</label>
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
    case "remark":
      return <p className="text-[10px] text-on-surface-variant">自动显示管理员备注内容，无需配置</p>;
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
          <textarea value={c.content as string || ""} onChange={(e) => setText("content", e.target.value)} placeholder="自定义内容..." rows={3} className="w-full bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1 border border-outline-variant/20 outline-none resize-y" />
        </div>
      );
    default:
      return null;
  }
}

// ── Preview renderer ──
function PreviewPanel({ sections, selectedId, onSelect, onMoveUp, onMoveDown }: {
  sections: TemplateSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}) {
  const siteTitle = getSiteTitle();
  const contactEmail = getContactEmail();

  const visibleSections = useMemo(() => sections.filter((s) => s.visible), [sections]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-surface-dim flex justify-center">
      <div className="bg-white rounded-lg shadow-lg border border-outline-variant/10" style={{ width: 500, minHeight: 600, padding: "24px 20px" }}>
        <div style={{ fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif', color: "#000" }}>
          {visibleSections.map((sec, idx) => {
            const isSelected = selectedId === sec.id;
            const label = sec.type === "custom" ? (sec.config.title as string || "自定义内容") : SECTION_LABELS[sec.type];
            const icon = SECTION_ICONS[sec.type] || "widget";
            const html = renderSectionHtml(sec, siteTitle, contactEmail);
            return (
              <div
                key={sec.id}
                className={`group relative cursor-pointer transition-all duration-150 ${isSelected ? "ring-2 ring-primary-container ring-offset-2 rounded" : "hover:ring-1 hover:ring-outline-variant/30 hover:rounded"}`}
                onClick={() => onSelect(sec.id)}
              >
                {/* Section label overlay — shown on hover / selected */}
                <div className={`absolute -top-0 left-0 right-0 flex items-center justify-between px-1.5 py-0.5 text-[10px] rounded-t transition-opacity ${isSelected ? "opacity-100 bg-primary-container/10 text-primary-container" : "opacity-0 group-hover:opacity-100 bg-surface-container-high/80 text-on-surface-variant"}`}>
                  <div className="flex items-center gap-1">
                    <Icon name={icon} size={10} />
                    <span className="font-medium">{label}</span>
                  </div>
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
                {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div style={{ height: 8 }} />}
              </div>
            );
          })}
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
    case "remark":
      return `<div style="border:1px solid #e5e7eb;border-radius:3px;padding:8px;margin-bottom:12px;font-size:10px"><p style="font-weight:500;margin:0 0 2px">备注</p><p style="color:#666;margin:0">示例备注内容...</p></div>`;
    case "custom":
      return `<div style="margin-bottom:12px;font-size:10px">${c.title ? `<p style="font-weight:500;margin:0 0 2px">${c.title}</p>` : ""}${c.content ? `<p style="color:#666;margin:0;white-space:pre-wrap">${c.content}</p>` : ""}</div>`;
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
  useDocumentTitle("报价单模板编辑");
  const navigate = useNavigate();
  const { toast } = useToast();
  const [sections, setSections] = useState<TemplateSection[]>(DEFAULT_SECTIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSettings().then((s) => {
      const parsed = parseTemplate((s as any).quote_template || "");
      if (parsed?.sections?.length) setSections(parsed.sections);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSettings({ quote_template: serializeTemplate({ sections }) } as any);
      toast("模板已保存", "success");
    } catch {
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }, [sections, toast]);

  const handleReset = () => {
    setSections(DEFAULT_SECTIONS);
    setExpandedId(null);
  };

  const addCustomBlock = () => {
    const id = `custom_${Date.now()}`;
    const newSec: TemplateSection = { id, type: "custom", visible: true, config: { title: "", content: "" } };
    setSections((prev) => [...prev, newSec]);
    setExpandedId(id);
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updateSection = (id: string, cfg: TemplateSection["config"]) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, config: cfg } : s)));
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
  }, []);
  const moveDown = useCallback((id: string) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      return moveSection(prev, idx, idx + 1);
    });
  }, []);

  // Select section from preview
  const handlePreviewSelect = useCallback((id: string) => {
    setExpandedId((prev) => prev === id ? null : id);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col h-screen">
        <TopNav />
        <div className="flex-1 flex items-center justify-center"><Icon name="autorenew" size={24} className="text-on-surface-variant/30 animate-spin" /></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel: editor */}
          <div className="w-80 shrink-0 border-r border-outline-variant/10 flex flex-col bg-surface-container-low">
            <div className="px-4 py-3 border-b border-outline-variant/10 flex items-center justify-between">
              <h2 className="font-headline text-sm font-bold text-on-surface uppercase tracking-wide">区块管理</h2>
              <button onClick={addCustomBlock} className="px-2.5 py-1.5 text-[11px] font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 flex items-center gap-1" title="添加自定义内容">
                <Icon name="add" size={14} /> 添加区块
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
              {sections.map((sec, idx) => {
                const isExpanded = expandedId === sec.id;
                const isDragging = dragIdx === idx;
                const isDropTarget = dropIdx === idx;
                const label = sec.type === "custom" ? (sec.config.title as string || "自定义内容") : SECTION_LABELS[sec.type];
                const icon = SECTION_ICONS[sec.type] || "dashboard";
                const canDelete = sec.type === "custom";

                return (
                  <div
                    key={sec.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => { e.preventDefault(); handleDragOver(idx); }}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                    className={`rounded-xl transition-all duration-150 ${isDropTarget ? "border-2 border-dashed border-primary-container/50 bg-primary-container/5" : isDragging ? "opacity-30 scale-95" : ""} ${!sec.visible ? "opacity-40" : ""} ${isExpanded ? "bg-surface-container shadow-sm ring-1 ring-primary-container/20" : "bg-surface-container-high/50 hover:bg-surface-container-high"}`}
                  >
                    {/* Block header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={() => setExpandedId(isExpanded ? null : sec.id)}>
                      {/* Drag handle */}
                      <span className="text-on-surface-variant/30 hover:text-on-surface-variant/60 cursor-grab active:cursor-grabbing shrink-0" onMouseDown={(e) => e.stopPropagation()}>
                        <Icon name="drag_indicator" size={16} />
                      </span>
                      {/* Icon + label */}
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${sec.visible ? "bg-primary-container/15" : "bg-surface-container-highest/50"}`}>
                        <Icon name={icon} size={14} className={sec.visible ? "text-primary-container" : "text-on-surface-variant/30"} />
                      </div>
                      <span className={`text-xs font-medium flex-1 truncate ${sec.visible ? "text-on-surface" : "text-on-surface-variant/50 line-through"}`}>{label}</span>
                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Move up/down */}
                        <button onClick={() => { if (idx > 0) { setSections((prev) => moveSection(prev, idx, idx - 1)); } }} disabled={idx === 0} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container disabled:opacity-20 disabled:cursor-not-allowed" title="上移">
                          <Icon name="expand_more" size={14} style={{ transform: "rotate(180deg)" }} />
                        </button>
                        <button onClick={() => { if (idx < sections.length - 1) { setSections((prev) => moveSection(prev, idx, idx + 1)); } }} disabled={idx === sections.length - 1} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container disabled:opacity-20 disabled:cursor-not-allowed" title="下移">
                          <Icon name="expand_more" size={14} />
                        </button>
                        {/* Delete (custom only) */}
                        {canDelete && (
                          <button onClick={() => removeSection(sec.id)} className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-error hover:bg-error/5" title="删除">
                            <Icon name="close" size={14} />
                          </button>
                        )}
                        {/* Visibility toggle */}
                        <button onClick={() => toggleVisible(sec.id)} className={`w-8 h-[18px] rounded-full transition-colors relative ${sec.visible ? "bg-primary-container" : "bg-outline/30"}`} title={sec.visible ? "隐藏" : "显示"}>
                          <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all duration-150 ${sec.visible ? "left-[15px]" : "left-[2px]"}`} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded config */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 mx-2 mb-1 border-t border-outline-variant/10">
                        <ConfigEditor sec={sec} onChange={(cfg) => updateSection(sec.id, cfg)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom actions */}
            <div className="px-3 py-3 border-t border-outline-variant/10 space-y-2">
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50">
                  {saving ? "保存中..." : "保存模板"}
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
          <PreviewPanel sections={sections} selectedId={expandedId} onSelect={handlePreviewSelect} onMoveUp={moveUp} onMoveDown={moveDown} />
        </div>
      </div>
    </div>
  );
}
