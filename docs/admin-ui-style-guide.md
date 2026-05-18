# 后台 UI 规范

这份规范用于统一 `/admin/*` 页面。后续新增或重构后台页面时，先使用这里列出的共享组件和尺寸，不再在页面里临时拼一套标题、Tab、按钮或表格样式。

## 1. 页面骨架

后台页面统一使用：

- `AdminPageShell`：负责后台布局、主题侧边栏、移动端底部导航处理。
- `AdminManagementPage`：负责页头、描述、操作按钮、统计区、工具栏和内容区间距。
- `AdminContentPanel`：负责内容卡片边框、圆角、背景和滚动容器。

标准结构：

```tsx
<AdminPageShell>
  <AdminManagementPage
    title="页面标题"
    description="一句话说明当前页面职责"
    actions={actions}
    stats={stats}
    toolbar={toolbar}
  >
    <AdminContentPanel scroll>{content}</AdminContentPanel>
  </AdminManagementPage>
</AdminPageShell>
```

## 2. 字体层级

后台要偏工具型和数据型，避免大字、重字和营销式排版。

| 区域       | 标准                                           |
| ---------- | ---------------------------------------------- |
| 页面标题   | `text-base font-semibold leading-6 md:text-lg` |
| 详情页标题 | `text-base font-semibold leading-6 md:text-lg` |
| 页面描述   | `text-xs text-on-surface-variant`              |
| 内容区标题 | `text-sm font-semibold`                        |
| 行主标题   | `text-sm font-medium leading-5`                |
| 行辅助信息 | `text-xs text-on-surface-variant`              |
| 表格正文   | `text-xs leading-5`                            |
| 表头       | `text-[10px] font-semibold`                    |
| 数字统计   | `text-sm font-semibold`                        |

原则：

- `font-bold` 只用于极少数关键数字或弹窗强提醒，常规后台页面优先 `font-medium` / `font-semibold`。
- 后台页面不要使用 `text-xl` 及以上字号，除非是独立报表大屏。
- 不使用 `tracking-*` 做表头或标题，保持字距为默认值。

## 3. 页头与操作区

页头只通过 `AdminManagementPage` 输出。不要在页面内部再写一套大标题卡片。

标准尺寸：

- 页头容器：`rounded-xl border border-outline-variant/15 bg-surface-container-low px-4 py-2.5 md:px-5`
- 页头最小高度：`54px`
- 操作按钮区域：`flex items-center justify-end gap-2`

刷新按钮统一使用 `AdminRefreshButton`。新增、保存、删除、导出等操作统一使用 `AdminButton` 或 `AdminIconButton`。

## 4. Tab 与搜索工具栏

后台分类、状态、角色、类型切换统一使用 `ResponsiveSectionTabs`。

标准工具栏结构：

```tsx
const toolbar = (
  <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0 flex-1">
      <ResponsiveSectionTabs tabs={tabs} value={value} onChange={setValue} mobileTitle="分类" />
    </div>
    <SearchField className="md:w-72 md:shrink-0" ... />
  </div>
);
```

`ResponsiveSectionTabs` 当前标准：

- 桌面 Tab 高度：`h-8`
- 桌面字体：`text-xs font-medium`
- 图标：`14px`
- 数量：`text-[10px]` + 数字 `text-[11px]`
- 选中线：`h-px`

只有系统设置这类二级导航可以使用 `desktopVariant="subtle"`。普通后台页面不要单独写胶囊 Tab、按钮组 Tab 或不同高度的 Tab。

## 5. 按钮

统一入口：

- `AdminButton`
- `AdminIconButton`
- `adminButtonClass`
- `adminIconSize`

标准尺寸：

| 用途         | size      | 高度      | 字号        |
| ------------ | --------- | --------- | ----------- |
| 常规按钮     | `md`      | `h-9`     | `text-xs`   |
| 紧凑按钮     | `sm`      | `h-8`     | `text-xs`   |
| 常规图标按钮 | `icon-md` | `h-9 w-9` | 图标 `16px` |
| 紧凑图标按钮 | `icon-sm` | `h-8 w-8` | 图标 `14px` |

按钮语义：

- `primary`：页面主动作，例如新增、上传、保存。
- `secondary`：普通动作，例如刷新、取消、筛选。
- `tonal`：进入详情、查看、轻强调。
- `danger`：删除、清空、危险操作。
- `success`：分配、恢复、确认完成。
- `warning`：需要注意但不危险的动作。
- `ghost`：低视觉权重操作。

不要在页面里直接写 `rounded-sm bg-primary... text-sm font-bold` 这类临时按钮。

## 6. 搜索框

统一入口：`SearchField`。

标准：

- 外层高度：`h-9`
- 字号：`text-sm`
- 圆角：`rounded-lg`
- 边框：`border-outline-variant/20`
- 后台工具栏宽度：`md:w-72 md:shrink-0`

