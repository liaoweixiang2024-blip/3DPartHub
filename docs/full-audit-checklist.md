# 3DPartHub 全站检查清单

> 覆盖前端 + 后端 + 主题系统 + 样式 + 类型安全。每项标注优先级和具体文件位置。

---

## 一、主题系统隔离

### 1.1 主题间代码隔离 ✅ 已通过

| #   | 检查项                            | 状态 | 备注                                                        |
| --- | --------------------------------- | ---- | ----------------------------------------------------------- |
| 1   | classic 不 import workbench       | ✅   | grep 确认零结果                                             |
| 2   | workbench 不 import classic       | ✅   | grep 确认零结果                                             |
| 3   | shared/ 无任何主题特有代码        | ✅   | 零 `classic`/`workbench` 引用                               |
| 4   | 核心文件无 `=== 'workbench'` 分支 | ✅   | AdminPageShell/PublicPageShell/TopNav/HomePage 全部走注册表 |

### 1.2 反向依赖（需修复）

| #   | 问题                                                                                                                                                         | 文件                                                                                                                             | 优先级 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 5   | **模板反向依赖 `pages/home/DesktopShared.tsx`**                                                                                                              | `classic/templates/HomeDesktop.tsx:5`、`workbench/templates/HomeDesktop.tsx:19`                                                  | 🔴 高  |
|     | 主题 import `AnnouncementBanner`、`SkeletonCard`、`SkeletonListCard`、`HeroPosterImage` — 这些应作为 render prop 传入或移到 `themes/interfaceThemes/shared/` |                                                                                                                                  |        |
| 6   | **模板反向依赖 `pages/home/types.ts`**                                                                                                                       | `classic/templates/HomeDesktop.tsx:6-7`、`classic/components/CategorySidebar.tsx:3`、`workbench/templates/HomeDesktop.tsx:20-21` | 🔴 高  |
|     | `DesktopHomeThemeProps`、`Category`、`Product` 类型应定义在 themes 层，pages 从 themes 重新导出                                                              |                                                                                                                                  |        |
| 7   | **workbench 模板直接调运行时函数**                                                                                                                           | `workbench/templates/HomeDesktop.tsx:7-13`                                                                                       | 🟡 中  |
|     | 直接 import `getContactEmail()`、`normalizeHomeSearchQuery()` 等业务函数，应通过 props 传入                                                                  |                                                                                                                                  |        |

### 1.3 CSS 隔离

| #   | 检查项                                                              | 文件                                                  | 状态 |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------- | ---- |
| 8   | global.css 无主题特有选择器                                         | `styles/global.css`                                   | ✅   |
| 9   | workbench styles.css 用 `[data-interface-theme='workbench']` 作用域 | `workbench/styles.css`                                | ✅   |
| 10  | classic 有空的 styles.css 占位文件                                  | `classic/styles.css`                                  | ✅   |
| 11  | 所有 shell 组件正确设置 `data-interface-theme` 属性                 | `AdminPageShell.tsx`(7处)、`PublicPageShell.tsx`(2处) | ✅   |
| 12  | HomePage 正确设置 `data-home-theme` 属性                            | `HomePage.tsx:2158`                                   | ✅   |

---

## 二、配色方案

| #   | 问题                                                                                   | 文件                         | 优先级 |
| --- | -------------------------------------------------------------------------------------- | ---------------------------- | ------ |
| 13  | **`createSurfacePalette` 输出 `hsl()` 格式，与预设 `#hex` 混用**                       | `colorSchemes.ts:56-57`      | 🔴 高  |
|     | `<input type="color">` 只接受 hex，导致 SettingsPage 配色编辑器中 surface 类显示为黑色 |                              |        |
| 14  | **`generatePaletteFromPrimary` 输出 hex，与预设的 `hsl()` 不统一**                     | `colorScheme.ts:125-223`     | 🔴 高  |
|     | 自定义配色 vs 预设配色格式不一致                                                       |                              |        |
| 15  | 预设的 surface 组用 `createSurfacePalette` 生成，accent 组手工维护                     | `colorSchemes.ts:100-105`    | 🟡 中  |
|     | 未来新增配色时手工维护 17 个 accent key 容易出错，建议也用算法生成                     |                              |        |
| 16  | `color_custom_dark/light` 存储为 JSON 字符串，无大小限制                               | `server/src/lib/settings.ts` | 🟢 低  |
|     | 恶意用户可能提交超大 JSON，建议限制字符数                                              |                              |        |

---

## 三、前端类型一致性

