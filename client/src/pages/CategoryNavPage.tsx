import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import NodeCategoriesModal from '../components/category-nav/NodeCategoriesModal';
import {
  AirBlowGunIcon,
  AirTankIcon,
  CenterWaterIcon,
  CopperBarbIcon,
  CouplingIcon,
  FittingIcon,
  GaugeIcon,
  HoseBarbIcon,
  LubricationIcon,
  ManifoldIcon,
  MiscIcon,
  OilKitIcon,
  OilLineIcon,
  PipeConnectionIcon,
  PipingIcon,
  SheetMetalIcon,
  SprayUnitIcon,
  TurnkeySolutionIcon,
  UniversalTubeIcon,
  ValveIcon,
  ValveIntegrationIcon,
  WashGunIcon,
  WaterModuleIcon,
} from '../components/category-nav/smcIllustrations';
import { AdminContentPanel, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { navNodeItems, parseCategoryNavConfig, type CategoryNavGroup, type CategoryNavNode } from '../lib/categoryNav';
import { usePublicSettings } from '../lib/publicSettings';

/**
 * 分类选型导航页（/category-nav）——SMC 选型程序「按系统选择」复刻（单页，smc_23 布局）。
 * 卡位绑定模型 section 节点；点节点弹分类弹窗，分类卡「模型库」按钮跳首页分类过滤。
 * 卡位标签 = 节点 label（未设置回退 description，再回退默认文案）。
 */

/** ▶ 圆点：w-3.5 h-3.5 rounded-full bg-sky-600 内白色小三角（code.html 链接语言） */
function PlayDot({ size = 14, fontSize = 8 }: { size?: number; fontSize?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-full bg-sky-600 pl-0.5 font-bold text-white"
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
      <h3 className="text-sm font-bold tracking-wide text-gray-800">{title}</h3>
    </div>
  );
}

/** 卡位表（smc_23 固定 23 卡位）：桌面拓扑与移动端堆叠共用同一份，保证同一节点的默认插画两端一致 */
const GROUP_SLOTS: Array<{ id: string; title: string; small: boolean; icons: ComponentType[] }> = [
  {
    id: 'air',
    title: '气源处理',
    small: false,
    icons: [AirTankIcon, ValveIntegrationIcon, PipingIcon, FittingIcon, AirBlowGunIcon, TurnkeySolutionIcon],
  },
  {
    id: 'cooling',
    title: '冷却水路',
    small: true,
    icons: [
      CenterWaterIcon,
      ManifoldIcon,
      UniversalTubeIcon,
      PipeConnectionIcon,
      SprayUnitIcon,
      WashGunIcon,
      WaterModuleIcon,
    ],
  },
  {
    id: 'oil',
    title: '液压润滑',
    small: true,
    icons: [OilLineIcon, CouplingIcon, HoseBarbIcon, LubricationIcon, OilKitIcon],
  },
  {
    id: 'common',
    title: '通用件与资料',
    small: true,
    icons: [ValveIcon, GaugeIcon, CopperBarbIcon, SheetMetalIcon, MiscIcon],
  },
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
        <div className={`flex w-full items-center justify-center ${small ? 'h-24' : 'h-28 p-1'}`}>
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
            className={`mt-1 text-xs font-medium ${clickable ? 'text-gray-700 group-hover:text-sky-600' : 'text-gray-700'}`}
          >
            {label}
          </span>
        ) : (
          <div className="mt-1 flex items-center space-x-1 text-xs font-semibold text-gray-800 group-hover:text-sky-600">
            <PlayDot size={12} fontSize={7} />
            <span>{label}</span>
          </div>
        )}
      </button>
    </div>
  );
}

