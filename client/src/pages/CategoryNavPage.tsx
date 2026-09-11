import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import NodeCategoriesModal from '../components/category-nav/NodeCategoriesModal';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { navNodeItems, parseCategoryNavConfig, type CategoryNavGroup, type CategoryNavNode } from '../lib/categoryNav';
import { GROUP_DEFAULT_ICON_KEYS, NAV_ICON_COMPONENTS } from '../lib/categoryNavIcons';
import { usePublicSettings } from '../lib/publicSettings';

/**
 * 分类选型导航页（/category-nav）——SMC 选型程序「按系统选择」复刻（单页，smc_23 布局）。
 * 卡位绑定模型 section 节点；点节点弹分类弹窗，分类卡「模型库」按钮跳首页分类过滤。
 * 卡位标签 = 节点 label（未设置回退 description，再回退默认文案）。
 */

/** ▶ 圆点：主色圆底 + on-primary 小三角（沿用 code.html 的链接语言，颜色跟配色方案） */
function PlayDot({ size = 14, fontSize = 8 }: { size?: number; fontSize?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-full bg-primary pl-0.5 font-bold text-on-primary"
      style={{ width: size, height: size, fontSize }}
      aria-hidden="true"
    >
      ▶
    </span>
  );
}

/** 大类节标题：▶ 圆点 + 粗体标题（code.html 各分区头） */
function GroupHeading({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center space-x-2 pl-1">
      <PlayDot />
      <h3 className="text-sm font-bold tracking-wide text-on-surface">{title}</h3>
    </div>
  );
}

/** 卡位表（smc_23 版式，最多 23 卡位）：桌面拓扑与移动端堆叠共用同一份；
 *  实际渲染数量 = 后台该组配置的节点数（有多少显示多少，未满不补空位）。
 *  默认插画按 key 注册（categoryNavIcons.ts）：节点 iconKey 优先（跟节点走，后台调换顺序插画跟着换），
 *  未设置的旧节点回退卡位下标默认（与历史渲染一致） */
const GROUP_SLOTS: Array<{ id: string; title: string; small: boolean; iconKeys: string[] }> = [
  { id: 'air', title: '气源处理', small: false, iconKeys: GROUP_DEFAULT_ICON_KEYS.air },
  { id: 'cooling', title: '冷却水路', small: true, iconKeys: GROUP_DEFAULT_ICON_KEYS.cooling },
  { id: 'oil', title: '液压润滑', small: true, iconKeys: GROUP_DEFAULT_ICON_KEYS.oil },
  { id: 'common', title: '通用件与资料', small: true, iconKeys: GROUP_DEFAULT_ICON_KEYS.common },
];

/** 分类目录条目：name + Material 图标名（无图时兜底） */
export interface CatalogEntry {
  name: string;
  icon?: string;
}

interface SlotCardProps {
  label: string;
  small?: boolean;
  /** 绑定的配置节点（无则纯静态展示，不可弹窗） */
  node?: CategoryNavNode;
  catalogOf?: (categoryId: string) => CatalogEntry | undefined;
  /** 点击节点打开分类弹窗（弹窗状态由外层持有） */
  onOpenModal?: () => void;
  children: ReactNode;
}

