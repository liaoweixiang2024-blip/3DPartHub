<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">3DPartHub</h1>

<p align="center">
  <strong>企业级 3D 零件模型管理平台</strong><br/>
  开源的 3D CAD 模型管理、格式转换、在线预览、产品选型、询价报价与后台运维平台
</p>

---

3DPartHub 专为制造企业团队管理 3D 零件模型与产品选型数据而设计。系统支持 STEP / IGES / Parasolid 文件自动转换为 glTF，在浏览器内实时 3D 预览，并提供分类管理、选型筛选、询价报价、分享、审计、备份恢复和完整后台设置。

> V2.6.3 发行版只包含通用源码、数据库结构、迁移、Docker/CI 配置和文档。数据库、模型文件、缩略图、Logo、Favicon、产品图片、企业资料、业务批次脚本、Excel/PDF 私有资料等运行时或定制内容不会随 Git 仓库和镜像发布。

## 先看运行规范

本项目区分三种运行模式：本地开发调试、本地完整容器测试、生产纯 Docker 部署。启动项目前请先阅读 [运行环境规范](docs/运行环境规范.md)，避免把 `5173`、`8000`、`5433`、`6380`、`3780` 和生产容器网络混在一起。

目录职责请看 [Project Structure](PROJECT_STRUCTURE.md)，私有资料、运行时文件和源码不要混放。代码提交前检查、API 响应解析、错误提示和分层规则请看 [代码维护规范](docs/代码维护规范.md)。上线前压测和并发参数请看 [并发压测与部署调优](docs/并发压测与部署调优.md)。

生产部署以仓库根目录的 [docker-compose.yml](docker-compose.yml) 为唯一主入口，`deploy/` 目录只保留历史部署参考说明。

常用约定：

| 场景 | 前端 | 后端 | 数据库 | Redis |
|------|------|------|--------|-------|
| 本地开发 | `localhost:5173` | `localhost:8000` | `localhost:5433` | `localhost:6380` |
| 生产部署 | Docker `web` | Docker `api` | Docker `postgres:5432` | Docker `redis:6379` |

提交前可执行：

```bash
bash scripts/verify-local.sh
```

## V2.6.3 更新

- **备份目录权限自动修复**：新增 `backup-permissions` 一次性初始化服务，在 API 启动前自动创建 `/app/static/backups/.work` 并把宿主机备份目录授权给容器内 `node` 用户。
- **新服务器部署更稳**：避免宿主机目录由 `root` 创建后导致 API 报 `EACCES: permission denied, mkdir '/app/static/backups/.work'`。
- **历史部署可自愈**：更新 compose 后执行 `docker compose up -d --force-recreate` 会先运行权限初始化，再启动 API/Web。

## V2.6.2 更新

- **备份目录宿主机化**：生产 Compose 将 `/app/static/backups` 单独映射到 `/opt/3dparthub/server/static/backups`，网页备份和手动导入备份都能直接在宿主机目录查看与迁移。
- **备份恢复体验增强**：刷新页面后能区分备份记录恢复、上传恢复和服务器文件恢复，恢复任务状态显示更准确；备份包 SHA256 计算阶段增加进度反馈。
- **本地开发入口固定**：前端开发端口固定为 `127.0.0.1:5173`，后端固定为 `127.0.0.1:8000`，本地检查脚本和运行规范同步更新，避免端口漂移。
- **部署脚本同步**：一键部署脚本会创建宿主机备份目录，并提示旧 Compose 未挂载备份目录的情况。

## V2.6.1 更新

- **自动更新默认开启**：生产 Compose 默认使用 `latest` 镜像，并启动 Watchtower 每小时自动检查和更新 API/Web 容器。
- **后台更新命令修复**：后台「系统更新」里的命令去掉 shell 提示符 `$`，并自动把旧 `.env` 中的 `IMAGE_TAG` 改为 `latest`，避免继续锁在旧版本。
- **部署文档同步**：README、历史部署说明、一键部署脚本和 Release 自动说明同步改为 `latest + Watchtower` 的更新方式。

## V2.6 更新

