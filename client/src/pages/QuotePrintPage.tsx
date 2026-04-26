import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import useSWR from "swr";
import { getInquiry, type Inquiry } from "../api/inquiries";
import { getSiteTitle, getSiteLogo, getContactEmail, getContactAddress, getCachedPublicSettings } from "../lib/publicSettings";
import { useAuthStore } from "../stores/useAuthStore";
import {
  DEFAULT_SECTIONS,
  DEFAULT_CONTRACT_SECTIONS,
  DEFAULT_QUOTE_PAGE,
  DEFAULT_CONTRACT_PAGE,
  parseDocumentTemplates,
  type TemplateSection,
  type TemplatePageConfig,
  type QuoteTemplate,
  type DocumentTemplateKind,
} from "../lib/quoteTemplate";

/** Convert a remote image URL to a data-URL so it prints reliably */
function usePrintableLogo() {
  const src = getSiteLogo();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setDataUrl(""); return; }
    // If already a data URL, use directly
    if (src.startsWith("data:")) { setDataUrl(src); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 200;
        canvas.height = img.naturalHeight || 200;
        canvas.getContext("2d")?.drawImage(img, 0, 0);
        setDataUrl(canvas.toDataURL("image/png"));
      } catch {
        // CORS blocked — try fetching as blob and converting
        fetch(src, { mode: "cors" })
          .then((r) => r.blob())
          .then((blob) => {
            const reader = new FileReader();
            reader.onload = () => setDataUrl(reader.result as string);
            reader.onerror = () => setDataUrl(src);
            reader.readAsDataURL(blob);
          })
          .catch(() => setDataUrl(src));
      }
    };
    img.onerror = () => setDataUrl(src);
    img.src = src;
  }, [src]);
  return dataUrl;
}

// ── Section renderers ──

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pageDefaults(kind: DocumentTemplateKind): TemplatePageConfig {
  return kind === "quote" ? DEFAULT_QUOTE_PAGE : DEFAULT_CONTRACT_PAGE;
}

