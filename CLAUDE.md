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

### 4. 构建并推送 Docker 镜像
```bash
# 客户端（注意在 client 目录执行）
cd client
docker build --build-arg VITE_APP_VERSION=v<版本号> \
  -t ghcr.io/liaoweixiang2024-blip/3dparthub-client:v<版本号> \
  -t ghcr.io/liaoweixiang2024-blip/3dparthub-client:latest .
docker push ghcr.io/liaoweixiang2024-blip/3dparthub-client:v<版本号>
docker push ghcr.io/liaoweixiang2024-blip/3dparthub-client:latest

# 服务端（注意在 server 目录执行）
cd ../server
docker build --build-arg APP_VERSION=v<版本号> \
  -t ghcr.io/liaoweixiang2024-blip/3dparthub-server:v<版本号> \
  -t ghcr.io/liaoweixiang2024-blip/3dparthub-server:latest .
docker push ghcr.io/liaoweixiang2024-blip/3dparthub-server:v<版本号>
docker push ghcr.io/liaoweixiang2024-blip/3dparthub-server:latest
```

### 5. 打标签
```bash
git tag -a v<版本号> -m "版本描述"
git push origin v<版本号>
```

### 6. 服务器更新
```bash
cd /opt/3dparthub
docker compose down
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
