import { useRef, useEffect, useState, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/useAuthStore";
import Icon from "./Icon";

export const userNav = [
  // 浏览
  { label: "模型库", icon: "dashboard", path: "/" },
  { label: "产品选型", icon: "tune", path: "/selection" },
  // 我的
  { label: "我的收藏", icon: "star", path: "/favorites" },
  { label: "我的询价", icon: "request_quote", path: "/my-inquiries" },
  { label: "下载历史", icon: "download", path: "/downloads" },
  // 服务
  { label: "我的工单", icon: "assignment_add", path: "/my-tickets" },
  { label: "技术支持", icon: "support_agent", path: "/support" },
];

export const adminNav = [
  // 常用功能
  { label: "模型库", icon: "dashboard", path: "/" },
  { label: "产品选型", icon: "tune", path: "/selection" },
  { label: "我的收藏", icon: "star", path: "/favorites" },
  { label: "我的询价", icon: "request_quote", path: "/my-inquiries" },
  { label: "下载历史", icon: "download", path: "/downloads" },
  // 内容管理
  { label: "模型管理", icon: "view_in_ar", path: "/admin/models" },
  { label: "分类管理", icon: "folder", path: "/admin/categories" },
  { label: "选型管理", icon: "tune", path: "/admin/selections" },
  // 客户服务
  { label: "询价管理", icon: "receipt_long", path: "/admin/inquiries" },
  { label: "报价模板", icon: "description", path: "/admin/quote-template" },
  { label: "工单处理", icon: "build", path: "/admin/tickets" },
  // 系统
  { label: "用户管理", icon: "group", path: "/admin/users" },
  { label: "分享管理", icon: "share", path: "/admin/shares" },
  { label: "操作日志", icon: "schedule", path: "/admin/audit" },
  { label: "系统设置", icon: "settings", path: "/admin/settings" },
  { label: "技术支持", icon: "support_agent", path: "/support" },
];

const footerNav = [
  { label: "个人设置", icon: "settings", path: "/profile" },
  { label: "退出登录", icon: "logout", path: "" },
];

const navCls = (active: boolean) =>
  `flex items-center gap-4 px-6 py-3 text-sm transition-colors duration-150 cursor-pointer rounded-sm border-l-4 ${
    active
      ? "text-primary-container border-primary-container bg-surface-container-high font-bold"
      : "text-on-surface-variant border-transparent hover:bg-surface-container-high hover:text-on-surface"
  }`;

export default function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";
  const navItems = isAdmin ? adminNav : userNav;
  const activeRef = useRef<HTMLAnchorElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

  const checkOverflow = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setOverflow({
      top: el.scrollTop > 4,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    });
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = navRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkOverflow);
    return () => el.removeEventListener("scroll", checkOverflow);
  }, [checkOverflow, navItems]);

  useEffect(() => {
    const el = activeRef.current;
    const container = navRef.current;
    if (!el || !container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [location.pathname]);

  return (
    <aside className="hidden md:flex w-56 h-full flex-col py-4 bg-surface-container-low border-r border-outline-variant/20 shrink-0">
      {/* Top fade */}
      <div className={`relative shrink-0 px-3 transition-opacity duration-200 ${overflow.top ? "opacity-100" : "opacity-0"}`}>
        <div className="h-4 bg-gradient-to-b from-surface-container-low to-transparent pointer-events-none" />
      </div>

      <nav ref={navRef} className="flex-1 px-3 flex flex-col gap-1 overflow-y-auto scrollbar-hidden -mt-4">
        {navItems.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <Link key={item.path} to={item.path} ref={isActive ? activeRef : undefined} className={navCls(isActive)}>
              <Icon name={item.icon} size={24} />
              <span className="font-headline uppercase tracking-widest">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom fade */}
      <div className={`relative shrink-0 px-3 transition-opacity duration-200 ${overflow.bottom ? "opacity-100" : "opacity-0"}`}>
        <div className="h-4 bg-gradient-to-t from-surface-container-low to-transparent pointer-events-none" />
      </div>

      <div className="px-3 mt-auto">
        <div className="border-t border-outline-variant/20 my-3 pt-4 flex flex-col gap-1">
          {footerNav.map((item) => {
            if (item.path === "") {
              return (
                <button
                  key={item.label}
                  onClick={() => { logout(); navigate('/login'); }}
                  className="flex items-center gap-4 px-6 py-3 text-sm transition-colors duration-150 cursor-pointer rounded-sm text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface w-full border-l-4 border-transparent"
                >
                  <Icon name={item.icon} size={24} />
                  <span className="font-headline uppercase tracking-widest">{item.label}</span>
                </button>
              );
            }
            const isActive =
              location.pathname === item.path ||
              (item.path !== "/" && location.pathname.startsWith(item.path));
            return (
              <Link key={item.path} to={item.path} className={navCls(isActive)}>
                <Icon name={item.icon} size={24} />
                <span className="font-headline uppercase tracking-widest">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
