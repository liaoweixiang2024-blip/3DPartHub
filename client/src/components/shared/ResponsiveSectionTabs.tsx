import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

export type ResponsiveSectionTab = {
  value: string;
  label: string;
  count?: number;
  icon?: string;
  description?: string;
};

interface ResponsiveSectionTabsProps {
  tabs: ResponsiveSectionTab[];
  value: string;
  onChange: (value: string) => void;
  mobileTitle?: string;
  mobileTriggerVariant?: "plain" | "surface";
  countUnit?: string;
  className?: string;
}

export default function ResponsiveSectionTabs({
  tabs,
  value,
  onChange,
  mobileTitle = "选择分类",
  mobileTriggerVariant = "plain",
  countUnit = "",
  className = "",
}: ResponsiveSectionTabsProps) {
  const [open, setOpen] = useState(false);
  const [canScrollDesktop, setCanScrollDesktop] = useState(false);
  const desktopScrollerRef = useRef<HTMLDivElement | null>(null);
  const activeTab = useMemo(() => tabs.find((tab) => tab.value === value) ?? tabs[0], [tabs, value]);
  const useCompactMobilePicker = tabs.length <= 6;

  useEffect(() => {
    const scroller = desktopScrollerRef.current;
    if (!scroller) return;
    const update = () => setCanScrollDesktop(tabs.length > 3 && scroller.scrollWidth > scroller.clientWidth + 2);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tabs.length]);

  useEffect(() => {
    if (!canScrollDesktop) return;
    const scroller = desktopScrollerRef.current;
    const activeButton = scroller?.querySelector<HTMLElement>("[data-tab-active='true']");
    activeButton?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [canScrollDesktop, value]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectTab = (nextValue: string) => {
    setOpen(false);
    onChange(nextValue);
  };

  const scrollDesktopTabs = (direction: -1 | 1) => {
    const scroller = desktopScrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(220, scroller.clientWidth * 0.55), behavior: "smooth" });
  };

  return (
    <div className={`relative ${className}`}>
      <div className="hidden min-h-10 min-w-0 items-center gap-1.5 md:flex">
        {canScrollDesktop ? (
          <button
            type="button"
            onClick={() => scrollDesktopTabs(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="向左查看更多分类"
          >
            <Icon name="chevron_left" size={18} />
          </button>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <div
            ref={desktopScrollerRef}
            className="flex min-h-10 min-w-0 items-center overflow-x-auto scroll-smooth pr-1 scrollbar-none"
          >
            {tabs.map((tab, index) => {
              const active = tab.value === value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  data-tab-active={active ? "true" : undefined}
                  onClick={() => onChange(tab.value)}
                  className={`relative inline-flex h-9 shrink-0 items-center justify-center gap-1.5 px-3 text-sm font-medium leading-none transition-colors ${
                    active
                      ? "text-primary-container"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {index > 0 ? <span className="absolute left-0 top-1/2 h-3.5 w-px -translate-y-1/2 bg-outline-variant/20" /> : null}
                  {tab.icon ? <Icon name={tab.icon} size={15} /> : null}
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {typeof tab.count === "number" ? (
                    <span className={`ml-0.5 inline-flex items-baseline gap-0.5 text-[11px] font-medium leading-none ${
                      active ? "text-primary-container/70" : "text-on-surface-variant/70"
                    }`}>
                      <span>共</span>
                      <span className="text-xs font-semibold tabular-nums">{tab.count}</span>
                      {countUnit ? <span>{countUnit}</span> : null}
                    </span>
                  ) : null}
                  {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary-container" /> : null}
                </button>
              );
            })}
          </div>
          {canScrollDesktop ? (
            <>
              <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-container-low to-transparent" />
              <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-container-low to-transparent" />
            </>
          ) : null}
        </div>
        {canScrollDesktop ? (
          <button
            type="button"
            onClick={() => scrollDesktopTabs(1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="向右查看更多分类"
          >
            <Icon name="chevron_right" size={18} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="切换分类"
        title="切换分类"
        className={`flex w-full min-w-0 items-center justify-between gap-3 text-left transition-colors md:hidden ${
          mobileTriggerVariant === "plain"
            ? "h-10 rounded-md bg-transparent px-1 active:bg-surface-container-high/60"
            : "h-12 rounded-lg bg-surface px-3 active:bg-surface-container-high"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            mobileTriggerVariant === "plain"
              ? "bg-primary-container/10 text-primary-container"
              : "bg-primary-container text-on-primary shadow-sm"
          }`}>
            {activeTab?.icon ? <Icon name={activeTab.icon} size={17} /> : <Icon name="tune" size={17} />}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold leading-tight text-on-surface">{activeTab?.label ?? "请选择"}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {typeof activeTab?.count === "number" ? (
            <span className="inline-flex items-baseline gap-0.5 text-xs font-medium leading-none text-on-surface-variant/75">
              <span>共</span>
              <span className="text-sm font-bold tabular-nums text-primary-container">{activeTab.count}</span>
              {countUnit ? <span>{countUnit}</span> : null}
            </span>
          ) : null}
          <span className={`flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors ${
            mobileTriggerVariant === "plain" ? "bg-surface-container-low/60" : "bg-surface-container"
          }`}>
            <Icon name="tune" size={17} />
          </span>
        </span>
      </button>

      {open && useCompactMobilePicker ? (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="关闭分类选择"
            className="fixed inset-0 z-[70] h-full w-full bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 top-full z-[80] mt-2 overflow-hidden rounded-xl border border-outline-variant/12 bg-surface p-2 shadow-[0_16px_42px_rgba(0,0,0,0.16)] animate-[sectionPickerDrop_160ms_ease-out]">
            <div className="grid gap-1.5">
              {tabs.map((tab, index) => {
                const active = tab.value === value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectTab(tab.value);
                    }}
                    className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all ${
                      active
                        ? "border-primary-container/35 bg-primary-container text-on-primary shadow-sm"
                        : "border-outline-variant/10 bg-surface-container-low text-on-surface active:bg-surface-container-high"
                    }`}
                    style={{ animation: `sectionPickerItem 180ms ease-out ${Math.min(index, 5) * 18}ms both` }}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-on-primary/15" : "bg-surface-container-high text-on-surface-variant"}`}>
                      {tab.icon ? <Icon name={tab.icon} size={16} /> : <Icon name="tune" size={16} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold leading-tight">{tab.label}</span>
                    {typeof tab.count === "number" ? (
                      <span className={`inline-flex shrink-0 items-baseline gap-0.5 text-[11px] font-medium leading-none ${
                        active ? "text-on-primary/70" : "text-on-surface-variant/70"
                      }`}>
                        <span>共</span>
                        <span className="text-xs font-semibold tabular-nums">{tab.count}</span>
                        {countUnit ? <span>{countUnit}</span> : null}
                      </span>
                    ) : null}
                    {active ? <Icon name="check" size={16} className="shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : open ? (
        <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="关闭分类选择"
            className="absolute inset-0 h-full w-full bg-black/30 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[1.35rem] border border-outline-variant/12 bg-surface pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-2xl animate-[sectionPickerSheet_180ms_ease-out]">
            <div className="flex justify-center pt-2">
              <span className="h-1 w-10 rounded-full bg-outline-variant/35" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2.5 pt-3">
              <div>
                <p className="text-base font-bold leading-tight text-on-surface">{mobileTitle}</p>
                <p className="mt-0.5 text-xs text-on-surface-variant">选择要编辑的设置分类</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="关闭"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="grid max-h-[66vh] grid-cols-2 gap-2 overflow-y-auto border-t border-outline-variant/10 p-3 custom-scrollbar">
              {tabs.map((tab) => {
                const active = tab.value === value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      selectTab(tab.value);
                    }}
                    className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all ${
                      active
                        ? "border-primary-container/35 bg-primary-container text-on-primary shadow-sm"
                        : "border-outline-variant/10 bg-surface-container-low text-on-surface hover:border-outline-variant/20 hover:bg-surface-container"
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-on-primary/15" : "bg-surface-container-high text-on-surface-variant"}`}>
                      {tab.icon ? <Icon name={tab.icon} size={17} /> : <Icon name="tune" size={17} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold leading-tight">{tab.label}</span>
                      {tab.description ? <span className={`mt-0.5 block truncate text-xs ${active ? "text-on-primary/75" : "text-on-surface-variant"}`}>{tab.description}</span> : null}
                    </span>
                    {typeof tab.count === "number" ? (
                      <span className={`inline-flex shrink-0 items-baseline gap-0.5 text-[11px] font-medium leading-none ${
                        active ? "text-on-primary/70" : "text-on-surface-variant/70"
                      }`}>
                        <span>共</span>
                        <span className="text-xs font-semibold tabular-nums">{tab.count}</span>
                        {countUnit ? <span>{countUnit}</span> : null}
                      </span>
                    ) : null}
                    {active ? <Icon name="check" size={17} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <style>{`
        @keyframes sectionPickerDrop {
          from { opacity: 0; transform: translateY(-6px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes sectionPickerSheet {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes sectionPickerItem {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