| #   | 问题                                                                                                       | 文件                                                | 优先级 |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| 17  | **SettingsPage `DEFAULT_SETTINGS` 缺少字段**                                                               | `pages/SettingsPage.tsx:85-144`                     | 🟡 中  |
|     | 缺少 `nav_user_items`、`nav_admin_items`、`upload_policy`、`page_size_policy`（SystemSettings 接口有定义） |                                                     |        |
| 18  | **`mat_original_*` 类型不一致**                                                                            | `api/settings.ts:66-68` vs `pages/SettingsPage.tsx` | 🟡 中  |
|     | SystemSettings 定义为 `string \| number`，DEFAULT_SETTINGS 里是空字符串，server 存的是 number              |                                                     |        |
| 19  | **ProfilePage 15 处 `(user as any).department`**                                                           | `pages/ProfilePage.tsx:359-909`                     | 🟡 中  |
|     | User 类型缺 `department`、`address`、`bio` 字段，补上类型后可删除所有 `as any`                             |                                                     |        |

---

## 四、后端验证

| #   | 问题                                                                                                                               | 文件                                                  | 优先级 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| 20  | **`color_scheme` 无后端校验**                                                                                                      | `server/src/lib/settings.ts` `validateSettingValue()` | 🟡 中  |
|     | 只校验了 `interface_theme`，`color_scheme` 可以写入任意字符串，建议校验 `['orange','blue','green','purple','red','teal','custom']` |                                                       |        |
| 21  | **`color_custom_dark/light` 无 JSON 校验**                                                                                         | `server/src/lib/settings.ts`                          | 🟡 中  |
|     | 建议在 validateSettingValue 中 try { JSON.parse(value) } catch { return DEFAULTS[key] }                                            |                                                       |        |
| 22  | **`auto_theme_dark_hour/light_hour` 无范围校验**                                                                                   | `server/src/lib/settings.ts`                          | 🟢 低  |
|     | 只校验了 isFinite，没有限制 0-23                                                                                                   |                                                       |        |
| 23  | **`interface_theme` 校验硬编码主题列表**                                                                                           | `server/src/lib/settings.ts:421-424`                  | 🟢 低  |
|     | `['workbench', 'classic'].includes(theme)` — 新增主题需同步改这里。建议从 catalog 动态取                                           |                                                       |        |

---

## 五、样式与 CSS

| #   | 问题                                                                  | 文件                                                                  | 优先级 |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| 24  | **`InquiryDetailPage.tsx` 约 20 个硬编码打印色值**                    | `pages/InquiryDetailPage.tsx:179-213`                                 | 🟢 低  |
|     | 打印模板场景独立，可后续提取为 `lib/printTheme.ts`                    |                                                                       |        |
| 25  | **3D 组件约 20 个硬编码色值**                                         | `components/3d/MultiFormatLoader.tsx`、`ModelViewer.tsx`、`Scene.tsx` | 🟢 低  |
|     | WebGL 材质需要 hex，可提取为 `lib/threeTheme.ts` 配置对象             |                                                                       |        |
| 26  | **global.css 语义 token `--color-shadow` 未区分 dark/light**          | `styles/global.css`                                                   | 🟢 低  |
|     | 暗色/亮色都用 `#000000`，目前可接受                                   |                                                                       |        |
| 27  | **workbench styles.css 714 行全部在单文件**                           | `workbench/styles.css`                                                | 🟢 低  |
|     | 可按功能拆分（floating-menu.css、hero.css、model-grid.css），但非必须 |                                                                       |        |

---

## 六、运行时行为

| #   | 问题                                                                                          | 文件                                   | 优先级 |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------- | ------ |
| 28  | **`COPYRIGHT_YEAR` 硬编码 `'2026'`**                                                          | `lib/publicSettings.ts:12`             | 🟢 低  |
|     | 明年需手动改，建议用 `new Date().getFullYear()`                                               |                                        |        |
| 29  | **主题切换需刷新才完全生效**                                                                  | `pages/SettingsPage.tsx`               | 🟡 中  |
|     | `publicSettings` 缓存 2 分钟，interface_theme 切换后 shell 组件不会立即替换。建议加即时预览   |                                        |        |
| 30  | **SettingsPage 配色编辑器 30 个 key 平铺显示**                                                | `pages/SettingsPage.tsx:1387`          | 🟡 中  |
|     | COLOR_KEYS 从 17 增到 30，建议按组折叠显示（surface / primary / secondary / tertiary / 其他） |                                        |        |
| 31  | **`verify-theme-contract.mjs` 的 `themeKeys` 硬编码**                                         | `scripts/verify-theme-contract.mjs:11` | 🟡 中  |
|     | 建议从文件系统自动发现 themes/interfaceThemes/\*/manifest.ts，避免新主题忘了加                |                                        |        |