function pageCss(page: TemplatePageConfig): { width: number; minHeight: number; padding: string; fontSize: number } {
  const isA5 = page.paperSize === "A5";
  const landscape = page.orientation === "landscape";
  const width = isA5 ? 560 : 800;
  const height = isA5 ? 794 : 1131;
  return {
    width: landscape ? height : width,
    minHeight: landscape ? width : height,
    padding: `${num(page.marginY, 18)}mm ${num(page.marginX, 18)}mm 18mm`,
    fontSize: num(page.baseFontSize, 14),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTemplateText(value: unknown, vars: Vars): string {
  const map: Record<string, string> = {
    报价单号: vars.quoteNo,
    合同编号: vars.contractNo,
    单据日期: vars.date,
    客户公司: vars.company,
    联系人: vars.contactName,
    联系电话: vars.contactPhone,
    报价总额: `¥${vars.totalAmount}`,
    公司名称: vars.siteTitle,
    联系邮箱: vars.contactEmail,
    备注: vars.remark,
  };
  return escapeHtml(value).replace(/\{\{([^}]+)\}\}/g, (_, key) => escapeHtml(map[String(key).trim()] ?? ""));
}

function sectionStyle(sec: TemplateSection): React.CSSProperties {
  const c = sec.config;
  const borderMode = (c.borderMode as string) || "none";
  const style: React.CSSProperties = {
    fontSize: num(c.fontSize, 14),
    textAlign: ((c.align as string) || "left") as React.CSSProperties["textAlign"],
    padding: num(c.padding, 0),
    marginBottom: num(c.marginBottom, 24),
    background: (c.background as string) || "transparent",
  };
  if (borderMode === "box") style.border = "1px solid #d1d5db";
  if (borderMode === "dashed") style.border = "1px dashed #9ca3af";
  if (borderMode === "bottom") style.borderBottom = "1px solid #111";
  if (style.border || style.borderBottom) style.borderRadius = 4;
  return style;
}

function renderHeader(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const title = c.title || (vars.documentKind === "contract" ? "购 销 合 同" : "报 价 单");
  const subtitle = c.subtitle || (vars.documentKind === "contract" ? "SALES CONTRACT" : "QUOTATION");
  const logoHtml = c.showLogo && vars.siteLogo ? `<img src="${vars.siteLogo}" alt="" style="height:40px;object-fit:contain" />` : "";
  const subtitleHtml = c.showSubtitle ? `<p style="font-size:12px;color:#999;margin:4px 0 0">${subtitle}</p>` : "";
  return `<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:12px">${logoHtml}<h1 style="font-size:20px;font-weight:700;color:#111;margin:0">${vars.siteTitle}</h1></div>
    <div style="text-align:right"><h2 style="font-size:24px;font-weight:700;color:#111;margin:0;letter-spacing:4px">${title}</h2>${subtitleHtml}</div>
  </div>`;
}

function renderMeta(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const lines: string[] = [];
  if (c.showQuoteNo) lines.push(metaLine("报价单号", vars.quoteNo));
  if (c.showContractNo) lines.push(metaLine("合同编号", vars.contractNo));
  if (c.showDate) lines.push(metaLine(vars.documentKind === "contract" ? "合 同 日 期" : "报 价 日 期", vars.date));
  if (c.showValidDays) lines.push(metaLine("有 效 期", `${c.validDays || "30"}天`));
  return `<div style="font-size:14px;margin-bottom:24px">${lines.join("")}</div>`;
}

function renderClient(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const lines: string[] = [];
  if (c.showCompany) lines.push(metaLine("客户公司", vars.company));
  if (c.showContact) lines.push(metaLine("联 系 人", vars.contactName));
  if (c.showPhone) lines.push(metaLine("联系电话", vars.contactPhone));
  return `<div style="font-size:14px;margin-bottom:24px">${lines.join("")}</div>`;
}

function renderTable(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const thS = "border:1px solid #d1d5db;padding:8px 12px;font-weight:500;color:#374151;font-size:13px;background:#f3f4f6";
  const tdS = "border:1px solid #d1d5db;padding:8px 12px";

  // Build header
  const heads: string[] = [];
  if (c.showIndex) heads.push(`<th style="${thS}">序号</th>`);
  heads.push(`<th style="${thS};text-align:left">名称</th>`);
  heads.push(`<th style="${thS};text-align:left">型号</th>`);
  heads.push(`<th style="${thS};text-align:center">单位</th>`);
  heads.push(`<th style="${thS};text-align:center">数量</th>`);
  if (c.showPrice) heads.push(`<th style="${thS};text-align:right">未税单价</th>`);
  if (c.showPrice) heads.push(`<th style="${thS};text-align:right">含税单价</th>`);
  if (c.showSubtotal) heads.push(`<th style="${thS};text-align:right">未税小计</th>`);
  if (c.showSubtotal) heads.push(`<th style="${thS};text-align:right">含税小计</th>`);

  // Tax rate (default 13%)
  const taxRate = 0.13;

  // Build rows
  const rows = vars.items.map((item: any, i: number) => {
    const price = item.unitPrice ? Number(item.unitPrice) : 0;
    const priceWithTax = price * (1 + taxRate);
    const subtotal = price * item.qty;
    const subtotalWithTax = priceWithTax * item.qty;
    const cells: string[] = [];
    if (c.showIndex) cells.push(`<td style="${tdS}">${i + 1}</td>`);
    // Remove modelNo from productName to avoid duplication
    const cleanName = item.productName && item.modelNo
      ? item.productName.replace(item.modelNo, "").replace(/[\s\-—_]+$/g, "").replace(/^[\s\-—_]+/g, "") || item.productName
      : item.productName || "—";
    cells.push(`<td style="${tdS}">${cleanName}</td>`);
    cells.push(`<td style="${tdS}">${item.modelNo || "—"}</td>`);
    cells.push(`<td style="${tdS};text-align:center">${item.unit || "个"}</td>`);
    cells.push(`<td style="${tdS};text-align:center">${item.qty}</td>`);
    if (c.showPrice) cells.push(`<td style="${tdS};text-align:right">${price ? price.toFixed(2) : "—"}</td>`);
    if (c.showPrice) cells.push(`<td style="${tdS};text-align:right">${price ? priceWithTax.toFixed(2) : "—"}</td>`);
    if (c.showSubtotal) cells.push(`<td style="${tdS};text-align:right">${subtotal ? subtotal.toFixed(2) : "—"}</td>`);
    if (c.showSubtotal) cells.push(`<td style="${tdS};text-align:right">${subtotalWithTax ? subtotalWithTax.toFixed(2) : "—"}</td>`);
    return `<tr style="background:${i % 2 === 1 ? "#f9fafb" : "white"}">${cells.join("")}</tr>`;
  }).join("");

  const total = Number(vars.totalAmount) || 0;
  const totalWithTax = total * (1 + taxRate);

  // Build tfoot: separate cells for each column
  const footCells: string[] = [];
  if (c.showIndex) footCells.push(`<td style="${tdS}"></td>`);
  footCells.push(`<td style="${tdS}"></td>`);
  footCells.push(`<td style="${tdS}"></td>`);
  footCells.push(`<td style="${tdS}"></td>`);
  footCells.push(`<td style="${tdS}"></td>`);
  if (c.showPrice) footCells.push(`<td style="${tdS}"></td>`);
  if (c.showPrice) footCells.push(`<td style="${tdS}"></td>`);
  if (c.showSubtotal) footCells.push(`<td style="${tdS};text-align:right;font-size:16px">¥${total.toFixed(2)}</td>`);
  if (c.showSubtotal) footCells.push(`<td style="${tdS};text-align:right;font-size:16px">¥${totalWithTax.toFixed(2)}</td>`);

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
    <thead><tr>${heads.join("")}</tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr style="background:#f3f4f6;font-weight:700">
      ${footCells.map((c, i) => i === footCells.length - 2 || i === footCells.length - 1 ? c : c).join("")}
    </tr></tfoot>
  </table>`;
}

function renderRemark(sec: TemplateSection, vars: Vars): string {
  if (!vars.remark) return "";
  return `<div style="border:1px solid #e5e7eb;border-radius:4px;padding:12px;margin-bottom:24px;font-size:14px">
    <p style="font-weight:500;color:#374151;margin-bottom:4px">备注</p>
    <p style="color:#666;white-space:pre-wrap;margin:0">${vars.remark}</p>
  </div>`;
}

function renderCustom(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const title = c.title || "";
  const content = c.content || "";
  if (!title && !content) return "";
  return `<div style="margin-bottom:24px;font-size:14px">
    ${title ? `<p style="font-weight:500;color:#374151;margin-bottom:4px">${renderTemplateText(title, vars)}</p>` : ""}
    ${content ? `<div style="color:#666;white-space:pre-wrap">${renderTemplateText(content, vars)}</div>` : ""}
  </div>`;
}

function renderFieldGrid(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const rows = String(c.rows || "").split("\n").filter(Boolean);
  if (!rows.length) return "";
  const body = rows.map((row) => `<tr>${row.split("|").map((cell) => `<td style="border:1px solid #d1d5db;padding:8px 10px">${renderTemplateText(cell.trim(), vars)}</td>`).join("")}</tr>`).join("");
  return `<div style="margin-bottom:24px;font-size:14px">
    ${c.title ? `<p style="font-weight:600;color:#374151;margin:0 0 8px">${renderTemplateText(c.title, vars)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse">${body}</table>
  </div>`;
}

function renderTerms(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const title = c.title || "合同条款";
  const content = c.content || "";
  if (!title && !content) return "";
  return `<div style="margin-bottom:24px;font-size:14px;line-height:1.8">
    ${title ? `<p style="font-weight:600;color:#374151;margin:0 0 8px">${renderTemplateText(title, vars)}</p>` : ""}
    ${content ? `<div style="color:#444;white-space:pre-wrap">${renderTemplateText(content, vars)}</div>` : ""}
  </div>`;
}

function renderSignature(sec: TemplateSection, vars: Vars): string {
  const dateLine = sec.config.showDate ? `<p style="margin:22px 0 0">日期：${vars.date}</p>` : "";
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;margin:36px 0 28px;font-size:14px;color:#111">
    <div>
      <p style="font-weight:600;margin:0 0 28px">甲方（采购方）：${vars.company !== "—" ? vars.company : ""}</p>
      <p style="margin:0">授权代表：</p>
      <p style="margin:22px 0 0">签章：</p>
      ${dateLine}
    </div>
    <div>
      <p style="font-weight:600;margin:0 0 28px">乙方（供货方）：${vars.siteTitle}</p>
      <p style="margin:0">授权代表：</p>
      <p style="margin:22px 0 0">签章：</p>
      ${dateLine}
    </div>
  </div>`;
}

function renderFooter(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const leftLines: string[] = [];
  if (c.showCompany) leftLines.push(`<p style="font-weight:500;color:#374151">${vars.siteTitle}</p>`);
  if (c.showEmail && vars.contactEmail) leftLines.push(`<p>邮箱：${vars.contactEmail}</p>`);
  if (vars.contactPhone) leftLines.push(`<p>电话：${vars.contactPhone}</p>`);
  if (vars.contactAddress) leftLines.push(`<p>地址：${vars.contactAddress}</p>`);

  const rightLines: string[] = [];
  if (c.showGenerated) rightLines.push(`<p>本报价单由系统自动生成</p>`);
  if (c.showDate) rightLines.push(`<p>${vars.date}</p>`);

  return `<div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#999">
    <div style="display:flex;justify-content:space-between">
      <div>${leftLines.join("")}</div>
      <div style="text-align:right">${rightLines.join("")}</div>
    </div>
  </div>`;
}

function metaLine(label: string, value: string): string {
  return `<p><span style="color:#888">${label}：</span><span style="font-weight:500">${value}</span></p>`;
}

// ── Types ──

interface Vars {
  documentKind: DocumentTemplateKind;
  siteTitle: string;
  siteLogo: string;
  quoteNo: string;
  contractNo: string;
  date: string;
  company: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactAddress: string;
  validDays: string;
  items: any[];
  totalAmount: string;
  remark: string;
}

// ── Main component ──

export default function QuotePrintPage() {
  const { id, type } = useParams<{ id: string; type?: string }>();
  const documentKind: DocumentTemplateKind = type === "contract" ? "contract" : "quote";
  const { isAuthenticated } = useAuthStore();
  const { data: inquiry } = useSWR<Inquiry>(id ? `${documentKind}-${id}` : null, () => getInquiry(id!));
  const [template, setTemplate] = useState<QuoteTemplate | null>(null);
  const printLogo = usePrintableLogo();

  useEffect(() => {
    getCachedPublicSettings().then((s) => {
      const parsed = parseDocumentTemplates((s.document_templates as string) || "", (s.quote_template as string) || "");
      setTemplate(documentKind === "contract" ? parsed.contract : parsed.quote);
    });
  }, [documentKind]);

  useEffect(() => {
    const root = document.getElementById("root")!;
    const html = document.documentElement;
    const body = document.body;
    const prev = { rBg: root.style.background, rC: root.style.color, hBg: html.style.background, bBg: body.style.background, bC: body.style.color };
    root.style.background = "white"; root.style.color = "#000";
    html.style.background = "white"; body.style.background = "white"; body.style.color = "#000";
  const style = document.createElement("style");
    style.id = "quote-print-styles";
    style.textContent = `@media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } body { margin:0; padding:0; } .print-hide { display: none !important; } .print-page { box-shadow:none !important; margin:0 !important; width:auto !important; min-height:auto !important; } }`;
    document.head.appendChild(style);
    return () => { Object.assign(root.style, { background: prev.rBg, color: prev.rC }); Object.assign(html.style, { background: prev.hBg }); Object.assign(body.style, { background: prev.bBg, color: prev.bC }); style.remove(); };
  }, []);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Wait for logo to load before rendering (print reliability)
  if (printLogo === null && getSiteLogo()) return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>加载中...</div>;
  if (!inquiry) return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>加载中...</div>;
  if (inquiry.status !== "quoted" && inquiry.status !== "accepted") return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>该询价单尚未报价，无法生成单据</div>;
  if (documentKind === "contract" && inquiry.status !== "accepted") return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>报价确认后才能生成合同</div>;

  const siteTitle = getSiteTitle();
  const contactEmail = getContactEmail();
  const items = inquiry.items || [];
  const totalCalc = items.reduce((sum, it) => sum + (it.unitPrice ? Number(it.unitPrice) * it.qty : 0), 0);
  const total = inquiry.totalAmount ? Number(inquiry.totalAmount) : totalCalc;

  const vars: Vars = {
    documentKind,
    siteTitle,
    siteLogo: printLogo || "",
    quoteNo: `QT-${inquiry.id.slice(0, 8).toUpperCase()}`,
    contractNo: `HT-${inquiry.id.slice(0, 8).toUpperCase()}`,
    date: new Date(inquiry.updatedAt).toLocaleDateString("zh-CN"),
    company: inquiry.company || "—",
    contactName: inquiry.contactName || "—",
    contactPhone: inquiry.contactPhone || "—",
    contactEmail: contactEmail || "",
    contactAddress: getContactAddress(),
    validDays: "30",
    items,
    totalAmount: total.toFixed(2),
    remark: inquiry.adminRemark || "",
  };

  // Render sections to HTML
  const sections = template?.sections || (documentKind === "contract" ? DEFAULT_CONTRACT_SECTIONS : DEFAULT_SECTIONS);
  const page = { ...pageDefaults(documentKind), ...template?.page };
  const computedPage = pageCss(page);
  const html = sections
    .filter((s) => s.visible)
    .map((sec) => {
      let content = "";
      switch (sec.type) {
        case "header": content = renderHeader(sec, vars); break;
        case "meta": content = renderMeta(sec, vars); break;
        case "client": content = renderClient(sec, vars); break;
        case "table": content = renderTable(sec, vars); break;
        case "fieldGrid": content = renderFieldGrid(sec, vars); break;
        case "remark": content = renderRemark(sec, vars); break;
        case "terms": content = renderTerms(sec, vars); break;
        case "signature": content = renderSignature(sec, vars); break;
        case "footer": content = renderFooter(sec, vars); break;
        case "custom": content = renderCustom(sec, vars); break;
        default: content = "";
      }
      return content ? `<div style="${styleToInline(sectionStyle(sec))}">${content}</div>` : "";
    })
    .join("\n");

  return (
    <div style={{ background: "white", color: "#000", fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif' }}>
      <div className="print-hide" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 50 }}>
        <span style={{ fontSize: 14, color: "#666" }}>{documentKind === "contract" ? "合同预览" : "报价单预览"}</span>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 500, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>打印 / 另存为 PDF</button>
          <button onClick={() => window.history.back()} style={{ padding: "8px 16px", fontSize: 14, color: "#666", background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>返回</button>
        </div>
      </div>
      <div className="print-hide" style={{ height: 52 }} />
      <div className="print-page" style={{ width: computedPage.width, minHeight: computedPage.minHeight, margin: "0 auto", background: "white", color: "#000", padding: computedPage.padding, fontSize: computedPage.fontSize, boxShadow: "0 12px 36px rgba(15,23,42,.08)", fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function styleToInline(style: React.CSSProperties): string {
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${typeof value === "number" ? `${value}px` : value}`)
    .join(";");
}