- **产品墙后台化**：产品墙从静态素材升级为数据库管理，支持图片/文件夹/ZIP/RAR 上传、分类、审核、批量操作、收藏、下载、复制链接和后台管理。
- **螺纹尺寸工具增强**：螺纹、管径、软管和接头尺寸数据迁移到数据库，补充大规格条目、筛选、移动端布局和后台可维护能力。
- **登录与后台体验修复**：优化认证状态 hydration、Token 检查、受保护路由跳转、后台分页/管理页布局、审计、询价、工单、下载、模型和设置页体验。
- **站点内容与法务配置**：抽离法务内容、补充公开设置接口、扩展业务配置默认值和后台显示字段，便于部署后做站点级配置。
- **备份恢复与上传增强**：备份范围覆盖产品墙资源，上传会话、任务状态、验证码和 cookie 处理更稳，导入恢复流程继续保护运行时数据。
- **NAS/服务器部署优化**：Compose 默认使用 `latest` 镜像并启用 Watchtower 自动更新 API/Web，支持无 `.env` 快速启动、默认初始管理员、离线镜像包导入和慢网络部署说明。

## Release 与镜像

| 项目 | 值 |
|------|----|
| Tag | `v2.6.3` |
| Release 标题 | `V2.6.3 - 自动修复备份目录权限` |
| API 镜像 | `ghcr.io/liaoweixiang2024-blip/3dparthub-api:v2.6.3` / `ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest` |
| Web 镜像 | `ghcr.io/liaoweixiang2024-blip/3dparthub-web:v2.6.3` / `ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest` |
| 自动更新 | 默认部署使用 `latest`，Watchtower 每小时自动更新 API/Web 容器 |

镜像说明：

- `3dparthub-api`：Express 5 + Prisma 后端，包含数据库迁移、隔离模型转换、转换队列、预览元数据、后台设置、备份/恢复、审计与 API 服务。
- `3dparthub-web`：React 19 + Vite 前端，包含 CAD 在线查看器、3D 预览、产品选型、询价报价、分享页和后台管理界面。

后台 **设置 -> 系统更新 -> 检查更新** 会读取 GitHub 最新 Release 的描述内容，并显示为后台更新日志。发布 V2.6.3 时，请以 Release 描述作为用户可见更新简介。

---

## 功能特性

### 3D 模型管理

- **多格式支持**：STEP (`.step` / `.stp`)、IGES (`.iges` / `.igs`)、Parasolid (`.xt` / `.x_t`) 自动转换为 glTF。
- **浏览器 CAD 预览**：基于 Three.js 的实时渲染，支持线框、实体、透明、爆炸视图、边线、裁切、测量、结构树、属性面板和缩略图。
- **批量导入**：扫描服务器目录批量导入，按文件夹结构自动归类。
- **无限级分类**：树形分类体系，支持拖拽排序。
- **全文搜索**：按名称、格式、分类和元数据多维检索。

### 产品选型

- **分级筛选**：按产品大类、二级类目、规格参数逐步筛选。
- **智能匹配**：选型产品可关联 3D 模型，支持预览、收藏、下载和询价。
- **选型后台**：分类管理、分组维护、产品增删改、JSON 批量导入。
- **参数排序**：支持数值排序、螺纹规则排序、字段别名和业务优先级配置。

### 询价与报价

- **在线询价**：从选型结果一键发起询价，支持多产品、多规格明细。
- **报价管理**：管理员录入报价、更新状态，买卖双方留言沟通。
- **报价模板**：可视化编辑器，支持区块排序、字段开关、自定义内容和 A4 实时预览。
- **报价打印**：按模板配置生成格式化打印报价单。

### 系统管理

- **RBAC 权限**：管理员、编辑、查看者三级角色。
- **数据备份**：数据库、模型文件、转换文件、缩略图、上传文件、站点品牌和配置类运行时资料完整备份与恢复。
- **版本检测**：检查 GitHub Release，后台展示最新版本、Release 链接和更新内容。
- **站点自定义**：站名、Logo、Favicon、配色方案、SEO、公告和邮件模板。
- **安全与审计**：登录保护、下载策略、分享策略、IP/Host 保护、审计日志。

---

## 快速部署

### 环境要求