---

## 七、架构优化（非紧急）

| #   | 建议                           | 说明                                                                                               | 优先级 |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------- | ------ |
| 32  | Appearance token 结构化        | 从 className 字符串改为 `{ root: CSSObject, item: { active, inactive } }`，renderer 统一转换       | 🟢 低  |
| 33  | 主题能力声明扩展               | capabilities 增加 `hero-section`、`category-sidebar`、`contact-panel` 等，替代 chrome 中的部分函数 | 🟢 低  |
| 34  | 主题预览缩略图                 | manifest 增加 `screenshot` 字段，SettingsPage 显示主题截图                                         | 🟢 低  |
| 35  | 主题沙盒 import 白名单         | verify 脚本限制主题只能 import shared/ + 白名单内的 components/ + lib/                             | 🟢 低  |
| 36  | 新增主题脚手架脚本             | `npm run create-theme -- --name xxx` 自动生成目录骨架                                              | 🟢 低  |
| 37  | 首页移动端模板化               | 新增 `HomeMobile.tsx` 模板，当前移动端布局硬编码在 HomePage                                        | 🟢 低  |
| 38  | ModelDetail 模板化             | 不同主题可能要不同的 3D 查看器/信息栏布局                                                          | 🟢 低  |
| 39  | Selection / ProductWall 模板化 | 布局复杂页面由主题控制                                                                             | 🟢 低  |

---

## 八、逐文件检查清单

### 前端主题核心文件

| 文件                                                         | 行数 | 检查项                                               | 状态  |
| ------------------------------------------------------------ | ---- | ---------------------------------------------------- | ----- |
| `themes/interfaceThemes/types.ts`                            | 98   | InterfaceThemeKey 完整、模板 props 类型完整          | ✅    |
| `themes/interfaceThemes/registry.ts`                         | 25   | 导出 PACKAGE + getter，无废弃 API                    | ✅    |
| `themes/interfaceThemes/catalog.ts`                          | 24   | normalize 泛化、OPTIONS 生成正确                     | ✅    |
| `themes/interfaceThemes/classic/theme.ts`                    | ~50  | manifest/home/chrome/templates/components 全齐       | ✅    |
| `themes/interfaceThemes/classic/manifest.ts`                 | ~15  | key='classic', capabilities 正确                     | ✅    |
| `themes/interfaceThemes/classic/tokens/appearance.ts`        | 67   | 3 个 appearance 对象，纯 CSS 变量                    | ✅    |
| `themes/interfaceThemes/classic/templates/HomeDesktop.tsx`   | 184  | data-home-theme="classic"，无硬编码色                | ✅    |
| `themes/interfaceThemes/classic/templates/Login.tsx`         | 36   | props 消费正确，无硬编码色                           | ✅    |
| `themes/interfaceThemes/classic/templates/NotFound.tsx`      | 12   | props 消费正确                                       | ✅    |
| `themes/interfaceThemes/classic/styles.css`                  | 1    | 空占位文件                                           | ✅    |
| `themes/interfaceThemes/workbench/theme.ts`                  | ~60  | manifest/home/chrome/templates/components 全齐       | ✅    |
| `themes/interfaceThemes/workbench/manifest.ts`               | ~15  | key='workbench', capabilities=['floating-menu']      | ✅    |
| `themes/interfaceThemes/workbench/tokens/appearance.ts`      | 68   | 3 个 appearance 对象，纯 CSS 变量                    | ✅    |
| `themes/interfaceThemes/workbench/templates/HomeDesktop.tsx` | 425  | data-home-theme="workbench"，⚠️ 直接 import lib 函数 | 见 #7 |
| `themes/interfaceThemes/workbench/templates/Login.tsx`       | 60   | props 消费正确，无硬编码色                           | ✅    |
| `themes/interfaceThemes/workbench/templates/NotFound.tsx`    | 14   | props 消费正确                                       | ✅    |
| `themes/interfaceThemes/workbench/styles.css`                | 714  | 全部用 `[data-interface-theme='workbench']` 作用域   | ✅    |
| `themes/interfaceThemes/shared/SidebarRenderer.tsx`          | —    | 无主题特有逻辑                                       | ✅    |
| `themes/interfaceThemes/shared/BottomNavRenderer.tsx`        | —    | 无主题特有逻辑                                       | ✅    |
| `themes/interfaceThemes/shared/MobileNavDrawerRenderer.tsx`  | —    | 无主题特有逻辑                                       | ✅    |

