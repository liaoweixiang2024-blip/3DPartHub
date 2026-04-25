import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import useSWR from "swr";
import { getInquiry, type Inquiry } from "../api/inquiries";
import { getSiteTitle, getSiteLogo, getContactEmail, getContactAddress, getCachedPublicSettings } from "../lib/publicSettings";
import { useAuthStore } from "../stores/useAuthStore";
import {
  DEFAULT_SECTIONS,
  parseTemplate,
  type TemplateSection,
  type QuoteTemplate,
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

function renderHeader(sec: TemplateSection, vars: Vars): string {
  const c = sec.config;
  const title = c.title || "报 价 单";
  const subtitle = c.subtitle || "QUOTATION";
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
  if (c.showDate) lines.push(metaLine("报 价 日 期", vars.date));
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

function renderCustom(sec: TemplateSection): string {
  const c = sec.config;
  const title = c.title || "";
  const content = c.content || "";
  if (!title && !content) return "";
  return `<div style="margin-bottom:24px;font-size:14px">
    ${title ? `<p style="font-weight:500;color:#374151;margin-bottom:4px">${title}</p>` : ""}
    ${content ? `<div style="color:#666;white-space:pre-wrap">${content}</div>` : ""}
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
  siteTitle: string;
  siteLogo: string;
  quoteNo: string;
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
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuthStore();
  const { data: inquiry } = useSWR<Inquiry>(id ? `quote-${id}` : null, () => getInquiry(id!));
  const [template, setTemplate] = useState<QuoteTemplate | null>(null);
  const printLogo = usePrintableLogo();

  useEffect(() => {
    getCachedPublicSettings().then((s) => {
      const parsed = parseTemplate((s.quote_template as string) || "");
      setTemplate(parsed || { sections: DEFAULT_SECTIONS });
    });
  }, []);

  useEffect(() => {
    const root = document.getElementById("root")!;
    const html = document.documentElement;
    const body = document.body;
    const prev = { rBg: root.style.background, rC: root.style.color, hBg: html.style.background, bBg: body.style.background, bC: body.style.color };
    root.style.background = "white"; root.style.color = "#000";
    html.style.background = "white"; body.style.background = "white"; body.style.color = "#000";
    const style = document.createElement("style");
    style.id = "quote-print-styles";
    style.textContent = `@media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } body { margin:0; padding:0; } .print-hide { display: none !important; } }`;
    document.head.appendChild(style);
    return () => { Object.assign(root.style, { background: prev.rBg, color: prev.rC }); Object.assign(html.style, { background: prev.hBg }); Object.assign(body.style, { background: prev.bBg, color: prev.bC }); style.remove(); };
  }, []);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Wait for logo to load before rendering (print reliability)
  if (printLogo === null && getSiteLogo()) return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>加载中...</div>;
  if (!inquiry) return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>加载中...</div>;
  if (inquiry.status !== "quoted" && inquiry.status !== "accepted") return <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>该询价单尚未报价，无法生成报价单</div>;

  const siteTitle = getSiteTitle();
  const contactEmail = getContactEmail();
  const items = inquiry.items || [];
  const totalCalc = items.reduce((sum, it) => sum + (it.unitPrice ? Number(it.unitPrice) * it.qty : 0), 0);
  const total = inquiry.totalAmount ? Number(inquiry.totalAmount) : totalCalc;

  const vars: Vars = {
    siteTitle,
    siteLogo: printLogo || "",
    quoteNo: `QT-${inquiry.id.slice(0, 8).toUpperCase()}`,
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
  const sections = template?.sections || DEFAULT_SECTIONS;
  const html = sections
    .filter((s) => s.visible)
    .map((sec) => {
      switch (sec.type) {
        case "header": return renderHeader(sec, vars);
        case "meta": return renderMeta(sec, vars);
        case "client": return renderClient(sec, vars);
        case "table": return renderTable(sec, vars);
        case "remark": return renderRemark(sec, vars);
        case "footer": return renderFooter(sec, vars);
        case "custom": return renderCustom(sec);
        default: return "";
      }
    })
    .join("\n");

  return (
    <div style={{ background: "white", color: "#000", fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif' }}>
      <div className="print-hide" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 50 }}>
        <span style={{ fontSize: 14, color: "#666" }}>报价单预览</span>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 500, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>打印 / 另存为 PDF</button>
          <button onClick={() => window.history.back()} style={{ padding: "8px 16px", fontSize: 14, color: "#666", background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>返回</button>
        </div>
      </div>
      <div className="print-hide" style={{ height: 52 }} />
      <div style={{ maxWidth: 800, margin: "0 auto", background: "white", color: "#000", padding: "24px 16px 48px", fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