- Docker 20.10+
- Docker Compose 2.0+

### 一键部署

```bash
mkdir -p /opt/3dparthub && cd /opt/3dparthub
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
docker compose up -d
```

根目录 [docker-compose.yml](docker-compose.yml) 内置了可直接启动的默认值，适合绿联 NAS、测试机或内网快速部署。默认使用 `latest` 镜像，并通过 Watchtower 每小时自动检查和更新 API/Web 容器；PostgreSQL 和 Redis 不会被自动更新。

正式公网环境建议在同目录创建 `.env` 覆盖数据库密码、JWT 密钥和初始管理员密码：

```bash
DB_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 32)"
ADMIN_PASS="$(openssl rand -base64 24)"
cat > .env <<EOF
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ADMIN_PASS=${ADMIN_PASS}
EOF
docker compose up -d
```

如果 GHCR 镜像包仍为私有，服务器需要先使用有 `read:packages` 权限的 GitHub Token 登录：

```bash
echo "你的GitHub Token" | docker login ghcr.io -u liaoweixiang2024-blip --password-stdin
docker compose pull
docker compose up -d
```

如果服务器或 NAS 拉取 Docker Hub / GHCR 速度过慢，可以在可访问外网的机器上导出离线镜像包，然后在目标机器执行 `docker load -i 3dparthub-images.tar` 后再 `docker compose up -d`。

检查服务状态：

```bash
docker compose ps
docker compose logs api | tail -20
curl http://localhost:3780/api/health
```

首次启动会自动创建管理员账号：

| 项目 | 默认值 |
|------|--------|
| 邮箱 | `.env` 中的 `ADMIN_EMAIL`，默认 `admin@model.local` |
| 密码 | `.env` 中的 `ADMIN_PASS`，未设置时为 `3DPartHub@2026` |
| 说明 | 管理员只在空数据库首次启动时创建；首次登录后会强制修改密码 |

自定义管理员账号可在 `.env` 中设置 `ADMIN_USER`、`ADMIN_EMAIL`、`ADMIN_PASS`，仅首次启动时生效。

如果已经启动过、恢复过备份或 Docker volume 中已有管理员账号，修改 `ADMIN_PASS` 不会覆盖旧密码。需要重置时可在 `api` 容器内更新管理员密码。

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_PASSWORD` | 否 | `3dparthub-default-db-password-change-me-2026` | 数据库密码，正式环境建议在 `.env` 中覆盖 |
| `JWT_SECRET` | 否 | `3dparthub-default-jwt-secret-change-me-2026-04-30` | JWT 签名密钥，正式环境建议至少 32 位随机字符串 |
| `PORT` | 否 | `3780` | 对外访问端口 |
| `ALLOWED_ORIGINS` | 否 | - | CORS 域名，多个用逗号分隔 |
| `ADMIN_USER` | 否 | `admin` | 初始管理员用户名，仅首次启动 |
| `ADMIN_EMAIL` | 否 | `admin@model.local` | 初始管理员邮箱，仅首次启动 |
| `ADMIN_PASS` | 否 | `3DPartHub@2026` | 初始管理员密码，仅空数据库首次启动生效 |
| `IMAGE_TAG` | 否 | `latest` | 镜像标签；默认自动跟随最新版本，写入 `v2.6.3` 等固定标签可锁定版本 |
| `WATCHTOWER_POLL_INTERVAL` | 否 | `3600` | Watchtower 自动检查间隔，单位秒 |
| `SMTP_HOST` | 否 | - | SMTP 服务器 |
| `SMTP_USER` | 否 | - | SMTP 用户名 |
| `SMTP_PASS` | 否 | - | SMTP 密码或授权码 |

### 自动更新与立即升级

默认部署会启动 `3dparthub-watchtower`，它只更新带标签的 `api` 和 `web` 容器。需要立即升级时执行：

```bash
cd /opt/3dparthub
curl -L -o docker-compose.yml https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
touch .env
grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env || echo 'IMAGE_TAG=latest' >> .env
docker compose pull
docker compose up -d --force-recreate
docker compose logs -f api
```

### 使用指定版本镜像

```bash
cd /opt/3dparthub
IMAGE_TAG=v2.6.3 docker compose pull
IMAGE_TAG=v2.6.3 docker compose up -d
curl http://localhost:3780/api/health
```

也可以在 `.env` 中写入：

```bash
IMAGE_TAG=v2.6.3
```

写入固定 `IMAGE_TAG` 后，部署会锁定在该版本，不会自动升级到新的 Release；要恢复自动更新，请删除 `.env` 中的 `IMAGE_TAG` 或改为 `IMAGE_TAG=latest`。

### 升级版本

```bash
cd /opt/3dparthub