### 前端消费层文件

| 文件                                    | 检查项                                                                      | 状态 |
| --------------------------------------- | --------------------------------------------------------------------------- | ---- |
| `components/shared/AdminPageShell.tsx`  | 7 处 ThemePackage 访问，全走注册表                                          | ✅   |
| `components/shared/PublicPageShell.tsx` | 4 处 ThemePackage 访问，全走注册表                                          | ✅   |
| `components/shared/TopNav.tsx`          | 4 处 ThemePackage 访问，全走注册表，chrome.desktopSearch.placement 判断合法 | ✅   |
| `pages/HomePage.tsx`                    | ThemePackage.templates.DesktopHome + home 行为，全走注册表                  | ✅   |
| `pages/LoginPage.tsx`                   | ThemePackage.templates.Login，全走注册表                                    | ✅   |
| `router.tsx`                            | ThemePackage.templates.NotFound，全走注册表                                 | ✅   |
| `components/shared/HomeFooter.tsx`      | 全部 CSS 变量，无硬编码色                                                   | ✅   |
| `components/shared/BrandMark.tsx`       | 无主题特有代码                                                              | ✅   |

### 前端配色系统

| 文件                      | 检查项                                                                   | 状态      |
| ------------------------- | ------------------------------------------------------------------------ | --------- |
| `lib/colorSchemes.ts`     | ⚠️ `hsl()` 函数输出格式与 hex 不统一                                     | 见 #13    |
| `lib/colorScheme.ts`      | generatePaletteFromPrimary 输出 hex，satisfies 类型校验正确              | ⚠️ 见 #14 |
| `stores/useThemeStore.ts` | Zustand + persist，暗色/亮色切换正确                                     | ✅        |
| `lib/publicSettings.ts`   | applyAppearanceSettings + buildFooterCopyright，⚠️ COPYRIGHT_YEAR 硬编码 | 见 #28    |
| `styles/global.css`       | @theme 定义 30 个变量 + 6 个语义别名，.theme-light 覆盖完整              | ✅        |
| `styles/product-wall.css` | 全部改为 CSS 变量，无硬编码色                                            | ✅        |

### 后端文件

| 文件                                   | 检查项                                                                      | 状态         |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------ |
| `server/src/lib/settings.ts`           | interface_theme 校验有、⚠️ color_scheme 校验缺、⚠️ color_custom JSON 校验缺 | 见 #20-22    |
| `server/src/routes/settings/public.ts` | 8 个主题设置全部暴露                                                        | ✅           |
| `server/src/routes/settings/admin.ts`  | 保存走 validateSettingValue                                                 | ⚠️ 见 #20-23 |
| `server/prisma/schema.prisma`          | Setting 模型 key-value 存储，无主题相关列                                   | ✅           |

### 验证

| 文件                                | 检查项                          | 状态   |
| ----------------------------------- | ------------------------------- | ------ |
| `scripts/verify-theme-contract.mjs` | 15+ 检查项，⚠️ themeKeys 硬编码 | 见 #31 |
| `package.json` → `verify:themes`    | 已集成到 `npm run verify`       | ✅     |

---

## 九、优先级排序汇总

### 🔴 高优先级（影响功能）

| #   | 内容                                                                     |
| --- | ------------------------------------------------------------------------ |
| 5   | 模板反向依赖 pages/home/DesktopShared — 移到 shared/ 或改为 render props |
| 6   | 模板反向依赖 pages/home/types — 类型定义移到 themes 层                   |
| 13  | colorSchemes.ts hsl() 格式统一为 hex                                     |

### 🟡 中优先级（规范/体验）

| #   | 内容                                             |
| --- | ------------------------------------------------ |
| 7   | workbench 模板直接调运行时函数 → 改为 props 传入 |
| 14  | generatePaletteFromPrimary 与预设格式统一        |
| 17  | SettingsPage DEFAULT_SETTINGS 补齐缺失字段       |
| 18  | mat*original*\* 类型对齐                         |
| 19  | ProfilePage as any → 补 User 类型                |
| 20  | 后端 color_scheme 校验                           |
| 21  | 后端 color_custom_dark/light JSON 校验           |
| 29  | 主题切换即时预览                                 |
| 30  | 配色编辑器分组显示                               |
| 31  | 验证脚本 themeKeys 自动发现                      |

### 🟢 低优先级（锦上添花）