/** 单元卡：插画位（节点图可配，优先节点级 imageUrl）+ ▶ 圆点标签；点击打开分类弹窗 */
function SlotCard({ label, small, node, catalogOf, onOpenModal, children }: SlotCardProps) {
  const { t } = useTranslation();
  const items = useMemo(() => {
    if (!node || !catalogOf) return [];
    return navNodeItems(node).map((item) => {
      const fromCatalog = item.categoryId ? catalogOf(item.categoryId) : undefined;
      return {
        item,
        label: fromCatalog?.name || item.customName || t('categoryNav.unnamedCategory'),
        // 无图兜底：分类目录的 Material 图标
        fallbackIcon: fromCatalog?.icon,
      };
    });
  }, [node, catalogOf, t]);

  // 节点图标优先级：节点级图 > 分类项里第一张图 > 默认 SMC 插画（children）。
  // 注意：节点卡位的图片逻辑保持原样，分类目录图标只用于弹窗里的分类卡兜底
  const nodeImage = node?.imageUrl || items.find((it) => it.item.imageUrl)?.item.imageUrl;
  const clickable = items.length > 0 && Boolean(onOpenModal);

  return (
    <div className="hover-card group relative flex flex-col items-center">
      <button
        type="button"
        onClick={clickable ? onOpenModal : undefined}
        className={`flex w-full flex-col items-center outline-none ${
          clickable ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/50' : 'cursor-default'
        }`}
      >
        <div
          className={`flex w-full items-center justify-center ${small ? 'h-24 slot-visual-sm' : 'h-28 p-1 slot-visual-lg'}`}
        >
          {nodeImage ? (
            <img
              src={nodeImage}
              alt={label}
              className="max-h-full max-w-full object-contain drop-shadow-sm"
              loading="lazy"
            />
          ) : (
            children
          )}
        </div>
        {small ? (
          <span
            className={`mt-1 text-xs font-medium ${
              clickable ? 'text-on-surface-variant group-hover:text-primary' : 'text-on-surface-variant'
            }`}
          >
            {label}
          </span>
        ) : (
          <div className="mt-1 flex items-center space-x-1 text-xs font-semibold text-on-surface group-hover:text-primary">
            <PlayDot size={12} fontSize={7} />
            <span>{label}</span>
          </div>
        )}
      </button>
    </div>
  );
}

/** 桌面拓扑管线几何：按四个分区真实包围盒量测生成（细线 + 圆角肘） */
type DesktopBusGeometry = {
  width: number;
  height: number;
  paths: string[];
};

/**
 * 量测桌面拓扑管线：不再用固定 viewBox 硬编码坐标（会跟 CSS 网格真实位置错位、
 * 非等比拉伸导致线条粗细不均），改为读分区真实包围盒，只把线画在分区之间的间隙里：
 *   1. 主干轨：气源排与冷却盒间隙中线，端点 = 首末卡位中心外扩 12px
 *   2. 气源卡垂线：每张卡底中点 → 主干轨
 *   3. 主干轨 → 冷却盒：中心垂线（圆头线帽直接交汇，不放节点圆点）
 *   4. 冷却盒 → 液压/通用盒：S 型圆角肘分叉
 */
function measureDesktopBus(
  main: HTMLElement | null,
  airGrid: HTMLElement | null,
  cooling: HTMLElement | null,
  oil: HTMLElement | null,
  common: HTMLElement | null,
): DesktopBusGeometry | null {
  if (!main || !airGrid || !cooling || !oil || !common) return null;
  const base = main.getBoundingClientRect();
  if (base.width < 40 || base.height < 40) return null;
  const box = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top - base.top,
      bottom: r.bottom - base.top,
      cx: r.left - base.left + r.width / 2,
    };
  };
  const A = box(airGrid);
  const C = box(cooling);
  const O = box(oil);
  const N = box(common);

  const paths: string[] = [];

  // 1. 主干轨（画在气源排与冷却盒之间的间隙中线，端点贴合首末卡位）
  const railY = (A.bottom + C.top) / 2;
  const centers = Array.from(airGrid.children).map((child) => {
    const r = child.getBoundingClientRect();
    return r.left - base.left + r.width / 2;
  });
  const first = Math.min(...centers);
  const last = Math.max(...centers);
  paths.push(`M ${first - 12} ${railY} H ${last + 12}`);

  // 2. 气源卡垂线（卡底略微内收 2px，避免与标签底边留缝）
  for (const x of centers) paths.push(`M ${x} ${A.bottom - 2} V ${railY}`);

  // 3. 主干轨 → 冷却盒中心垂线（圆头线帽与主干轨直接交汇）
  paths.push(`M ${C.cx} ${railY} V ${C.top}`);

  // 4. 冷却盒 → 液压/通用盒：S 型圆角肘分叉（两曲线公共起点 = 主干竖线末端，自然衔接）
  const yMid = (C.bottom + Math.min(O.top, N.top)) / 2;
  const rFork = Math.min(
    14,
    Math.max(0, yMid - C.bottom - 2),
    Math.min(Math.abs(O.cx - C.cx), Math.abs(N.cx - C.cx)) - 2,
  );
  const elbow = (toX: number, toY: number) => {
    const dir = toX < C.cx ? -1 : 1;
    if (rFork < 2) return `M ${C.cx} ${C.bottom} V ${yMid} H ${toX} V ${toY}`;
    return [
      `M ${C.cx} ${C.bottom}`,
      `V ${yMid - rFork}`,
      `Q ${C.cx} ${yMid} ${C.cx + dir * rFork} ${yMid}`,
      `H ${toX - dir * rFork}`,
      `Q ${toX} ${yMid} ${toX} ${yMid + rFork}`,
      `V ${toY}`,
    ].join(' ');
  };
  paths.push(elbow(O.cx, O.top));
  paths.push(elbow(N.cx, N.top));

  return { width: base.width, height: base.height, paths };
}