# 1. 更新部署配置
curl -L -o docker-compose.yml https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml

# 2. 确保恢复 latest 自动更新
touch .env
grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env || echo 'IMAGE_TAG=latest' >> .env

# 3. 拉取新镜像并重启
docker compose pull
docker compose up -d --force-recreate

# 4. 检查迁移和服务日志
docker compose logs -f api

# 5. 验证服务正常
curl http://localhost:3780/api/health
```

升级前建议在后台 **设置 -> 数据备份** 创建并校验一次备份。

---

## 数据与隐私

公开仓库和发行镜像不会包含以下内容：

- `.env`、数据库密码、JWT 密钥、SMTP 密码等环境配置。
- PostgreSQL 数据库、SQL dump、后台备份包、安全快照。
- STEP/IGES/XT 原始模型、glTF 转换模型、缩略图、图纸、上传附件。
- Logo、Favicon、水印、产品选型图片、企业定制图片。
- 企业产品批次脚本、业务 Excel/PDF、私有资料和本地导入数据。

需要迁移企业数据时，请使用后台备份功能导出 `.tar.gz` 和 `.json` 备份记录，再在新服务器恢复。不要把运行时数据提交到 Git。

## 数据持久化

默认 Docker Compose 使用命名卷持久化数据：

| 卷名 | 容器内路径 | 内容 |
|------|-----------|------|
| `pgdata` | `/var/lib/postgresql/data` | PostgreSQL 数据库 |
| `uploads-data` | `/app/uploads` | 上传附件、上传元数据 |
| `static-data` | `/app/static` | 转换模型、缩略图、原始文件、站点运行时静态资料 |

备份包单独映射到宿主机目录 `/opt/3dparthub/server/static/backups`，容器内路径为 `/app/static/backups`。网页创建的备份和手动放入的 `.tar.gz/.tgz` 备份包都会使用这个目录。

**备份文件位置：**

```text
/opt/3dparthub/server/static/backups
```

**从其他机器导入备份到服务器：** 只要把备份文件放进这个目录即可，后台会在 **设置 -> 数据备份 -> 服务器文件** 里识别。备份通常包含一个 `.tar.gz` 或 `.tgz` 归档，以及同名 `.json` 记录文件；有 `.json` 时一起放进去。

```bash
mkdir -p /opt/3dparthub/server/static/backups
cp /tmp/backup_XXXX.* /opt/3dparthub/server/static/backups/
```

不需要再执行 `docker cp`，也不要把备份包提交到 Git。

Compose 会先运行 `backup-permissions` 一次性初始化服务，自动修复该目录的 UID/GID 权限，避免 API 因无法创建 `/app/static/backups/.work` 而启动失败。

## 备份与恢复

V2.6 备份包沿用完整备份格式，包含：

- PostgreSQL 全量 dump。
- `static` 下自动发现的业务目录，例如 `models`、`thumbnails`、`originals`、`drawings`、`option-images`、`logo`、`favicon`、`watermark` 等。
- `uploads` 下的业务上传目录与 `.metadata` 上传元数据。
- manifest 3.0 清单、数据库 SHA256、目录文件数量和体积信息。

恢复保护机制：

- 恢复前校验备份包结构、manifest、数据库 SHA256、目录文件数。
- 恢复前检查磁盘可用空间，不满足安全回滚空间时会中止。
- 恢复前创建当前数据库安全快照。
- 数据库恢复失败会自动回滚到安全快照。
- 文件目录按目录逐个恢复，保留旧目录回滚副本；文件恢复失败会回滚已替换目录。
- 恢复完成后清理缓存，使后台立即读取恢复后的数据。

本仓库已用本地真实数据做过 V2.3 端到端校验：创建备份、导入备份、从导入备份恢复，再比对数据库和业务文件指纹。校验结果为 `22` 张表、`15522` 行、`19872` 个业务文件、约 `24.68GB` 恢复前后一致。V2.6 继续沿用完整备份格式，并将产品墙资源纳入运行时备份范围，继续使用同一套恢复校验机制。

### 迁移到新服务器

旧服务器：

```bash
# 1. 后台「设置 -> 数据备份」创建并校验备份
# 2. 备份文件在宿主机目录
ls /opt/3dparthub/server/static/backups/