| #     | 内容                                         |
| ----- | -------------------------------------------- |
| 22-23 | 后端 hour 范围校验、interface_theme 动态列表 |
| 24-27 | 打印/3D/语义 token 样式优化                  |
| 28    | COPYRIGHT_YEAR 动态化                        |
| 32-39 | 架构优化（token 结构化、新模板、脚手架等）   |

---

## 十、修复进度记录

### 2026-05-11 已完善

| 清单项 | 状态      | 说明                                                                                                                                |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| #5     | ✅ 已修复 | `DesktopShared` 已迁入 `themes/interfaceThemes/shared/HomeDesktopShared.tsx`，主题模板不再反向依赖 `pages/home`                     |
| #6     | ✅ 已修复 | 首页主题类型已迁入 `themes/interfaceThemes/shared/homeTypes.ts` 与 `themes/interfaceThemes/types.ts`，`pages/home/*` 仅保留兼容转发 |
| #7     | ✅ 已修复 | workbench 首页模板不再直接 import `publicSettings/homeSearchState`，联系信息、版权、搜索规则均由 props 注入                         |
| #13    | ✅ 已修复 | `createSurfacePalette` 输出 hex，主题契约脚本已禁止 `hsl()` 字符串输出                                                              |
| #14    | ✅ 已修复 | `generatePaletteFromPrimary` 输出完整 hex 色板，主题契约脚本同步校验                                                                |
| #17    | ✅ 已修复 | `DEFAULT_SETTINGS` 已补齐 `nav_user_items`、`nav_admin_items`、`upload_policy`、`page_size_policy` 的真实默认值                     |
| #19    | ✅ 已修复 | `User` 类型已包含 `department/address/bio`，ProfilePage 不再需要相关 `as any`                                                       |
| #20    | ✅ 已修复 | 后端 `color_scheme` 已限制为预设值或 `custom`                                                                                       |
| #21    | ✅ 已修复 | 后端 `color_custom_dark/light` 已增加 JSON 对象校验和大小限制                                                                       |
| #22    | ✅ 已修复 | 后端自动主题小时值限制在 `0-23`                                                                                                     |
| #23    | ✅ 已改善 | 后端支持通过 `INTERFACE_THEME_KEYS` 环境变量扩展可保存的主题 key，默认仍为 `workbench,classic`                                      |
| #24    | ✅ 已修复 | 询价打印 CSS 已迁入 `lib/printTheme.ts`，报价单打印配色可集中维护                                                                   |
| #25    | ✅ 已改善 | 3D 场景/测量/上下文丢失提示色值已集中到 `themes/threeTheme.ts`，组件不再散落硬编码主色                                              |
| #26    | ✅ 已修复 | `.theme-light` 已单独覆盖 `--color-shadow`，暗色/亮色 shadow token 不再共用同一个值                                                 |
| #28    | ✅ 已修复 | 前后端版权年份改为运行时当前年份                                                                                                    |
| #29    | ✅ 已改善 | 后台切换界面主题时会即时更新 `publicSettings` SWR 缓存，shell 可立即预览                                                            |
| #30    | ✅ 已修复 | 自定义配色高级编辑器已按 Surface / Primary / Secondary / Tertiary / State 分组折叠展示                                              |
| #31    | ✅ 已修复 | `verify-theme-contract.mjs` 已从主题目录自动发现 theme key，不再硬编码 `workbench/classic`                                          |
| #33    | ✅ 已修复 | `capabilities` 已扩展并收紧为 `InterfaceThemeCapability[]`                                                                          |
| #34    | ✅ 已改善 | `manifest` 支持 `screenshot`，设置页界面主题改为带预览缩略图的卡片选择器                                                            |
| #35    | ✅ 已改善 | 主题契约脚本已增加 import 沙盒白名单；主题私有组件不再直接读取 `publicSettings`，悬浮菜单行为改由 shared renderer 承接              |
| #36    | ✅ 已改善 | 新增 `npm run create-theme` 脚手架，可生成主题目录骨架并提示注册步骤                                                                |

### 仍建议后续排期

| 清单项       | 状态   | 说明                                                                                   |
| ------------ | ------ | -------------------------------------------------------------------------------------- |
| #15          | 待排期 | 预设 accent 色板算法化，属于新增配色维护效率优化                                       |
| #18          | 观察中 | `mat_original_*` 需要支持“空值=使用模型原始值”，当前 `string \| number` 与 UI 行为一致 |
| #27          | 待排期 | workbench CSS 拆分，主要是样式工程化优化                                               |
| #32 / #37-39 | 待排期 | 主题结构化 token、移动首页/模型详情/选型/产品墙模板化                                  |