/** 拓扑内容（smc_23/code.html 固定布局；卡位绑定模型 section 节点，按配置数量渲染） */
function ModelNavContent({
  groups,
  nodesOfGroup,
  catalogOf,
  onModelCategoryClick,
}: {
  groups: CategoryNavGroup[];
  nodesOfGroup: (groupId: string) => CategoryNavNode[];
  catalogOf: (categoryId: string) => CatalogEntry | undefined;
  onModelCategoryClick: (categoryId: string) => void;
}) {
  /** 组内第 index 个节点绑定到拓扑图对应卡位 */
  const nodesOf = (groupId: string, index: number) => nodesOfGroup(groupId)[index];
  // 区块标题 = 后台分组名（group.name），未配置回退默认文案
  const groupName = (id: string, fallback: string) => groups.find((g) => g.id === id)?.name || fallback;
  const { t } = useTranslation();
  // 当前弹窗节点（groupId:index）；null = 关闭
  const [modalKey, setModalKey] = useState<string | null>(null);
  // 桌面拓扑管线几何（按 DOM 实测；ResizeObserver 跟随布局变化重算，线永远贴合卡位）
  const mainRef = useRef<HTMLElement>(null);
  const airGridRef = useRef<HTMLDivElement>(null);
  const coolingRef = useRef<HTMLDivElement>(null);
  const oilRef = useRef<HTMLDivElement>(null);
  const commonRef = useRef<HTMLDivElement>(null);
  const [bus, setBus] = useState<DesktopBusGeometry | null>(null);

  useLayoutEffect(() => {
    const recompute = () =>
      setBus(
        measureDesktopBus(mainRef.current, airGridRef.current, coolingRef.current, oilRef.current, commonRef.current),
      );
    recompute();
    const ro = new ResizeObserver(recompute);
    for (const el of [mainRef.current, airGridRef.current, coolingRef.current, oilRef.current, commonRef.current]) {
      if (el) ro.observe(el);
    }
    // 字体异步加载会改变标签高度 → 布局稳定后再补测一次
    document.fonts?.ready.then(recompute).catch(() => {});
    return () => ro.disconnect();
  }, []);
  // 弹窗中央大图：节点/分类项都没配图时回退该卡位的默认 SMC 插画
  const [modalIcon, setModalIcon] = useState<ReactNode>(null);
  const [modalGroupId, modalIndex] = modalKey ? modalKey.split(':') : [null, null];
  const modalNode = modalGroupId != null ? nodesOf(modalGroupId, Number(modalIndex)) : undefined;
  // 弹窗分类 = 该节点的分类项（无图分类带目录图标名，弹窗内用图标兜底）
  const modalItems = useMemo(() => {
    if (!modalNode) return [];
    return navNodeItems(modalNode).map((item) => {
      const fromCatalog = item.categoryId ? catalogOf(item.categoryId) : undefined;
      return {
        label: fromCatalog?.name || item.customName || t('categoryNav.unnamedCategory'),
        imageUrl: item.imageUrl,
        fallbackIcon: fromCatalog?.icon,
        modelCategoryId: item.categoryId ?? undefined,
      };
    });
  }, [modalNode, catalogOf, t]);

  // 卡位标签 = 节点 label（后台「节点名称」）；未填显示未命名占位。
  // 插画：节点 iconKey 优先（跟节点走），回退该卡位下标默认
  const card = (groupId: string, index: number, small: boolean, fallbackKey: string) => {
    const node = nodesOf(groupId, index);
    const Illu = (node?.iconKey && NAV_ICON_COMPONENTS[node.iconKey]) || NAV_ICON_COMPONENTS[fallbackKey];
    return (
      <SlotCard
        key={`${groupId}:${index}`}
        label={node?.label?.trim() || t('categoryNav.unnamedNode')}
        small={small}
        node={node}
        catalogOf={catalogOf}
        onOpenModal={() => {
          setModalIcon(<Illu />);
          setModalKey(`${groupId}:${index}`);
        }}
      >
        <Illu />
      </SlotCard>
    );
  };

  return (
    <>
      {/* 移动端（<768px）：放弃横向拓扑画布，四个分区卡片纵向堆叠，3 列小网格。
          pb-24：给 fixed 底部导航栏（56px + safe-area）让位，最后一个分区的节点不被遮挡 */}
      <div className="space-y-4 pb-24 md:hidden">
        {GROUP_SLOTS.map(({ id, title, small, iconKeys }) => {
          const visible = iconKeys.slice(0, nodesOfGroup(id).length);
          return (
            <section key={id} className="rounded-lg border border-surface-container-highest bg-surface-container p-3">
              <GroupHeading title={groupName(id, title)} />
              <div className="grid grid-cols-3 gap-2">{visible.map((key, i) => card(id, i, small, key))}</div>
            </section>
          );
        })}
      </div>

      {/* 桌面端（≥768px）：拓扑画布——相对容器 + SVG 管线覆盖层（按分区实测几何绘制）+ 三层分区。
          category-nav-desktop：纵向尺寸用 clamp(vh) 一屏化（见 global.css），实测管线自动跟随。
          flex-1 + my-auto：画布撑满面板剩余高度，内容垂直居中——大屏（4K）空白均摊上下，
          不再全部堆在底部；矮窗口时 my-auto 退化为 0，内容照常排布由外层滚动兜底 */}
      <main
        ref={mainRef}
        className="category-nav-desktop relative hidden min-h-0 w-full min-w-[1100px] flex-1 select-none md:flex md:flex-col"
      >
        {/* 管线总线：1:1 像素坐标（width/height = 实测容器尺寸，无 viewBox 拉伸），细线 + 圆角肘；颜色 = 配色方案主色 */}
        <svg
          className="pointer-events-none absolute inset-0 z-0"
          width={bus?.width ?? 0}
          height={bus?.height ?? 0}
          fill="none"
          aria-hidden="true"
        >
          {bus?.paths.map((d, i) => (
            <path
              key={i}
              d={d}
              stroke="var(--color-primary-container)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        <div className="my-auto flex w-full flex-col pb-1 pt-2">
          {/* 1. 顶层大类：气源处理系统 (总动力源输入)；分区间距 clamp 随视口高度伸缩 */}
          <div className="group/row relative z-10 mb-[clamp(16px,4.5vh,64px)] hover:z-40">
            <GroupHeading title={groupName('air', GROUP_SLOTS[0].title)} />
            <div ref={airGridRef} className="grid grid-cols-6 gap-3">
              {GROUP_SLOTS[0].iconKeys.slice(0, nodesOfGroup('air').length).map((key, i) => card('air', i, false, key))}
            </div>
          </div>

          {/* 2. 中层大类：冷却水路系统 (主色框围合子回路) */}
          <div
            ref={coolingRef}
            className="relative z-10 mb-[clamp(16px,4.5vh,64px)] rounded border-2 border-primary/40 bg-surface-container-lowest p-2.5 pt-1.5 shadow-sm"
          >
            <GroupHeading title={groupName('cooling', GROUP_SLOTS[1].title)} />
            <div className="grid grid-cols-7 gap-2">
              {GROUP_SLOTS[1].iconKeys
                .slice(0, nodesOfGroup('cooling').length)
                .map((key, i) => card('cooling', i, true, key))}
            </div>
          </div>

          {/* 3 & 4. 底层两大类：液压润滑 (左7列) 与 通用件与资料 (右5列) */}
          <div className="relative z-10 grid grid-cols-12 gap-5">
            {/* 3. 液压润滑系统 (主色线框围合) */}
            <div
              ref={oilRef}
              className="col-span-7 rounded border-2 border-primary/40 bg-surface-container-lowest p-2.5 pt-1.5 shadow-sm"
            >
              <GroupHeading title={groupName('oil', GROUP_SLOTS[2].title)} />
              <div className="grid grid-cols-5 gap-2">
                {GROUP_SLOTS[2].iconKeys
                  .slice(0, nodesOfGroup('oil').length)
                  .map((key, i) => card('oil', i, true, key))}
              </div>
            </div>
            {/* 4. 通用件与资料 (底座库与标准辅件) */}
            <div
              ref={commonRef}
              className="col-span-5 rounded border-2 border-primary/40 bg-surface-container-lowest p-2.5 pt-1.5 shadow-sm"
            >
              <GroupHeading title={groupName('common', GROUP_SLOTS[3].title)} />
              <div className="grid grid-cols-5 gap-1.5">
                {GROUP_SLOTS[3].iconKeys
                  .slice(0, nodesOfGroup('common').length)
                  .map((key, i) => card('common', i, true, key))}
              </div>
            </div>
          </div>
        </div>
      </main>
      {/* 节点分类弹窗：点节点打开，大图 + 大号分类网格 */}
      <NodeCategoriesModal
        open={modalNode != null}
        onClose={() => setModalKey(null)}
        nodeLabel={modalNode?.label || modalNode?.description || t('categoryNav.hoverCardTitle')}
        nodeImage={modalNode?.imageUrl || modalItems.find((it) => it.imageUrl)?.imageUrl}
        fallbackIcon={modalIcon}
        items={modalItems}
        onModelCategoryClick={onModelCategoryClick}
      />
    </>
  );
}

export default function CategoryNavPage() {
  const { t } = useTranslation();
  const { settings } = usePublicSettings();

  const config = useMemo(() => parseCategoryNavConfig(settings?.category_nav_config), [settings?.category_nav_config]);
  const modelSection = config?.model;
  // 页头文案：后台「导航管理」可改（留空回退 i18n 默认）
  const pageTitle = config?.pageTitle?.trim() || t('categoryNav.title');
  const pageDescription = config?.pageDescription?.trim() || t('categoryNav.subtitle');
  useDocumentTitle(pageTitle);

  // 目录：模型 = Category 树（拍平含父子）
  const { data: modelCats } = useSWR('/categories', () => categoriesApi.tree(), { revalidateIfStale: false });

  const modelCatalogOf = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    const walk = (items: CategoryItem[]) => {
      for (const item of items) {
        map.set(item.id, { name: item.name, icon: item.icon });
        if (item.children?.length) walk(item.children);
      }
    };
    if (modelCats?.items) walk(modelCats.items);
    return (id: string) => map.get(id);
  }, [modelCats]);

  const handleModelCategoryClick = (categoryId: string) => {
    // 新窗口打开：导航页是浏览入口，保留原页上下文，用户可连续点多个分类
    window.open(`/?category=${encodeURIComponent(categoryId)}`, '_blank', 'noopener');
  };

  /** 组内节点列表（顺序 = 后台组内排序；前台按实际数量渲染，未满卡位不补空位） */
  const nodesOfGroup = (groupId: string) => modelSection?.nodes.filter((n) => n.groupId === groupId) ?? [];

  return (
    <PublicPageShell className="bg-surface-dim">
      <AdminManagementPage className="category-nav-page" title={pageTitle} description={pageDescription}>
        <AdminContentPanel scroll className="flex flex-col overflow-y-auto">
          {/* 原文件 body：p-3 sm:p-8 max-w-[1300px] mx-auto——背景与页头 hero 同色（surface-container-low）。
              overflow-x-auto 承载桌面拓扑画布（min-w-[1100px]）的横向滚动；移动端画布隐藏自动收缩。
              flex 链（panel → 本容器 → 桌面 main flex-1）：桌面画布撑满面板高度，内容垂直居中（my-auto），
              大屏不再把空白全堆在底部；内容超高时本容器退化为滚动 */}
          <div
            className="mx-auto flex min-h-0 w-full max-w-[1300px] flex-1 flex-col overflow-x-auto bg-surface-container-low p-3 text-on-surface md:px-6 md:py-2"
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            <ModelNavContent
              groups={modelSection?.groups ?? []}
              nodesOfGroup={nodesOfGroup}
              catalogOf={modelCatalogOf}
              onModelCategoryClick={handleModelCategoryClick}
            />
          </div>
        </AdminContentPanel>
      </AdminManagementPage>
    </PublicPageShell>
  );
}
