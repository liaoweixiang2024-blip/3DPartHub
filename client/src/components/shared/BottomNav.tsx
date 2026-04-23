import { Link, useLocation } from "react-router-dom";
import Icon from "./Icon";

const tabs = [
  { label: "首页", icon: "dashboard", path: "/" },
  { label: "收藏", icon: "star", path: "/favorites" },
  { label: "工单", icon: "assignment_add", path: "/my-tickets" },
  { label: "我的", icon: "person", path: "/profile" },
];

export default function BottomNav() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="h-14 shrink-0 bg-surface-container-low border-t border-outline-variant/10 flex items-center justify-around px-4 safe-bottom">
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`flex flex-col items-center gap-0.5 py-1 min-w-[44px] min-h-[44px] justify-center cursor-pointer active:scale-95 transition-transform ${
              active
                ? "text-primary-container border-t-2 border-primary-container -mt-px"
                : "text-on-surface-variant"
            }`}
          >
            <Icon name={tab.icon} size={22} />
            <span className={active ? "text-[10px] font-bold" : "text-[10px]"}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