后台页面不要自己写搜索 input。需要 IME 安全输入时，继续使用 `useImeSafeSearchInput`，但 UI 仍然交给 `SearchField`。

## 7. 表单输入

统一入口：`FormControls.tsx`。

- `AppTextInput`
- `AppTextArea`
- `AppSelect`
- `AppFormLabel`
- `APP_FIELD_ERROR_CLASS`
- `APP_FIELD_HELP_CLASS`

标准：

- 常规后台表单：`fieldSize="md"`，高度 `h-9`，字号 `text-sm`。
- 登录、注册、移动弹窗等触控表单：`fieldSize="lg"`，高度 `h-10`，字号 `text-base`。
- 错误态统一传 `error={Boolean(errorMessage)}`，错误文案使用 `APP_FIELD_ERROR_CLASS`。
- 只允许隐藏文件、颜色选择、范围滑块、复选框等特殊控件直接写原生 input。

不要在页面里重复写 `bg-surface-container-lowest ... focus:border-primary-container` 这类输入框 class。

## 8. 表格与数据列表

新增或重构表格时使用 `AdminDataTable.tsx`：

- `AdminTable`
- `AdminTableHeadRow`
- `AdminTableHeadCell`
- `AdminTableBodyRow`
- `AdminTableCell`
- `AdminGridHeader`
- `AdminGridRow`
- `ADMIN_ROW_TITLE_CLASS`
- `ADMIN_ROW_META_CLASS`

标准表格：

```tsx
<AdminContentPanel scroll>
  <AdminTable>
    <thead>
      <AdminTableHeadRow>
        <AdminTableHeadCell>名称</AdminTableHeadCell>
        <AdminTableHeadCell>状态</AdminTableHeadCell>
      </AdminTableHeadRow>
    </thead>
    <tbody>
      <AdminTableBodyRow>
        <AdminTableCell>
          <span className={ADMIN_ROW_TITLE_CLASS}>模型名称</span>
        </AdminTableCell>
        <AdminTableCell muted>待处理</AdminTableCell>
      </AdminTableBodyRow>
    </tbody>
  </AdminTable>
</AdminContentPanel>
```

复杂数据网格：

```tsx
<AdminGridHeader columns="88px minmax(0,1fr) 120px 160px">
  <span>编号</span>
  <span>客户</span>
  <span>状态</span>
  <span className="text-right">操作</span>
</AdminGridHeader>
```

表格原则：

- 表头统一 `text-[10px] font-semibold`，不要使用 `uppercase tracking-wide`。
- 行主标题统一 `text-sm font-medium`。
- 行内容统一 `text-xs`，行高 `leading-5`。
- 行 hover 统一 `hover:bg-surface-container-high/45`。
- 表格放在 `AdminContentPanel` 内，滚动表格表头可以 sticky。

## 9. 图标

图标统一通过 `Icon` 组件，不写手绘 SVG。

| 场景                | 尺寸    |
| ------------------- | ------- |
| Tab 图标            | `14`    |
| 小按钮图标          | `14`    |
| 常规按钮图标        | `16`    |
| 统计卡图标          | `15`    |
| 返回/关闭等导航图标 | `18-20` |
| 空状态大图标        | `34`    |

后台页面不加普通图标 tooltip。只有顶部右上角图标、模型详情页等已约定区域保留 tooltip。

## 10. 颜色与圆角

颜色只使用主题 token：

- 背景：`bg-surface`、`bg-surface-container-low`、`bg-surface-container-high`
- 文字：`text-on-surface`、`text-on-surface-variant`
- 主色：`text-primary-container`、`bg-primary-container`
- 边框：`border-outline-variant/10`、`border-outline-variant/15`、`border-outline-variant/20`
- 危险：`text-error`、`bg-error/10`、`border-error/20`

后台卡片圆角以 `rounded-xl` 为主，按钮以 `rounded-md` / `rounded-lg` 为主。不要混用很大的胶囊和很小的直角按钮。

## 11. 迁移检查清单

改后台页面前检查：

- 页面是否使用 `AdminManagementPage`。
- 标题是否只来自 `title`，没有页面内部重复大标题。
- Tab 是否使用 `ResponsiveSectionTabs`。
- 工具栏是否是标准 `min-h-10` 布局。
- 搜索框是否使用 `SearchField`。
- 操作按钮是否使用 `AdminButton` / `AdminIconButton`。
- 表格或网格是否使用 `AdminDataTable` 的组件或常量。
- 是否还有 `text-xl`、`font-bold`、`tracking-*`、硬编码颜色。
- 图标是否来自 `Icon`，尺寸是否符合本规范。
- 空状态、加载状态是否使用 `AdminEmptyState` / `AdminLoadingState`。
