import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/useAuthStore";
import Icon from "./Icon";

const userNav = [
  { label: "模型库", icon: "dashboard", path: "/" },
  { label: "我的收藏", icon: "star", path: "/favorites" },
  { label: "下载历史", icon: "download", path: "/downloads" },
  { label: "我的工单", icon: "assignment_add", path: "/my-tickets" },
  { label: "技术支持", icon: "support_agent", path: "/support" },
];

const adminNav = [
  { label: "模型库", icon: "dashboard", path: "/" },
  { label: "模型管理", icon: "view_in_ar", path: "/admin/models" },
  { label: "分类管理", icon: "folder", path: "/admin/categories" },
  { label: "用户管理", icon: "group", path: "/admin/users" },
  { label: "工单处理", icon: "build", path: "/admin/tickets" },
  { label: "操作日志", icon: "receipt_long", path: "/admin/audit" },
  { label: "系统设置", icon: "settings", path: "/admin/settings" },
  { label: "我的收藏", icon: "star", path: "/favorites" },
  { label: "下载历史", icon: "download", path: "/downloads" },
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

  return (
    <aside className="hidden md:flex w-56 h-full flex-col py-4 bg-surface-container-low border-r border-outline-variant/20 shrink-0">
      <nav className="flex-1 px-3 flex flex-col gap-1">
        {navItems.map((item) => {
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
      </nav>

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
