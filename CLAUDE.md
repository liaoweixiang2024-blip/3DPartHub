# CLAUDE.md — 项目安全规则

## 数据库安全（最重要）

### 绝对禁止
- **禁止** 直接运行 `npx prisma db push --force-reset`
- **禁止** 直接运行 `npx prisma db push --accept-data-loss`
- **禁止** 直接运行 `npx prisma migrate reset`
- **禁止** 运行任何带 `--force-reset` 或 `--accept-data-loss` 的 prisma 命令

### Schema 变更流程
1. 修改 `server/prisma/schema.prisma`
2. 生成迁移文件：`npm run prisma:migrate -- --create-only --name <迁移名>`
3. 检查生成的迁移 SQL 文件
4. 应用迁移：`npm run prisma:deploy`
5. 如果必须重置（极端情况）：`npm run prisma:force-reset -- --i-know-what-im-doing`

### 安全脚本
所有 prisma 操作通过 `server/scripts/safe-migrate.sh` 执行：
- `npm run prisma:migrate -- --name <名>` — 开发迁移（自动备份）
- `npm run prisma:deploy` — 部署迁移（安全）
- `npm run prisma:backup` — 手动创建数据库快照
- `npm run prisma:force-reset -- --i-know-what-im-doing` — 危险操作（需确认）

快照存储在 `server/static/_safety_snapshots/`，自动保留 7 天。

## 发布流程（必须按顺序执行）

### 1. 本地检查
```bash
# 确认代码编译通过
cd client && npm run verify
cd ../server && npm run verify

# 确认数据库迁移同步（改了 schema 必须生成迁移文件）
cd server && npx prisma migrate status
```

### 2. 提交代码
```bash
git add <改动的文件>
git commit -m "描述本次变更"
git push origin main
```

### 3. 等待 CI 通过
- 推送后 GitHub Actions 自动运行检查
- **CI 报红就不要继续**，先修复再重新推送
- 检查项：TypeScript 编译、迁移文件同步、代码扫描

### 4. 打标签（触发自动构建镜像 + Release）
推送 `v*` 标签会自动触发 GitHub Actions（`.github/workflows/docker-build.yml`）：
构建并推送两端镜像（带版本号 + latest）、Trivy 漏洞扫描、自动创建 GitHub Release。约 8–9 分钟，等 workflow 变绿即可。
```bash
git tag -a v<版本号> -m "版本描述"
git push origin v<版本号>
# 在 GitHub → Actions 看 "Build & Push Docker Images" 跑完
```
镜像名（ghcr.io/liaoweixiang2024-blip/）：客户端 `3dparthub-web`、服务端 `3dparthub-api`（即 docker-compose.yml 里用的名字）。

> ⚠️ 仅当 CI 自动构建不可用时才手动 build/push（注意目录与镜像名）：
> ```bash
> # 客户端（client 目录）
> docker build --build-arg VITE_APP_VERSION=v<版本号> \
>   -t ghcr.io/liaoweixiang2024-blip/3dparthub-web:v<版本号> \
>   -t ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest .
> docker push ghcr.io/liaoweixiang2024-blip/3dparthub-web:v<版本号>
> docker push ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest
>
> # 服务端（server 目录）
> docker build --build-arg APP_VERSION=v<版本号> \
>   -t ghcr.io/liaoweixiang2024-blip/3dparthub-api:v<版本号> \
>   -t ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest .
> docker push ghcr.io/liaoweixiang2024-blip/3dparthub-api:v<版本号>
> docker push ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest
> ```

### 5. 服务器更新
```bash
cd /opt/3dparthub
docker compose pull
docker compose up -d
# 更新后强制刷新浏览器：Cmd+Shift+R（Mac）或 Ctrl+Shift+R（Windows）
```

## 常见问题检查清单

### 推送后服务器没变化？
1. 确认 Docker 镜像是否重新构建并推送了（不能只推代码不推镜像）
2. 服务器执行 `docker compose pull` 确认拉到新镜像
3. 用 `--force-recreate` 重建容器
4. 浏览器强制刷新（Cmd+Shift+R）清除缓存

### CI 报 Check pending Prisma migration 失败？
说明 `schema.prisma` 有改动但没有对应的迁移文件。执行：
```bash
cd server
npm run prisma:migrate -- --create-only --name <描述本次改动的名称>
git add prisma/migrations
git commit -m "feat: add migration for <描述>"
git push
```

### 数据库结构没更新？
确认迁移文件是否包含在提交里：
```bash
git status  # 检查 prisma/migrations/ 下有没有未提交的文件
```

## 项目结构

- `server/` — Node.js + Express 后端（TypeScript）
- `client/` — React + Vite 前端
- `server/prisma/` — 数据库 schema 和迁移
- `server/src/routes/` — API 路由
- `server/src/lib/` — 工具库
- `docs/` — 文档和数据文件

## 运行命令
- 后端稳定模式：`cd server && npm run dev`（端口 8000，备份/恢复期间推荐）
- 后端热重载：`cd server && npm run dev:watch`（仅开发代码时使用，备份/恢复期间不要使用）
- 前端：`cd client && npm run dev`（端口 5173，代理到 8000）
- 数据库：Docker PostgreSQL，端口 5433

