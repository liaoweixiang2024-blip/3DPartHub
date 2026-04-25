import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import useSWR from "swr";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import { useToast } from "../components/shared/Toast";
import { useAuthStore } from "../stores/useAuthStore";
import {
  getInquiry,
  sendInquiryMessage,
  cancelInquiry,
  quoteInquiry,
  updateInquiryStatus,
  type Inquiry,
  type InquiryMessage,
} from "../api/inquiries";

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "草稿", color: "text-on-surface-variant", bg: "bg-surface-container-highest" },
  submitted: { label: "已提交", color: "text-blue-500", bg: "bg-blue-500/10" },
  quoted: { label: "已报价", color: "text-green-600", bg: "bg-green-500/10" },
  accepted: { label: "已接受", color: "text-emerald-600", bg: "bg-emerald-500/10" },
  rejected: { label: "已拒绝", color: "text-red-500", bg: "bg-red-500/10" },
  cancelled: { label: "已取消", color: "text-on-surface-variant", bg: "bg-surface-container-highest" },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_MAP[status] || STATUS_MAP.submitted;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-bold ${info.color} ${info.bg}`}>
      {info.label}
    </span>
  );
}

// Message bubble
function MessageBubble({ msg }: { msg: InquiryMessage }) {
  const isRight = msg.isAdmin;
  return (
    <div className={`flex ${isRight ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
        isRight
          ? "bg-primary-container/15 text-on-surface"
          : "bg-surface-container-high text-on-surface"
      }`}>
        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        {msg.attachment && (
          <a href={msg.attachment} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-primary-container">
            <Icon name="attach_file" size={12} />附件
          </a>
        )}
        <div className="mt-1 text-[10px] text-on-surface-variant">
          {msg.user?.username || "用户"} · {new Date(msg.createdAt).toLocaleString("zh-CN")}
        </div>
      </div>
    </div>
  );
}

// Quote table for items
function ItemsTable({ items, adminMode, quotePrices, onPriceChange }: {
  items: Inquiry["items"];
  adminMode: boolean;
  quotePrices: Record<string, string>;
  onPriceChange: (id: string, val: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant/15">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-container-high">
            <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">型号/产品</th>
            <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">数量</th>
            <th className="px-4 py-2 text-left text-xs font-bold text-on-surface-variant">备注</th>
            <th className="px-4 py-2 text-right text-xs font-bold text-on-surface-variant">单价</th>
            <th className="px-4 py-2 text-right text-xs font-bold text-on-surface-variant">小计</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const price = item.unitPrice ? Number(item.unitPrice) : null;
            const inputPrice = quotePrices[item.id] ?? (price ? String(price) : "");
            const subtotal = inputPrice ? Number(inputPrice) * item.qty : null;
            return (
              <tr key={item.id} className="border-t border-outline-variant/5">
                <td className="px-4 py-2.5">
                  <p className="text-on-surface font-medium">{item.modelNo || item.productName}</p>
                  {item.modelNo && item.productName !== item.modelNo && (
                    <p className="text-xs text-on-surface-variant">{item.productName}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 text-on-surface">{item.qty}</td>
                <td className="px-4 py-2.5 text-xs text-on-surface-variant">{item.remark || "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {adminMode ? (
                    <input
                      type="number"
                      step="0.01"
                      value={inputPrice}
                      onChange={(e) => onPriceChange(item.id, e.target.value)}
                      placeholder="0.00"
                      className="w-24 text-right bg-surface-container-lowest text-on-surface text-sm rounded px-2 py-1 border border-outline-variant/20 outline-none focus:border-primary"
                    />
                  ) : (
                    <span className="text-on-surface">{price ? `¥${price.toFixed(2)}` : "—"}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-on-surface">
                  {subtotal !== null ? `¥${subtotal.toFixed(2)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailContent({ id }: { id: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: inquiry, mutate } = useSWR<Inquiry>(
    id ? `inquiry-${id}` : null,
    () => getInquiry(id),
    { refreshInterval: 5000 }
  );

  const [msgInput, setMsgInput] = useState("");
  const [quotePrices, setQuotePrices] = useState<Record<string, string>>({});
  const [totalAmount, setTotalAmount] = useState("");
  const [adminRemark, setAdminRemark] = useState("");
  const [sending, setSending] = useState(false);
  const [quoting, setQuoting] = useState(false);

  const prevMsgCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    const len = inquiry?.messages?.length;
    if (len !== undefined && prevMsgCount.current !== undefined && len > prevMsgCount.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMsgCount.current = len;
  }, [inquiry?.messages?.length]);

  if (!inquiry) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icon name="hourglass_empty" size={32} className="text-on-surface-variant/30 animate-spin" />
      </div>
    );
  }

  async function handleSendMsg() {
    if (!msgInput.trim()) return;
    setSending(true);
    try {
      await sendInquiryMessage(id, msgInput.trim());
      setMsgInput("");
      mutate();
    } catch {
      toast("发送失败", "error");
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    try {
      await cancelInquiry(id);
      mutate();
      toast("已取消", "success");
    } catch {
      toast("取消失败", "error");
    }
  }

  async function handleQuote() {
    setQuoting(true);
    try {
      const items = inquiry.items.map((it) => ({
        id: it.id,
        unitPrice: Number(quotePrices[it.id] || 0),
      }));
      const total = items.reduce((sum, it) => sum + it.unitPrice, 0);
      await quoteInquiry(id, {
        items,
        totalAmount: totalAmount ? Number(totalAmount) : total,
        adminRemark: adminRemark || undefined,
      });
      mutate();
      toast("报价已提交", "success");
    } catch {
      toast("报价失败", "error");
    } finally {
      setQuoting(false);
    }
  }

  async function handleStatusUpdate(status: string) {
    try {
      await updateInquiryStatus(id, status);
      mutate();
      toast(`状态已更新`, "success");
    } catch {
      toast("操作失败", "error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <button onClick={() => navigate(-1)} className="text-on-surface-variant hover:text-on-surface">
              <Icon name="arrow_back" size={20} />
            </button>
            <h2 className="font-headline text-xl font-bold text-on-surface">询价单详情</h2>
            <StatusBadge status={inquiry.status} />
          </div>
          <p className="text-xs text-on-surface-variant ml-8">
            {new Date(inquiry.createdAt).toLocaleString("zh-CN")}
            {inquiry.user && ` · ${inquiry.user.username}`}
            {inquiry.company && ` · ${inquiry.company}`}
          </p>
        </div>
        <div className="flex gap-2 ml-8 md:ml-0 flex-wrap">
          {(inquiry.status === "quoted" || inquiry.status === "accepted") && (
            <button onClick={() => navigate(`/quote/${inquiry.id}`)} className="px-4 py-2 text-sm font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 inline-flex items-center gap-1.5">
              <Icon name="receipt_long" size={16} />生成报价单
            </button>
          )}
          {inquiry.status === "submitted" && !isAdmin && (
            <button onClick={handleCancel} className="px-4 py-2 text-sm border border-outline-variant/40 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50">
              取消询价
            </button>
          )}
          {isAdmin && inquiry.status === "quoted" && (
            <>
              <button onClick={() => handleStatusUpdate("accepted")} className="px-4 py-2 text-sm font-medium bg-green-500/15 text-green-600 rounded-lg hover:opacity-90">
                接受
              </button>
              <button onClick={() => handleStatusUpdate("rejected")} className="px-4 py-2 text-sm font-medium bg-red-500/15 text-red-500 rounded-lg hover:opacity-90">
                拒绝
              </button>
            </>
          )}
        </div>
      </div>

      {/* Contact info */}
      {(inquiry.company || inquiry.contactName || inquiry.contactPhone) && (
        <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
          <h3 className="text-sm font-bold text-on-surface mb-2">联系信息</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {inquiry.company && <div><span className="text-on-surface-variant">公司：</span><span className="text-on-surface">{inquiry.company}</span></div>}
            {inquiry.contactName && <div><span className="text-on-surface-variant">联系人：</span><span className="text-on-surface">{inquiry.contactName}</span></div>}
            {inquiry.contactPhone && <div><span className="text-on-surface-variant">电话：</span><span className="text-on-surface">{inquiry.contactPhone}</span></div>}
          </div>
        </div>
      )}

      {/* Quote table */}
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-2">产品明细</h3>
        <ItemsTable
          items={inquiry.items}
          adminMode={isAdmin && inquiry.status === "submitted"}
          quotePrices={quotePrices}
          onPriceChange={(itemId, val) => setQuotePrices((prev) => ({ ...prev, [itemId]: val }))}
        />
      </div>

      {/* Admin quote action */}
      {isAdmin && inquiry.status === "submitted" && (
        <div className="rounded-lg border border-primary-container/20 bg-primary-container/5 p-4 space-y-3">
          <h3 className="text-sm font-bold text-on-surface">提交报价</h3>
          <div className="grid gap-3 grid-cols-2">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">总金额</label>
              <input
                type="number"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="自动计算"
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">备注</label>
              <input
                value={adminRemark}
                onChange={(e) => setAdminRemark(e.target.value)}
                placeholder="有效期、含税等"
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded-md px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary"
              />
            </div>
          </div>
          <button
            onClick={handleQuote}
            disabled={quoting}
            className="px-6 py-2.5 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {quoting ? "提交中..." : "确认报价"}
          </button>
        </div>
      )}

      {/* Admin remark (displayed after quote) */}
      {inquiry.adminRemark && (
        <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
          <h3 className="text-sm font-bold text-on-surface mb-1">管理员备注</h3>
          <p className="text-sm text-on-surface-variant">{inquiry.adminRemark}</p>
        </div>
      )}

      {/* Total amount */}
      {inquiry.totalAmount && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-on-surface">报价总额</span>
          <span className="text-xl font-headline font-bold text-green-600">¥{Number(inquiry.totalAmount).toFixed(2)}</span>
        </div>
      )}

      {/* User remark */}
      {inquiry.remark && (
        <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
          <h3 className="text-sm font-bold text-on-surface mb-1">用户备注</h3>
          <p className="text-sm text-on-surface-variant">{inquiry.remark}</p>
        </div>
      )}

      {/* Messages */}
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-3">沟通记录</h3>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
          {(inquiry.messages || []).length === 0 ? (
            <p className="text-center text-sm text-on-surface-variant py-6">暂无消息</p>
          ) : (
            (inquiry.messages || []).map((msg) => <MessageBubble key={msg.id} msg={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message input */}
        {(inquiry.status !== "cancelled" && inquiry.status !== "draft") && (
          <div className="mt-3 flex gap-2">
            <input
              value={msgInput}
              onChange={(e) => setMsgInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendMsg()}
              placeholder="输入消息..."
              className="flex-1 bg-surface-container-lowest text-on-surface text-sm rounded-lg px-4 py-2.5 border border-outline-variant/20 outline-none focus:border-primary-container"
            />
            <button
              onClick={handleSendMsg}
              disabled={sending || !msgInput.trim()}
              className="px-4 py-2.5 text-sm font-medium bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              发送
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle("询价单详情");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  const content = <DetailContent id={id!} />;

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            {content}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((p) => !p)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto px-4 py-5 pb-6 scrollbar-hidden bg-surface-dim">
        {content}
      </main>
      <BottomNav />
    </div>
  );
}
