import { useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import useSWR from "swr";
import { getInquiry, type Inquiry } from "../api/inquiries";
import { getSiteTitle, getSiteLogo, getContactEmail } from "../lib/publicSettings";
import { useAuthStore } from "../stores/useAuthStore";

export default function QuotePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuthStore();
  const { data: inquiry } = useSWR<Inquiry>(id ? `quote-${id}` : null, () => getInquiry(id!));

  // Force white background for the whole page while mounted
  useEffect(() => {
    const root = document.getElementById("root")!;
    const html = document.documentElement;
    const body = document.body;

    const prev = {
      rootBg: root.style.background,
      rootColor: root.style.color,
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      bodyColor: body.style.color,
    };

    root.style.background = "white";
    root.style.color = "#000";
    html.style.background = "white";
    body.style.background = "white";
    body.style.color = "#000";

    return () => {
      root.style.background = prev.rootBg;
      root.style.color = prev.rootColor;
      html.style.background = prev.htmlBg;
      body.style.background = prev.bodyBg;
      body.style.color = prev.bodyColor;
    };
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!inquiry) {
    return (
      <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
        加载中...
      </div>
    );
  }

  if (inquiry.status !== "quoted" && inquiry.status !== "accepted") {
    return (
      <div style={{ background: "white", color: "#999", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
        该询价单尚未报价，无法生成报价单
      </div>
    );
  }

  const siteTitle = getSiteTitle();
  const siteLogo = getSiteLogo();
  const contactEmail = getContactEmail();
  const items = inquiry.items || [];
  const totalCalc = items.reduce((sum, it) => sum + (it.unitPrice ? Number(it.unitPrice) * it.qty : 0), 0);
  const total = inquiry.totalAmount ? Number(inquiry.totalAmount) : totalCalc;
  const quoteNo = `QT-${inquiry.id.slice(0, 8).toUpperCase()}`;
  const date = new Date(inquiry.updatedAt).toLocaleDateString("zh-CN");

  return (
    <div style={{ background: "white", color: "#000", fontFamily: '"Noto Sans SC","Inter",system-ui,sans-serif' }}>
      {/* Screen-only toolbar */}
      <div className="print:hidden" style={{ position: "fixed", top: 0, left: 0, right: 0, background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 50 }}>
        <span style={{ fontSize: 14, color: "#666" }}>报价单预览</span>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={() => window.print()} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 500, background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}>
            打印 / 另存为 PDF
          </button>
          <button onClick={() => window.history.back()} style={{ padding: "8px 16px", fontSize: 14, color: "#666", background: "white", border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer" }}>
            返回
          </button>
        </div>
      </div>

      {/* Spacer for fixed toolbar */}
      <div className="print:hidden" style={{ height: 52 }} />

      {/* Printable content */}
      <div style={{ maxWidth: 800, margin: "0 auto", background: "white", color: "#000", padding: "24px 16px 48px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #111", paddingBottom: 16, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {siteLogo && <img src={siteLogo} alt="" style={{ height: 40, objectFit: "contain" }} />}
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111", margin: 0 }}>{siteTitle}</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#111", margin: 0, letterSpacing: 4 }}>报 价 单</h2>
            <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0" }}>QUOTATION</p>
          </div>
        </div>

        {/* Meta info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24, fontSize: 14 }}>
          <div>
            <p><span style={{ color: "#888" }}>报价单号：</span><span style={{ fontWeight: 500 }}>{quoteNo}</span></p>
            <p><span style={{ color: "#888" }}>报 价 日 期：</span><span style={{ fontWeight: 500 }}>{date}</span></p>
            <p><span style={{ color: "#888" }}>有 效 期：</span><span style={{ fontWeight: 500 }}>{inquiry.adminRemark?.match(/有效期\D*(\d+)/)?.[1] || "30"}天</span></p>
          </div>
          <div>
            <p><span style={{ color: "#888" }}>客户公司：</span><span style={{ fontWeight: 500 }}>{inquiry.company || "—"}</span></p>
            <p><span style={{ color: "#888" }}>联 系 人：</span><span style={{ fontWeight: 500 }}>{inquiry.contactName || "—"}</span></p>
            <p><span style={{ color: "#888" }}>联系电话：</span><span style={{ fontWeight: 500 }}>{inquiry.contactPhone || "—"}</span></p>
          </div>
        </div>

        {/* Items table */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginBottom: 24 }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={thStyle}>序号</th>
              <th style={{ ...thStyle, textAlign: "left" }}>型号 / 产品</th>
              <th style={{ ...thStyle, textAlign: "left" }}>规格</th>
              <th style={{ ...thStyle, textAlign: "center" }}>数量</th>
              <th style={{ ...thStyle, textAlign: "right" }}>单价 (元)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>小计 (元)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const price = item.unitPrice ? Number(item.unitPrice) : 0;
              const subtotal = price * item.qty;
              const specStr = item.specs
                ? Object.entries(item.specs as Record<string, string>)
                    .filter(([, v]) => v && v !== "—")
                    .map(([k, v]) => `${k}:${v}`)
                    .join("  ")
                : "";
              return (
                <tr key={item.id} style={{ background: i % 2 === 1 ? "#f9fafb" : "white" }}>
                  <td style={tdStyle}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{item.modelNo || item.productName}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "#666", maxWidth: 200 }}>{specStr || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{item.qty}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{price ? price.toFixed(2) : "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{subtotal ? subtotal.toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f3f4f6", fontWeight: 700 }}>
              <td colSpan={5} style={{ ...tdStyle, textAlign: "right" }}>合 计</td>
              <td style={{ ...tdStyle, textAlign: "right", fontSize: 16 }}>¥{total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Remarks */}
        {inquiry.adminRemark && (
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, padding: 12, marginBottom: 24, fontSize: 14 }}>
            <p style={{ fontWeight: 500, color: "#374151", marginBottom: 4 }}>备注</p>
            <p style={{ color: "#666", whiteSpace: "pre-wrap", margin: 0 }}>{inquiry.adminRemark}</p>
          </div>
        )}

        {/* Footer contact */}
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, fontSize: 12, color: "#999" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontWeight: 500, color: "#374151" }}>{siteTitle}</p>
              {contactEmail && <p>邮箱：{contactEmail}</p>}
            </div>
            <div style={{ textAlign: "right" }}>
              <p>本报价单由系统自动生成</p>
              <p>{date}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "8px 12px",
  fontWeight: 500,
  color: "#374151",
  fontSize: 13,
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "8px 12px",
};