## 选型系统
- 选型路由：`server/src/routes/selections.ts`
- 选型分享：`server/src/routes/selection-shares.ts`
- 前端选型页：`client/src/pages/SelectionPage.tsx`
- 产品数据种子：`server/prisma/seeds/products/batch*.ts`

## 前端页面开发规范

### 页面类型与组件模板

所有页面分为三类，新建页面必须按对应模板编写：

#### 类型一：列表管理页
用于：下载历史、我的收藏、我的分享、我的工单、我的询价、各类后台管理页

```tsx
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AdminManagementPage, AdminEmptyState } from '../components/shared/AdminManagementPage';
import LoadingSpinner from '../components/shared/LoadingSpinner';

export default function XxxPage() {
  useDocumentTitle('页面标题');
  const { data, error, isLoading } = useSWR('/api/xxx', fetchXxx);

  if (isLoading) {
    return (
      <AdminPageShell>
        <AdminManagementPage title="页面标题" meta="加载中..." description="页面描述">
          <LoadingSpinner />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  if (error) {
    return (
      <AdminPageShell>
        <AdminEmptyState icon="error" title="加载失败" description="请稍后重试。" />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <AdminManagementPage
        title="页面标题"
        meta={`${items.length} 条`}
        description="页面描述"
        toolbar={toolbar}
        actions={headerActions}
      >
        {items.length === 0 ? (
          <AdminEmptyState icon="xxx" title="暂无数据" description="说明文字" />
        ) : (
          /* 列表内容 */
        )}
      </AdminManagementPage>
    </AdminPageShell>
  );
}
```

#### 类型二：详情页
用于：工单详情、询价详情

```tsx
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AdminDetailHeader } from '../components/shared/AdminManagementPage';
import LoadingSpinner from '../components/shared/LoadingSpinner';

function DetailContent({ id }: { id: string }) {
  const { data, isLoading } = useSWR(`/api/xxx/${id}`, fetchDetail);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AdminDetailHeader title={data.title} description="描述" onBack={() => navigate(-1)} actions={actions} />
      {/* 详情内容 */}
    </div>
  );
}

export default function XxxDetailPage() {
  useDocumentTitle('详情');
  const { id } = useParams();
  return (
    <AdminPageShell>
      <DetailContent id={id!} />
    </AdminPageShell>
  );
}
```

#### 类型三：公开页/特殊页
用于：首页、模型详情、登录页、分享页、选型分享

公开页用 `PublicPageShell`，登录页用路由级 `ScrollPage` 包裹，模型详情页自行管理全屏布局。

### 共享组件索引

| 组件 | 文件 | 用途 |
|------|------|------|
| `AdminPageShell` | `components/shared/AdminPageShell.tsx` | 管理页外壳（上下文感知，Layout 内只渲染内容层） |
| `PublicPageShell` | `components/shared/PublicPageShell.tsx` | 公开页外壳 |
| `AdminManagementPage` | `components/shared/AdminManagementPage.tsx` | 列表页结构（页头+工具栏+内容区） |
| `AdminDetailHeader` | `components/shared/AdminManagementPage.tsx` | 详情页头部（标题+返回+操作） |
| `AdminStatsGrid` | `components/shared/AdminManagementPage.tsx` | 统计卡片网格 |
| `AdminContentPanel` | `components/shared/AdminManagementPage.tsx` | 可滚动内容面板 |
| `AdminEmptyState` | `components/shared/AdminManagementPage.tsx` | 空状态/错误状态占位 |
| `LoadingSpinner` | `components/shared/LoadingSpinner.tsx` | 统一加载转圈（`sm`/`md`/`lg` 三种尺寸） |
| `Icon` | `components/shared/Icon.tsx` | Material Icons 图标 |

### 加载状态规范

- **页面级加载**：统一使用 `<LoadingSpinner />`（默认 `md` 尺寸，28px）
- **紧凑内联加载**：使用 `<LoadingSpinner size="sm" />`（20px，用于统计区域、小面板）
- **全屏加载**：使用 `<LoadingSpinner size="lg" />`（40px，用于 ModelDetailPage 等全屏场景）
- **禁止**在页面级使用 `animate-pulse` 骨架屏或 Icon 旋转做加载动画
- **禁止**使用"加载中..."纯文字做加载状态
- 按钮内操作图标（刷新、保存等）的 `animate-spin` 不受此限制

### 路由级 Suspense 规范

- `PageWrap` / `ScrollPage`：`fallback={null}`（避免和页面级 LoadingSpinner 冲突导致跳动）
- `ProtectedPage` auth 等待态：`<LoadingSpinner />`（此时无 Layout，不会跳动）
- `ModelDetailPage` 路由 fallback：`<LoadingSpinner size="lg" />`（全屏场景）

### PC/移动端适配

- 列表页如需不同布局，使用 `useMediaQuery('(min-width: 768px)')` 拆分 `DesktopContent` / `MobileContent`
- 两者的加载状态必须统一使用 `<LoadingSpinner />`
- `AdminManagementPage` 已自适应移动端（自动隐藏部分工具栏元素）