# 3. 传到新服务器
scp /opt/3dparthub/server/static/backups/backup_XXXX.* root@新服务器IP:/tmp/
```

新服务器：

```bash
cd /opt/3dparthub
docker compose up -d

mkdir -p /opt/3dparthub/server/static/backups
cp /tmp/backup_XXXX.* /opt/3dparthub/server/static/backups/
```

然后打开后台 **设置 -> 数据备份 -> 服务器文件**，选择该备份执行恢复。也可以直接在网页上传 `.tar.gz` / `.tgz` 备份包，系统会保存为备份记录或直接恢复。

---

## 常见问题

### 忘记管理员密码怎么办？

```bash
docker exec -it 3dparthub-api sh

HASH=$(node -e "require('bcryptjs').hash('newpass123', 12).then(h => console.log(h))")

npx prisma db execute --stdin << SQL
UPDATE users SET password_hash = '$HASH', must_change_password = true WHERE email = 'admin@model.com';
SQL
exit
```

用新密码 `newpass123` 登录后，系统会要求重新设置密码。

### 忘记管理员用户名或邮箱怎么办？

```bash
docker exec -it 3dparthub-api sh -c \
  "npx prisma db execute --stdin" << SQL
SELECT username, email, role FROM users WHERE role = 'ADMIN';
SQL
```

### 容器启动报错怎么办？

```bash
docker compose logs api --tail 80
docker compose logs postgres --tail 80
docker compose logs redis --tail 80
```

常见原因：

- `P1001: Can't reach database`：PostgreSQL 尚未就绪，等待后重启 API。
- `JWT_SECRET is required`：检查 `.env` 中的 `JWT_SECRET`。
- `ECONNREFUSED redis`：检查 Redis 容器并执行 `docker compose restart redis`。
- 数据库迁移失败：先保留卷和备份，不要删除数据卷；检查 `api` 日志里的 Prisma 错误。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite, Three.js (R3F), Zustand, TailwindCSS |
| 后端 | Express 5, TypeScript, Prisma ORM, JWT, Node.js Cluster |
| 数据库 | PostgreSQL 16 |
| 缓存/队列 | Redis 7, BullMQ |
| 3D 转换 | OpenCASCADE (`occt-import-js`) |
| 预览图 | Node.js Canvas + Three.js, Puppeteer + Chromium |
| 反向代理 | Nginx |

## 项目结构

```text
3DPartHub/
├── client/                 # React 前端
│   ├── src/
│   │   ├── api/            # API 客户端
│   │   ├── components/3d/  # Three.js 3D 查看器
│   │   ├── components/shared/
│   │   ├── pages/          # 选型、询价、分享、后台设置等页面
│   │   ├── stores/         # Zustand 状态
│   │   └── lib/            # 工具库与业务配置默认值
│   ├── Dockerfile
│   └── nginx.conf
├── server/                 # Express 后端
│   ├── src/
│   │   ├── main.ts
│   │   ├── lib/            # 缓存、JWT、队列、设置、备份恢复
│   │   ├── middleware/     # 认证、RBAC、审计、安全中间件
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 转换、预览图服务
│   │   └── workers/        # BullMQ 消费者
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── scripts/            # 迁移和备份校验脚本
│   └── Dockerfile
├── deploy/                 # 纯镜像部署配置
├── docker-compose.yml
└── .github/workflows/      # CI 自动构建镜像与 Release
```

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

Copyright (c) 2024-2026 3DPartHub contributors