/** 拓扑内容（smc_23/code.html 固定布局；卡位绑定模型 section 节点） */
function ModelNavContent({
  groups,
  nodesOf,
  catalogOf,
  onModelCategoryClick,
}: {
  groups: CategoryNavGroup[];
  nodesOf: (groupId: string, index: number) => CategoryNavNode | undefined;
  catalogOf: (categoryId: string) => CatalogEntry | undefined;
  onModelCategoryClick: (categoryId: string) => void;
}) {
  // 区块标题 = 后台分组名（group.name），未配置回退默认文案
  const groupName = (id: string, fallback: string) => groups.find((g) => g.id === id)?.name || fallback;
  const { t } = useTranslation();
  // 当前弹窗节点（groupId:index）；null = 关闭
  const [modalKey, setModalKey] = useState<string | null>(null);
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

  // 卡位标签 = 节点 label（后台「节点名称」）；未填显示未命名占位
  const card = (groupId: string, index: number, small: boolean, IconCmp: ComponentType) => {
    const node = nodesOf(groupId, index);
    return (
      <SlotCard
        key={`${groupId}:${index}`}
        label={node?.label?.trim() || t('categoryNav.unnamedNode')}
        small={small}
        node={node}
        catalogOf={catalogOf}
        onOpenModal={() => {
          setModalIcon(<IconCmp />);
          setModalKey(`${groupId}:${index}`);
        }}
      >
        <IconCmp />
      </SlotCard>
    );
  };

  return (
    <>
      {/* 移动端（<768px）：放弃横向拓扑画布，四个分区卡片纵向堆叠，3 列小网格。
          pb-24：给 fixed 底部导航栏（56px + safe-area）让位，最后一个分区的节点不被遮挡 */}
      <div className="space-y-4 pb-24 md:hidden">
        {GROUP_SLOTS.map(({ id, title, small, icons }) => (
          <section key={id} className="rounded-lg border border-surface-container-highest bg-surface-container p-3">
            <GroupHeading title={groupName(id, title)} />
            <div className="grid grid-cols-3 gap-2">{icons.map((IconCmp, i) => card(id, i, small, IconCmp))}</div>
          </section>
        ))}
      </div>

      {/* 桌面端（≥768px）：PneumaticDiagramCanvas——相对容器 + SVG 管线覆盖层 + 三层分区 */}
      <main className="relative hidden w-full min-w-[1100px] select-none pb-12 pt-4 md:block">
        {/* SVG Topological Connecting Pipeline Bus（贯穿全局的天蓝色主干管网，smc_23 原坐标） */}
        <svg
          className="pointer-events-none absolute inset-0 z-0 h-full w-full"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 1200 980"
        >
          {/* 主干动力总管: 顶层气源处理主管线 */}
          <path d="M 90 195 L 1110 195" stroke="#00c0f3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7" />
          {/* 顶层节点垂直向下接入点 */}
          <path
            d="M 100 160 L 100 195 M 300 160 L 300 195 M 500 160 L 500 195 M 700 160 L 700 195 M 900 160 L 900 195 M 1090 160 L 1090 195"
            stroke="#00c0f3"
            strokeLinecap="round"
            strokeWidth="7"
          />
          {/* 主干母管向下垂直干线 1 (左侧主干，连接冷却水路与通用辅料) */}
          <path
            d="M 90 195 L 90 420 L 1110 420"
            stroke="#00c0f3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="7"
          />
          {/* 冷却/液压区块已被蓝框围合，不画接点竖线 */}
          {/* 底排连接：干线降到两盒中线高度 → 横穿两盒之间的间隙把液压与通用盒连起来。
              盒内部会被白底盖住，可见部分 = 左段（干线→液压盒左缘）+ 间隙段（液压右缘→通用左缘）+ 右段（通用盒右→线尾）。 */}
          <path
            d="M 90 420 L 90 788 L 1110 788"
            stroke="#00c0f3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="7"
          />
          {/* 工业管路法兰与流向接头装饰圆点（仅干线拐弯处，连接线上不放） */}
          <circle cx="90" cy="195" fill="#00a0cc" r="5" />
          <circle cx="90" cy="420" fill="#00a0cc" r="5" />
          <circle cx="90" cy="788" fill="#00a0cc" r="5" />
        </svg>

        {/* 1. 顶层大类：气源处理系统 (总动力源输入) */}
        <div className="group/row relative z-10 mb-14 hover:z-40">
          <GroupHeading title={groupName('air', GROUP_SLOTS[0].title)} />
          <div className="grid grid-cols-6 gap-3">
            {GROUP_SLOTS[0].icons.map((IconCmp, i) => card('air', i, false, IconCmp))}
          </div>
        </div>

        {/* 2. 中层大类：冷却水路系统 (蓝框围合子回路) */}
        <div className="relative z-10 mb-14 rounded border-2 border-[#54c4eb] bg-white p-3 pt-2 shadow-sm">
          <GroupHeading title={groupName('cooling', GROUP_SLOTS[1].title)} />
          <div className="grid grid-cols-7 gap-2">
            {GROUP_SLOTS[1].icons.map((IconCmp, i) => card('cooling', i, true, IconCmp))}
          </div>
        </div>

        {/* 3 & 4. 底层两大类：液压润滑 (左7列) 与 通用件与资料 (右5列) */}
        <div className="relative z-10 grid grid-cols-12 gap-5">
          {/* 3. 液压润滑系统 (用SMC标志浅蓝线框围合) */}
          <div className="col-span-7 rounded border-2 border-[#54c4eb] bg-white p-3 pt-2 shadow-sm">
            <GroupHeading title={groupName('oil', GROUP_SLOTS[2].title)} />
            <div className="grid grid-cols-5 gap-2">
              {GROUP_SLOTS[2].icons.map((IconCmp, i) => card('oil', i, true, IconCmp))}
            </div>
          </div>
          {/* 4. 通用件与资料 (底座库与标准辅件) */}
          <div className="col-span-5 rounded border-2 border-[#54c4eb] bg-white p-3 pt-2 shadow-sm">
            <GroupHeading title={groupName('common', GROUP_SLOTS[3].title)} />
            <div className="grid grid-cols-5 gap-1.5">
              {GROUP_SLOTS[3].icons.map((IconCmp, i) => card('common', i, true, IconCmp))}
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
  useDocumentTitle(t('categoryNav.documentTitle'));
  const { settings } = usePublicSettings();

  const config = useMemo(() => parseCategoryNavConfig(settings?.category_nav_config), [settings?.category_nav_config]);
  const modelSection = config?.model;

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

  /** 组内第 index 个节点绑定到拓扑图对应卡位 */
  const nodesOf = (groupId: string, index: number) => modelSection?.nodes.filter((n) => n.groupId === groupId)[index];

  return (
    <PublicPageShell className="bg-surface-dim">
      <AdminManagementPage
        className="category-nav-page"
        title={t('categoryNav.title')}
        description={t('categoryNav.subtitle')}
      >
        <AdminContentPanel scroll className="overflow-y-auto">
          {/* 原文件 body：p-3 sm:p-8 max-w-[1300px] mx-auto——背景与页头 hero 同色（surface-container-low）。
              overflow-x-auto 承载桌面拓扑画布（min-w-[1100px]）的横向滚动；移动端画布隐藏自动收缩 */}
          <div
            className="mx-auto w-full max-w-[1300px] overflow-x-auto bg-surface-container-low p-3 text-on-surface sm:p-8"
            style={{
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
            }}
          >
            <ModelNavContent
              groups={modelSection?.groups ?? []}
              nodesOf={nodesOf}
              catalogOf={modelCatalogOf}
              onModelCategoryClick={handleModelCategoryClick}
            />
          </div>
        </AdminContentPanel>
      </AdminManagementPage>
    </PublicPageShell>
  );
}
