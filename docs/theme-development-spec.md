# 3DPartHub 主题开发规范 v1.0

> 类 WordPress 主题包体系。每个主题是一个自包含的目录，拥有自己的 manifest、布局组件、页面模板、样式和外观 token。

---

## 目录

1. [架构总览](#1-架构总览)
2. [主题包目录结构](#2-主题包目录结构)
3. [主题包合约（每个文件必须满足什么）](#3-主题包合约)
4. [类型系统](#4-类型系统)
5. [配色方案规范](#5-配色方案规范)
6. [外观 Token 规范](#6-外观-token-规范)
7. [共享渲染器规范](#7-共享渲染器规范)
8. [核心层规则（什么能做什么不能做）](#8-核心层规则)
9. [暗色/亮色模式规范](#9-暗色亮色模式规范)
10. [CSS 编写规范](#10-css-编写规范)
11. [服务器端设置对接](#11-服务器端设置对接)
12. [新增主题完整步骤](#12-新增主题完整步骤)
13. [验证与 CI](#13-验证与-ci)
14. [已知问题与待优化](#14-已知问题与待优化)

---

## 1. 架构总览

主题系统分四个正交的维度，互不耦合：

| 维度                       | 当前值                                                             | 控制范围                                                  |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 界面主题 (Interface Theme) | `workbench` / `classic` / `<新主题>`                               | PC 布局结构、PC 组件选择、PC 首页模板、PC CSS 作用域      |
| 移动端主题 (Mobile Theme)  | `classic` / `<新移动主题>`                                         | 移动底部导航、移动抽屉导航、移动首页行为、移动 CSS 作用域 |
| 配色方案 (Color Scheme)    | `orange` / `blue` / `green` / `purple` / `red` / `teal` / `custom` | 全部颜色 token，如 surface、primary、secondary            |
| 暗色/亮色模式              | `dark` / `light` / `system` / `auto`                               | 同一组颜色 token 的亮/暗两套变体                          |

**对应 WordPress 的概念映射**：

| WordPress 概念                         | 3DPartHub 对应          | 文件位置                                     |
| -------------------------------------- | ----------------------- | -------------------------------------------- |
| `style.css` 头部注释                   | `manifest.ts`           | `themes/interfaceThemes/<key>/manifest.ts`   |
| `functions.php`                        | `theme.ts`              | `themes/interfaceThemes/<key>/theme.ts`      |
| 模板文件 (`index.php`, `single.php`)   | `templates/`            | `templates/HomeDesktop.tsx`                  |
| 模板部件 (`header.php`, `sidebar.php`) | `layouts/`              | `layouts/TopNav.tsx`, `Sidebar.tsx` 等       |
| `functions.php` 中的小工具/短代码      | `components/`           | 主题私有组件                                 |
| 子主题 functions                       | `tokens/appearance.ts`  | 外观配置                                     |
| WordPress 定制器 (Customizer)          | SettingsPage 配色编辑器 | `pages/SettingsPage.tsx`                     |
| WordPress 插件 (颜色/字体)             | 配色方案系统            | `lib/colorSchemes.ts` + `lib/colorScheme.ts` |

### 数据流

```
server DB
  │  interface_theme: 'workbench'
  │  mobile_interface_theme: 'classic'
  │  color_scheme: 'orange'
  │  default_theme: 'light'
  │  auto_theme_enabled: false
  ▼
/api/settings/public
  ▼
publicSettings.ts (缓存 2 分钟)
  ├─→ colorScheme.ts ─→ 注入 <style id="dynamic-theme"> ─→ CSS 变量生效
  ├─→ useThemeStore.ts ─→ 添加/移除 .theme-light class
  └─→ getInterfaceThemePackage() ─→ 返回 InterfaceThemePackage
                                    ├─ manifest (元数据)
                                    ├─ chrome (布局行为)
                                    ├─ home (首页行为)
                                    ├─ templates.{DesktopHome, AuthDialog, Login, NotFound}
                                    └─ components.{DesktopTopNav, Sidebar, FloatingMenu?}
  └─→ getMobileThemePackage() ─→ 返回 MobileThemePackage
                                ├─ manifest
                                ├─ home (移动首页行为)
                                └─ components.{BottomNav, MobileNavDrawer}
```

---

## 2. 主题包目录结构

每个 PC 界面主题必须位于 `client/src/themes/interfaceThemes/<theme-key>/` 下，结构如下：

```
<theme-key>/
  ├── index.ts              # 【必须】唯一职责：re-export ./theme
  ├── manifest.ts           # 【必须】主题元数据
  ├── theme.ts              # 【必须】组装点：导出 InterfaceThemePackage
  ├── layouts/
  │   ├── TopNav.tsx        # 【必须】桌面顶部导航
  │   ├── Sidebar.tsx       # 【必须】桌面侧边栏
  │   ├── BottomNav.tsx     # 【兼容】旧合约保留，不作为移动端消费入口
  │   └── MobileNavDrawer.tsx # 【兼容】旧合约保留，不作为移动端消费入口
  ├── templates/
  │   ├── HomeDesktop.tsx   # 【必须】桌面首页模板
  │   ├── AuthDialog.tsx    # 【必须】登录/注册弹窗模板
  │   ├── Login.tsx         # 【必须】登录/注册页模板
  │   └── NotFound.tsx      # 【必须】404 页面模板
  ├── components/           # 【可选】主题私有组件
  │   └── XxxComponent.tsx
  ├── tokens/
  │   └── appearance.ts     # 【必须】外观 token（className 映射）
  └── styles.css            # 【可选】主题私有 CSS
```

### 文件职责一览

| 文件                   | 导出                               | 职责                                                   | 允许导入                              |
| ---------------------- | ---------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| `index.ts`             | `default`                          | 仅 `export { default } from './theme'`                 | 无                                    |
| `manifest.ts`          | `xxxThemeManifest`                 | 主题元数据：key, label, description, capabilities      | 无                                    |
| `theme.ts`             | `xxxTheme` (InterfaceThemePackage) | 组装 manifest + chrome + home + templates + components | 本主题内的所有文件 + shared renderers |
| `layouts/*.tsx`        | 组件                               | shell 级 UI（导航、侧栏）                              | shared renderers、允许清单内组件/lib  |
| `templates/*.tsx`      | 组件                               | 页面级模板                                             | home types, shared components         |
| `components/*.tsx`     | 组件                               | 主题私有 UI                                            | shared renderers、允许清单内组件/lib  |
| `tokens/appearance.ts` | Appearance 对象                    | 布局外观 className 配置                                | shared renderer 类型                  |
| `styles.css`           | 无 (副作用导入)                    | 主题私有 CSS                                           | 无                                    |

主题目录禁止反向 import `pages/` 层。主题私有文件也不能任意 import 业务实现，只能使用契约脚本白名单中的 `components/shared/*`、`components/home/*` 中的基础契约、`lib/routeLoaders`、`lib/businessConfig` 类型以及 `themes/interfaceThemes/shared/*`。页面模板需要的首页类型、骨架屏、公告条、海报图等基础契约放在 `components/home/`，由页面控制器传入数据和动作。

`themes/interfaceThemes/shared/` 只能放真正跨主题的基础层、契约和渲染器，文件内容不得出现 `classic/workbench` 等具体主题名。某个主题专用的模板、样式、布局必须放回该主题目录，例如登录弹窗统一通过 `templates/AuthDialog.tsx` 分别由 classic/workbench 实现，通用 `AuthModal` 只负责表单状态和提交逻辑。

`themes/interfaceThemes/shared/base.css` 是所有 PC 主题共同继承的基础视觉层，它来自经典版稳定样式：页面抬头、工具条、内容面板、指标卡、登录弹窗等默认形态都在这里定义。classic 主题默认不再复制这些样式；workbench 和后续新主题只在自己的 `styles.css` 中覆盖需要增强的部分。

输入框、下拉框、文本域等基础表单控件不属于任何主题包，统一放在 `components/shared/FormControls.tsx`。主题可以通过外层模板和作用域 CSS 调整整体观感，但不要在页面或主题里重复拼 `bg-surface-container-lowest ... focus:border-primary-container` 这类基础输入框 class。

业务层、页面层、通用组件层不得 import `themes/interfaceThemes/shared`、`themes/interfaceThemes/classic`、`themes/interfaceThemes/workbench` 等主题内部路径。允许的主题入口只有 `registry.ts`、`catalog.ts`、`types.ts` 这类公开契约。

### 移动端主题包

移动端主题与 PC 界面主题分离，默认使用 `classic`，因此切换 PC 的 `workbench/classic` 不会改变手机端导航、抽屉和首页加载方式。新增移动端主题时放到 `client/src/themes/mobileThemes/<theme-key>/`：

```
<theme-key>/
  ├── index.ts
  ├── manifest.ts
  ├── theme.ts              # 导出 MobileThemePackage
  ├── layouts/
  │   ├── BottomNav.tsx
  │   └── MobileNavDrawer.tsx
  └── tokens/
      └── appearance.ts
```

移动端共享渲染器统一放在 `themes/mobileThemes/shared/`。页面和 Shell 只能通过 `getMobileThemePackage(settings.mobile_interface_theme)` 消费移动端主题，不允许从 PC 主题包读取移动端组件。

---

## 3. 主题包合约

### 3.1 `manifest.ts`

```typescript
import type { InterfaceThemeMeta } from '../types';

export const xxxThemeManifest: InterfaceThemeMeta = {
  key: 'xxx', // 必须等于目录名
  label: '主题中文名',
  settingsLabel: '主题中文名（设置页显示）',
  shortLabel: '短名称', // 可选，用于紧凑菜单
  description: '一句话描述主题特点',
  author: '作者名',
  version: '1.0.0',
  screenshot: '/interface-themes/xxx-preview.svg', // 可选，设置页主题卡片预览图
  capabilities: ['desktop-top-nav', 'desktop-home-template'], // 类型化能力声明
};
```

**capabilities 目前可用的值**：

- `desktop-top-nav` — 主题提供桌面顶部导航
- `desktop-home-template` — 主题提供桌面首页模板
- `login-template` — 主题提供登录/注册页模板
- `not-found-template` — 主题提供 404 页面模板
- `sidebar` — 主题提供侧边栏
- `category-sidebar` — 首页包含分类侧边栏
- `mobile-bottom-nav` — 主题提供移动端底部导航
- `mobile-drawer` — 主题提供移动端抽屉导航
- `floating-menu` — 主题提供浮动菜单组件
- `hero-section` — 首页包含独立 hero/海报搜索区域
- `contact-panel` — 主题提供联系信息面板

### 3.2 `theme.ts`

```typescript
import type { InterfaceThemePackage } from '../types';
import { xxxThemeManifest } from './manifest';
import XxxDesktopTopNav from './layouts/TopNav';
import XxxSidebar from './layouts/Sidebar';
import XxxBottomNav from './layouts/BottomNav';
import XxxMobileNavDrawer from './layouts/MobileNavDrawer';
import XxxHomeDesktop from './templates/HomeDesktop';
import XxxAuthDialog from './templates/AuthDialog';
import XxxLogin from './templates/Login';
import XxxNotFound from './templates/NotFound';
// import './styles.css';  // 如果有主题私有 CSS

export const xxxTheme: InterfaceThemePackage = {
  manifest: xxxThemeManifest,

  home: {
    listLoadingMode: 'pagination', // 'pagination' | 'infinite'；只控制列表交互，数据接口仍由 HomePage 统一提供
    showModelCardCategory: false, // classic 保持旧卡片；需要展示分类的新主题可开启
    showModelCardVariantMeta: false, // classic 保持旧卡片；需要展示变体信息的新主题可开启
  },

  chrome: {
    desktopSearch: {
      placement: 'toolbar', // 'inline' | 'toolbar' | 'none'
    },
    adminLayout: {
      defaultPath: (ctx) => '/admin/models',
      showDesktopSidebar: (ctx) => true, // ctx: { pathname, isAdminRoute }
      desktopContentClassName: (ctx) => undefined,
      showDesktopFloatingMenu: (ctx) => false,
    },
    publicLayout: {
      showDesktopHomeFooter: (ctx) => true,
      showDesktopFloatingMenu: (ctx) => false,
    },
  },

  templates: {
    DesktopHome: XxxHomeDesktop,
    AuthDialog: XxxAuthDialog,
    Login: XxxLogin,
    NotFound: XxxNotFound,
  },

  components: {
    DesktopTopNav: XxxDesktopTopNav,
    Sidebar: XxxSidebar,
    BottomNav: XxxBottomNav,
    MobileNavDrawer: XxxMobileNavDrawer,
    // FloatingMenu: XxxFloatingMenu,  // 如果 capabilities 含 'floating-menu'
  },
};
```

### 3.3 `index.ts`

```typescript
export { default } from './theme';
```

**必须是这一行，不能有其他内容。**

### 3.4 注册

新主题需要在两个文件中注册：

**`catalog.ts`**：

```typescript
import { xxxThemeManifest } from './xxx/manifest';

export const INTERFACE_THEME_CATALOG: Record<InterfaceThemeKey, InterfaceThemeMeta> = {
  workbench: workbenchThemeManifest,
  classic: classicThemeManifest,
  xxx: xxxThemeManifest, // ← 新增
};
```

**`registry.ts`**：

```typescript
import xxxTheme from './xxx';

export const INTERFACE_THEME_PACKAGES: Record<InterfaceThemeKey, InterfaceThemePackage> = {
  workbench: workbenchTheme,
  classic: classicTheme,
  xxx: xxxTheme, // ← 新增
};
```

**`types.ts`**：

```typescript
export type InterfaceThemeKey = 'workbench' | 'classic' | 'xxx'; // ← 新增联合类型
```

### 3.5 验证脚本

**`verify-theme-contract.mjs`** 的 `themeKeys` 数组需要加入新 key：

```javascript
const themeKeys = ['workbench', 'classic', 'xxx'];
```

---

## 4. 类型系统

### 4.1 核心类型（`types.ts`）

```typescript
// 主题 key — 所有注册主题的联合类型
InterfaceThemeKey = 'workbench' | 'classic' | '...'

// 主题元数据
InterfaceThemeMeta {
  key: InterfaceThemeKey
  label: string
  settingsLabel: string
  description: string
  author: string
  version: string
  capabilities: InterfaceThemeCapability[]
}

// 桌面导航 Props（主题 TopNav 组件接收）
DesktopTopNavThemeProps {
  source: 'layout' | 'standalone'
  userNavItems: NavItemConfig[]
  adminNavItems: NavItemConfig[]
  topNavItems: NavItemConfig[]
  isAdmin: boolean
  isWideDesktop: boolean
  isVeryWideDesktop: boolean
  renderBrand: (className: string) => ReactNode
  renderSearch: (className: string) => ReactNode
  tools: ReactNode
  isNavActive: (path: string) => boolean
  onNavClick: (event, path: string) => void
}

// 移动端抽屉 Props
MobileNavDrawerThemeProps {
  open: boolean
  onClose: () => void
}

// 主题必须提供的组件集
InterfaceThemeComponents {
  DesktopTopNav: DesktopTopNavThemeComponent
  Sidebar: ComponentType
  BottomNav: ComponentType
  MobileNavDrawer: ComponentType<MobileNavDrawerThemeProps>
  FloatingMenu?: ComponentType   // 可选
}

// 主题必须提供的模板集
InterfaceThemeTemplates {
  DesktopHome: ComponentType<DesktopHomeThemeProps>
  AuthDialog: ComponentType<AuthDialogThemeProps>
  Login: ComponentType<LoginThemeProps>
  NotFound: ComponentType<NotFoundThemeProps>
}

// Chrome 上下文
InterfaceThemeChromeContext {
  pathname: string
  isAdminRoute: boolean
}

// Chrome 行为配置
InterfaceThemeChrome {
  desktopSearch: { placement: 'inline' | 'toolbar' | 'none' }
  adminLayout: {
    defaultPath?: (ctx) => string
    showDesktopSidebar: (ctx) => boolean
    desktopContentClassName?: (ctx) => string | undefined
    showDesktopFloatingMenu?: (ctx) => boolean
  }
  publicLayout: {
    showDesktopHomeFooter?: (ctx) => boolean
    showDesktopFloatingMenu?: (ctx) => boolean
  }
}

// 完整主题包
InterfaceThemePackage {
  manifest: InterfaceThemeMeta
  home: HomeThemeBehavior
  chrome: InterfaceThemeChrome
  templates: InterfaceThemeTemplates
  components: InterfaceThemeComponents
}
```

### 4.2 首页模板 Props（`themes/interfaceThemes/types.ts`）

```typescript
DesktopHomeThemeProps {
  activeCategory: string
  breadcrumb: HomeBreadcrumb
  categories: Category[]
  displayTotalItems: number
  expandedCategories: Set<string>
  footerLinks: { label: string; url: string }[]
  homePageSizeOptions: number[]
  page: number
  pageSize: number
  products: Product[]
  renderProductCard: (product: Product, index: number) => ReactNode
  resultsAnchorRef: RefObject<HTMLDivElement | null>
  scrollContainerRef: RefObject<HTMLElement | null>
  searchQuery: string
  showHomeListSkeleton: boolean
  sortBy: string
  totalItems: number
  totalModelCount: number
  totalPages: number
  viewMode: HomeViewMode
  onHeroExplore: () => void
  onHeroSearch: (query: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onSelectCategory: (id: string) => void
  onSortChange: (sort: string) => void
  onToggleCategory: (id: string) => void
  onViewModeChange: (mode: HomeViewMode) => void
}

HomeThemeBehavior {
  listLoadingMode: 'pagination' | 'infinite'
  showModelCardCategory: boolean
  showModelCardVariantMeta: boolean
}
```

`DesktopHomeThemeProps` 由 `themes/interfaceThemes/types.ts` 维护；`Category`、`Product`、`HomeBrowseState` 等业务数据类型由 `components/home/homeTypes.ts` 维护。`pages/home/themeTypes.ts`、`pages/home/types.ts` 只作为页面层兼容重导出，不允许主题模板反向 import `pages/`。

**模板组件不应自行发起数据请求，也不应决定筛选/排序的数据逻辑**。所有数据、分页状态和业务回调由 HomePage 控制器层统一传入；主题可以通过 `listLoadingMode` 决定是分页控件还是自动加载，但不能自己请求另一套数据。

---

## 5. 配色方案规范

### 5.1 颜色层级

```
引用级 Token (Reference Token)
  └─ global.css @theme 块中定义的 --color-primary 等
      └─ 由 colorScheme.ts 动态注入覆盖

语义级 Token (Semantic Token)
  └─ global.css 中通过 var() 链接的 --color-cta 等
      └─ 组件直接引用这些

组件级消费
  └─ Tailwind class: bg-surface, text-on-surface 等
```

### 5.2 完整颜色变量清单（`COLOR_KEYS`，共 30 个）

| 分类          | 变量名                      | 说明                                |
| ------------- | --------------------------- | ----------------------------------- |
| **Surface**   | `surface-tint`              | 主题色调（用于微妙的 surface 染色） |
|               | `surface`                   | 主背景                              |
|               | `surface-dim`               | 最暗背景                            |
|               | `surface-container-lowest`  | 容器最底层                          |
|               | `surface-container-low`     | 容器低层                            |
|               | `surface-container`         | 容器标准层                          |
|               | `surface-container-high`    | 容器高层                            |
|               | `surface-container-highest` | 容器最高层                          |
|               | `surface-bright`            | 最亮背景                            |
|               | `surface-variant`           | 变体背景                            |
| **文字**      | `on-surface`                | 主文字色                            |
|               | `on-background`             | 背景文字色                          |
|               | `on-surface-variant`        | 次要文字色                          |
| **Primary**   | `primary`                   | 主色调（用于文字/图标）             |
|               | `primary-container`         | 主色容器（用于按钮/强调背景）       |
|               | `on-primary`                | 主色上的文字                        |
|               | `on-primary-container`      | 主色容器上的文字                    |
| **Secondary** | `secondary`                 | 辅助色                              |
|               | `secondary-container`       | 辅助容器色                          |
|               | `on-secondary`              | 辅助色上的文字                      |
|               | `on-secondary-container`    | 辅助容器上的文字                    |
| **Tertiary**  | `tertiary`                  | 第三色                              |
|               | `tertiary-container`        | 第三容器色                          |
|               | `on-tertiary`               | 第三色上的文字                      |
|               | `on-tertiary-container`     | 第三容器上的文字                    |
| **错误**      | `error`                     | 错误色                              |
|               | `error-container`           | 错误容器色                          |
| **边框**      | `outline`                   | 主描边色                            |
|               | `outline-variant`           | 次描边色                            |

### 5.3 语义别名 Token

| 别名                     | 映射                                 | 用途             |
| ------------------------ | ------------------------------------ | ---------------- |
| `--color-cta`            | `var(--color-primary-container)`     | 主要操作按钮背景 |
| `--color-destructive`    | `var(--color-error)`                 | 危险/删除操作    |
| `--color-muted-text`     | `var(--color-on-surface-variant)`    | 次要说明文字     |
| `--color-card-bg`        | `var(--color-surface-container-low)` | 卡片背景         |
| `--color-card-bg-raised` | `var(--color-surface-container)`     | 提升的卡片背景   |
| `--color-shadow`         | `#000000`                            | 阴影颜色         |

**新增语义别名**：在 `global.css` 的 `@theme` 块中添加。必须在 dark 和 light 下都有合理映射。

### 5.4 值格式要求

**所有预设和 `generatePaletteFromPrimary` 生成的颜色值必须统一使用 `#rrggbb` hex 格式。**

原因：

- `<input type="color">` 只接受 hex
- hex 格式在文本输入框中可读性最好
- 避免同一 preset 内 `hsl()` 和 `#hex` 混用

实现要求：`colorSchemes.ts` 的 `createSurfacePalette` 必须通过 `hslToHex` 输出 hex；`verify:themes` 会阻止重新输出 `hsl()` 字符串。

### 5.5 新增配色方案步骤

1. 在 `colorSchemes.ts` 的 `COLOR_PRESETS` 中添加新条目
2. 提供 `dark` 和 `light` 两套完整的 30 个 `COLOR_KEYS`
3. 使用 `createSurfacePalette(hue, saturation)` 生成 surface 组
4. 手工微调 primary / secondary / tertiary / error / outline 组
5. 在 SettingsPage 的配色选择器中验证效果

---

## 6. 外观 Token 规范

### 6.1 每个主题必须提供的外观对象

```typescript
// tokens/appearance.ts 必须导出这三个对象：

export const xxxSidebarAppearance: SidebarAppearance = { ... };
export const xxxBottomNavAppearance: BottomNavAppearance = { ... };
export const xxxMobileDrawerAppearance: MobileNavDrawerAppearance = { ... };
```

### 6.2 Appearance 对象的内容

Appearance 对象是 **className 字符串或函数**，传给共享渲染器（shared renderers）。

原则：

- **只使用 CSS 变量和 Tailwind utility class**，不硬编码颜色
- 激活/未激活状态的 className 通过函数返回
- 间距、圆角、字号等在这里定义，由渲染器应用

示例：

```typescript
const sidebarItemClassName = (active: boolean) =>
  `flex items-center gap-3 px-3 py-2.5 text-sm transition-colors cursor-pointer rounded-lg border ${
    active
      ? 'border-primary-container/20 bg-primary-container/10 text-primary-container font-semibold'
      : 'border-transparent text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface'
  }`;
```

### 6.3 禁止事项

- 不允许在 appearance token 中使用 `#xxx` 硬编码颜色
- 不允许引用其他主题的 appearance
- 不允许在 appearance 中写业务逻辑

---

## 7. 共享渲染器规范

`shared/` 目录下的渲染器（SidebarRenderer、BottomNavRenderer、MobileNavDrawerRenderer、FloatingMenuRenderer）是**通用的 UI 骨架**，它们：

1. 接收 appearance token 对象
2. 接收业务数据（导航项、用户信息等）
3. 渲染最终 UI

**渲染器不能包含任何主题特有的逻辑或样式。** 如果一个行为只有某个主题需要，它应该：

- 在 `InterfaceThemePackage` 的 `chrome` 配置中声明，由 shell 层判断
- 或在主题自己的 layout 组件中实现，不经过共享渲染器

### 当前共享渲染器

| 渲染器                    | Appearance 接口             | 提供                            |
| ------------------------- | --------------------------- | ------------------------------- |
| `SidebarRenderer`         | `SidebarAppearance`         | 侧边栏导航、折叠区、用户 footer |
| `BottomNavRenderer`       | `BottomNavAppearance`       | 移动端底部 Tab                  |
| `MobileNavDrawerRenderer` | `MobileNavDrawerAppearance` | 移动端滑出式导航                |
| `FloatingMenuRenderer`    | `FloatingMenuAppearance`    | 桌面端悬浮快捷入口与联系面板    |

`SidebarRenderer` 支持 `adminRouteMode="admin-only"`。新工作台这类后台沉浸式主题应在管理员进入 `/admin` 后只展示后台菜单；旧主题可以保持 `adminRouteMode="all"`，继续展示完整导航并用分割线区分后台菜单。

`FloatingMenuRenderer` 不能直接读取 `publicSettings`。联系邮箱、电话、地址等运行时数据必须由 shell 层通过 `FloatingMenuThemeProps` 注入，再由主题组件传给 renderer。

---

## 8. 核心层规则

### 8.1 允许的模式

```typescript
// ✅ 通过 registry 获取主题包
const ThemePackage = getInterfaceThemePackage(settings?.interface_theme);

// ✅ 通过 chrome 配置判断行为
ThemePackage.chrome.adminLayout.showDesktopSidebar(ctx);

// ✅ 使用主题提供的组件
const Sidebar = ThemePackage.components.Sidebar;

// ✅ 使用主题提供的模板
const DesktopHome = ThemePackage.templates.DesktopHome;
const AuthDialog = ThemePackage.templates.AuthDialog;

// ✅ 使用主题的 home 行为配置
ThemePackage.home.listLoadingMode === 'pagination';
```

### 8.2 禁止的模式

```typescript
// ❌ 直接比较主题 key
if (interfaceTheme === 'workbench') { ... }
if (interfaceTheme !== 'classic') { ... }

// ❌ 主题布尔变量
const isWorkbench = ...
const isClassic = ...

// ❌ 访问不存在于 InterfaceThemePackage 的字段
ThemePackage.meta    // 不存在，应该是 ThemePackage.manifest

// ❌ 在 components 下访问模板
ThemePackage.components.DesktopHome  // 模板在 templates 下

// ❌ 使用已废弃的组件级注册表
INTERFACE_THEME_COMPONENTS  // 不存在

// ❌ 在 global.css 中写主题特有样式
[data-interface-theme='workbench'] .xxx { ... }  // 应在主题自己的 styles.css 中

// ❌ 主题模板反向依赖页面层
import { SkeletonCard } from '../../../../pages/home/DesktopShared';

// ❌ 主题模板直接读取业务设置
import { getFooterCopyright } from '../../../../lib/publicSettings';

// ❌ 通用组件写主题私有 class
className = "workbench-auth-dialog";
```

### 8.3 如何正确处理主题差异

如果两个主题在同一处有不同的行为：

1. 在 `InterfaceThemePackage` 接口中添加新字段（如 `chrome.xxx`）
2. 每个主题在自己的 `theme.ts` 中实现
3. 消费方通过 `ThemePackage.chrome.xxx` 读取

**绝对不要在消费方写 `if (theme === 'workbench')` 分支。**

### 8.4 基础语义页面层

公共页面、后台页面和工具页面应先落到一套无主题倾向的基础语义层，再由主题包按作用域美化。这个层级对应 CMS 里的基础模板骨架：业务逻辑稳定，主题只改视觉。

| 语义 class                   | 说明                                 | 首选来源                                 |
| ---------------------------- | ------------------------------------ | ---------------------------------------- |
| `app-page`                   | 页面根容器，承载页面级变量           | `PageBody` / `AdminManagementPage`       |
| `app-page-hero`              | 标题、描述、操作按钮所在的页面抬头   | `PageHeader` / `AdminPageHero`           |
| `app-page-title`             | 页面主标题                           | `PageTitle` / `AdminPageHero`            |
| `app-page-description`       | 页面副标题或说明                     | `PageHeader` / `AdminPageHero`           |
| `app-page-meta`              | 记录数、状态、版本号等弱信息         | `PageHeader` / `AdminPageHero`           |
| `app-page-toolbar`           | 搜索、筛选、批量操作等工具条         | `AdminToolbar`                           |
| `app-content-panel`          | 主要内容面板                         | `AdminContentPanel`                      |
| `app-stats-grid`             | 数据指标网格                         | `AdminStatsGrid`                         |
| `app-stat-card`              | 单个指标卡                           | `AdminStatsGrid`                         |
| `app-public-tool-page`       | 选型、产品图库、规格查询等前台工具页 | 页面传入 `AdminManagementPage.className` |
| `app-public-tool-page-<key>` | 某个工具页的轻量扩展钩子             | 页面传入 `AdminManagementPage.className` |

规则：

- `global.css` 只定义中性变量和基础可访问性样式，例如 `--app-page-border`、`--app-page-surface`。
- 主题私有视觉只能写在 `themes/interfaceThemes/<key>/styles.css`，选择器必须以 `[data-interface-theme='<key>']` 开头。
- 页面可以加语义 class，不能根据主题 key 改 class 或业务结构。
- 如果某个页面的结构差异已经不是“皮肤”能表达，应新增 `templates/<Page>.tsx` 模板合约，而不是在页面里写主题分支。

当前已接入基础语义层的页面骨架：

| 页面类型    | 入口                                                     |
| ----------- | -------------------------------------------------------- |
| 后台/管理页 | `AdminManagementPage`                                    |
| 普通内容页  | `PagePrimitives`                                         |
| 前台工具页  | `SelectionPage`、`ProductWallPage`、`ThreadSizeToolPage` |

---

## 9. 暗色/亮色模式规范

### 9.1 实现机制

- **默认**：`@theme` 块定义的值 = 暗色模式
- **亮色覆盖**：`.theme-light` class 挂在 `<html>` 上，覆盖全部 `--color-*` 变量
- **动态配色**：`<style id="dynamic-theme">` 标签注入 `:root` 和 `.theme-light` 下的变量覆盖

优先级（后者覆盖前者）：

```
global.css @theme (dark 默认值)
  → <style id="dynamic-theme"> :root (配色方案 dark 值)
    → global.css .theme-light (light 默认值)
      → <style id="dynamic-theme"> .theme-light (配色方案 light 值)
```

### 9.2 新增主题时的暗色/亮色要求

- 所有 CSS 变量必须在暗色和亮色下都有定义
- 所有使用 `color-mix()` 的地方必须兼容暗色和亮色
- 主题的 `styles.css` 不需要写 `.theme-light` 分支（因为变量已经被全局覆盖了），除非需要结构差异

### 9.3 暗色/亮色切换流程

```
useThemeStore.toggleTheme()
  → applyThemeClass('light'|'dark')
    → document.documentElement.classList.add/remove('theme-light')
```

### 9.4 自动切换

```typescript
// 由服务器设置驱动
applyServerThemeDefaults(defaultTheme, autoEnabled, darkHour, lightHour)
  → useThemeStore.setAutoSwitch(true, darkHour, lightHour)
    → 每分钟检查当前小时
    → 到达切换时间点时自动调用 applyThemeClass()
```

---

## 10. CSS 编写规范

### 10.1 作用域

| 位置                 | 选择器前缀                       | 用途                       |
| -------------------- | -------------------------------- | -------------------------- |
| `global.css`         | 无前缀                           | 全局基础样式、CSS 变量定义 |
| `<theme>/styles.css` | `[data-interface-theme='<key>']` | 主题私有样式               |
| 首页模板样式         | `[data-home-theme='<key>']`      | 首页模板私有样式           |

### 10.2 颜色使用规则

```css
/* ✅ 使用 CSS 变量 */
background: var(--color-surface);
color: var(--color-on-surface);

/* ✅ 使用 color-mix 做半透明 */
border: 1px solid color-mix(in srgb, var(--color-outline-variant) 24%, transparent);
background: color-mix(in srgb, var(--color-surface) 92%, transparent);

/* ✅ 使用语义别名 */
color: var(--color-destructive);

/* ❌ 硬编码颜色 */
background: #ffffff;
color: #dc2626;
```

### 10.3 硬编码颜色的豁免清单

只有以下文件允许硬编码颜色，且必须注明原因：

| 文件                          | 原因                           |
| ----------------------------- | ------------------------------ |
| `styles/global.css`           | CSS 变量定义本身               |
| `lib/colorSchemes.ts`         | 配色方案数据源                 |
| `lib/colorScheme.ts`          | 调色板生成算法                 |
| `components/3d/*`             | WebGL/Three.js 材质需要 hex 值 |
| `pages/InquiryDetailPage.tsx` | 打印/PDF 模板（独立于主题）    |
| `pages/SettingsPage.tsx`      | 配色编辑器 UI                  |

### 10.4 Tailwind class 使用规范

```tsx
// ✅ 使用 CSS 变量映射的 Tailwind class
className = 'bg-surface text-on-surface border-outline-variant';

// ✅ 使用 /opacity 语法
className = 'bg-surface-container-high/70 text-primary-container';

// ✅ 使用语义别名对应的 Tailwind class
className = 'text-destructive bg-cta';

// ❌ 直接使用 Tailwind 默认颜色
className = 'bg-gray-100 text-gray-500 border-gray-200';

// ❌ 方括号内硬编码颜色
className = 'bg-[#1a1a2e] text-[#94a3b8]';
```

---

## 11. 服务器端设置对接

### 11.1 主题相关的数据库设置项

| key                     | 类型          | 默认值        | 说明                       |
| ----------------------- | ------------- | ------------- | -------------------------- |
| `interface_theme`       | string        | `'workbench'` | 界面主题 key               |
| `color_scheme`          | string        | `'orange'`    | 配色方案 key               |
| `color_custom_dark`     | string (JSON) | `'{}'`        | 自定义配色 dark 值         |
| `color_custom_light`    | string (JSON) | `'{}'`        | 自定义配色 light 值        |
| `default_theme`         | string        | `'light'`     | 默认模式 dark/light/system |
| `auto_theme_enabled`    | boolean       | `false`       | 是否自动切换暗色/亮色      |
| `auto_theme_dark_hour`  | number        | `20`          | 自动切暗色的小时           |
| `auto_theme_light_hour` | number        | `8`           | 自动切亮色的小时           |

### 11.2 服务端注册新设置项

1. `server/src/lib/settings.ts` — 在 `DEFAULTS` 数组中添加
2. `server/src/routes/settings/public.ts` — 在公开 API 响应中暴露
3. `client/src/types/user.ts` — 在 `SystemSettings` 接口中添加
4. `client/src/api/settings.ts` — 如果需要专用 API

---

## 12. 新增主题完整步骤

### Checklist

```
□ 1.  确定主题 key（英文小写，如 'magazine'）
□ 2.  在 InterfaceThemeKey 联合类型中添加 key
       → client/src/themes/interfaceThemes/types.ts

□ 3.  创建目录结构（可先用脚手架生成）
       → cd client && npm run create-theme -- --key magazine --label "Magazine"

□ 4.  创建或替换主题预览图（可选）
       → client/public/interface-themes/magazine-preview.svg

□ 5.  编写 manifest.ts
       → key='magazine', label, description, screenshot, capabilities

□ 6.  编写 tokens/appearance.ts
       → sidebarAppearance, bottomNavAppearance, mobileDrawerAppearance

□ 7.  编写 layouts/ 四个文件
       → TopNav.tsx, Sidebar.tsx, BottomNav.tsx, MobileNavDrawer.tsx

□ 8.  编写 templates/HomeDesktop.tsx、AuthDialog.tsx、Login.tsx、NotFound.tsx
       → HomeDesktop 必须包含 data-home-theme="magazine"
       → AuthDialog / Login / NotFound 通过 props 接收页面内容，不直接处理业务状态

□ 9.  编写 theme.ts
       → 组装所有部件，导出 InterfaceThemePackage

□ 10. 编写 index.ts
       → export { default } from './theme';

□ 11. 如需主题私有 CSS，创建 styles.css
       → 选择器必须以 [data-interface-theme='magazine'] 开头
       → theme.ts 中 import './styles.css'

□ 12. 如有主题私有组件，放入 components/

□ 13. 注册到 catalog.ts
       → import manifest, 添加到 INTERFACE_THEME_CATALOG

□ 14. 注册到 registry.ts
       → import theme, 添加到 INTERFACE_THEME_PACKAGES

□ 15. 如有新增 key，更新服务端 INTERFACE_THEME_KEYS 环境变量

□ 16. 添加服务端设置项（如果主题有新的可配置项）

□ 17. 运行验证
       → cd client && npm run verify:themes

□ 18. 运行完整检查
       → cd client && npm run verify

□ 19. 在 SettingsPage 手动切换主题测试
       → 确认暗色/亮色切换正常
       → 确认所有配色方案在新主题下正常
       → 确认移动端布局正常
       → 确认管理后台布局正常
```

脚手架只负责生成主题目录骨架；`InterfaceThemeKey`、`catalog.ts`、`registry.ts` 仍需人工注册，避免脚本误改主题注册表。

---

## 13. 验证与 CI

### 13.1 验证脚本（`verify-theme-contract.mjs`）

当前验证内容：

| 检查项                                    | 说明                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| 目录结构                                  | 每个主题目录存在，且有全部必需文件                                                  |
| 目录洁癖                                  | 主题根目录不含非标准文件                                                            |
| index.ts                                  | 只 re-export ./theme                                                                |
| manifest.ts                               | 包含正确的 key 和 capabilities                                                      |
| theme.ts                                  | 包含 manifest/home/chrome/templates/components 全部字段                             |
| HomeDesktop.tsx                           | 包含 `data-home-theme="<key>"`                                                      |
| AuthDialog.tsx / Login.tsx / NotFound.tsx | 每个主题都必须提供登录弹窗、登录页和 404 页面模板                                   |
| 模板依赖方向                              | 主题文件不能 import `pages/`，模板不能直接 import `publicSettings/homeSearchState`  |
| 无跨主题引用                              | 主题文件不能 import 另一个主题                                                      |
| shared 中立性                             | `themes/interfaceThemes/shared/` 不允许出现具体主题名或主题私有实现                 |
| 基础样式层                                | `registry.ts` 必须加载 `themes/interfaceThemes/shared/base.css`                     |
| AuthModal 模板化                          | 通用 AuthModal 必须消费 `ThemePackage.templates.AuthDialog`，不允许写主题私有 class |
| 业务层隔离                                | 非主题文件不得 import 主题内部目录，只能使用 registry/catalog/types 公开入口        |
| styles.css 导入                           | 如有 styles.css，theme.ts 必须导入                                                  |
| catalog.ts                                | 包含所有主题的 manifest 引用                                                        |
| registry.ts                               | 不包含已废弃的 INTERFACE_THEME_COMPONENTS                                           |
| 核心文件规则                              | 核心文件不包含硬编码主题 key 比较                                                   |
| 颜色变量完整性                            | global.css / colorSchemes.ts / colorScheme.ts 包含所有 30 个 COLOR_KEYS             |
| 颜色类型完整性                            | ColorPreset.dark/light 必须是 Record<ColorKey, string>                              |
| 硬编码颜色扫描                            | 新文件不允许硬编码颜色（豁免清单除外）                                              |
| global.css 主题隔离                       | global.css 不含主题特有选择器                                                       |

### 13.2 CI 集成

`npm run verify` 包含 `verify:themes`，在每次 `npm run verify`（CI 入口）时自动运行。

---

## 14. 已知问题与待优化

### 14.1 已修复并由契约守护

| #   | 问题                                                         | 位置              | 处理                                                                                 |
| --- | ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------ |
| 1   | **`createSurfacePalette` 输出 `hsl()` 格式，与 `#hex` 混用** | `colorSchemes.ts` | 已统一为 `hslToHex` 输出；`verify:themes` 会检查不得输出 `hsl()` 字符串              |
| 2   | **`normalizeInterfaceTheme` 硬编码 fallback 逻辑**           | `catalog.ts`      | 已改为基于 `INTERFACE_THEME_CATALOG` 的泛化匹配；新增第三个主题后不会被固定 fallback |
| 3   | `verify-theme-contract.mjs` 的 `themeKeys` 手动维护          | `scripts/`        | 已从主题目录自动发现，并增加主题 import 沙盒白名单                                   |
| 4   | SettingsPage 主题切换缺少预览图                              | `SettingsPage`    | 已支持 manifest screenshot，并改为缩略图卡片选择器                                   |

### 14.2 建议优化

| #   | 建议                                                                                                                                                                       | 优先级 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Appearance token 从纯 className 字符串改为结构化对象（如 `{ root: CSSProperties, item: { active: CSSProperties, inactive: CSSProperties } }`），通过 renderer 转 className | 低     |
| 2   | 为 InterfaceThemePackage 增加版本迁移机制（类似 WordPress 的 `after_setup_theme` hook），方便主题升级                                                                      | 低     |
| 3   | 主题预览沙盒：SettingsPage 不保存即可预览主题效果                                                                                                                          | 低     |
