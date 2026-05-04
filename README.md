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

> 发行版只包含通用源码、数据库结构、迁移、Docker/CI 配置和文档。数据库、模型文件、缩略图、Logo、Favicon、产品图片、企业资料、业务批次脚本、Excel/PDF 私有资料等运行时或定制内容不会随 Git 仓库和镜像发布。

---

## 功能特性

### 3D 模型管理

- **多格式支持**：STEP (`.step` / `.stp`)、IGES (`.iges` / `.igs`)、Parasolid (`.xt` / `.x_t`) 自动转换为 glTF。
- **浏览器 CAD 预览**：基于 Three.js 的实时渲染，支持线框、实体、透明、爆炸视图、边线、裁切、测量、结构树、属性面板和缩略图。
- **批量导入**：扫描服务器目录批量导入，按文件夹结构自动归类。
- **无限级分类**：树形分类体系，支持拖拽排序。
- **全文搜索**：按名称、格式、分类和元数据多维检索。

### 产品图库

- **图片管理**：支持图片、文件夹、ZIP/RAR 批量上传，分类、审核、收藏、下载和复制链接。
- **标签系统**：支持图片标签管理和按标签筛选。
- **批量操作**：批量审核、删除、移动、排序等管理功能。
- **无限滚动**：高性能加载，离屏卡片自动优化渲染。

### 产品选型

- **分级筛选**：按产品大类、二级类目、规格参数逐步筛选。
- **智能匹配**：选型产品可关联 3D 模型，支持预览、收藏、下载和询价。
- **画册支持**：分类级别 PDF 画册，可按接头形态共享给其他分类。
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
- **缓存清理**：扫描并清理孤立文件、过期临时文件和旧快照，释放磁盘空间。
- **版本检测**：检查 GitHub Release，后台展示最新版本和更新内容。
- **站点自定义**：站名、Logo、Favicon、配色方案、SEO、公告和邮件模板。
- **安全与审计**：登录保护、下载策略、分享策略、IP/Host 保护、审计日志。

---

## 快速部署

### 环境要求

- Docker 20.10+
- Docker Compose 2.0+

### 一键部署

```bash
# 全新部署
curl -L https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/deploy.sh | bash

# 或者先下载再执行
curl -L -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/deploy.sh
bash deploy.sh
```

脚本会自动完成：安装 Docker → 下载 docker-compose.yml → 生成随机密钥 → 按服务器内存自动分配资源 → 拉取最新镜像并启动。

**带备份恢复部署：**

```bash
# 将备份文件上传到服务器后执行
bash deploy.sh /path/to/backup_xxx.tar.gz
```

脚本会自动恢复数据库和文件数据。

如果 GHCR 镜像包仍为私有，服务器需要先使用有 `read:packages` 权限的 GitHub Token 登录：

```bash
echo "你的GitHub Token" | docker login ghcr.io -u liaoweixiang2024-blip --password-stdin
bash deploy.sh
```

如果服务器或 NAS 拉取 Docker Hub / GHCR 速度过慢，可以在可访问外网的机器上导出离线镜像包，然后在目标机器执行 `docker load -i 3dparthub-images.tar` 后再 `bash deploy.sh`。

检查服务状态：

```bash
docker compose ps
docker compose logs api | tail -20
curl http://localhost:3780/api/health
```

### 自动调整容器上限

服务器或 NAS 已经部署好以后，可以单独运行资源调优脚本。它会按服务器总内存自动选择 `4G`、`8G`、`16G` 或 `32G+` 档位，先写入 `.env`，再用 `docker update` 直接调整正在运行的 `api`、`web`、`postgres`、`redis` 容器内存和 CPU 上限。

```bash
cd /opt/3dparthub
curl -L -o tune-resources.sh https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/scripts/tune-resources.sh
sh tune-resources.sh .env
docker stats --no-stream
```

自动分配参考：

| 服务器内存 | API          | PostgreSQL   | Redis          | Web             |
| ---------- | ------------ | ------------ | -------------- | --------------- |
| 4G         | 2G / 1.5 CPU | 768M / 1 CPU | 256M / 0.5 CPU | 256M / 0.5 CPU  |
| 8G         | 4G / 2 CPU   | 1G / 1 CPU   | 512M / 0.5 CPU | 512M / 0.75 CPU |
| 16G        | 8G / 3 CPU   | 2G / 2 CPU   | 1G / 1 CPU     | 512M / 1 CPU    |
| 32G+       | 12G / 4 CPU  | 4G / 2 CPU   | 2G / 1 CPU     | 1G / 1 CPU      |

说明：容器内存/CPU 上限会即时生效；`API_WORKERS`、`API_SHM_SIZE`、`DB_CONNECTION_LIMIT` 等启动参数会同步写入 `.env`，执行 `docker compose up -d --force-recreate api` 后完全生效。

首次启动会自动创建管理员账号：

| 项目 | 默认值                                                     |
| ---- | ---------------------------------------------------------- |
| 邮箱 | `.env` 中的 `ADMIN_EMAIL`，默认 `admin@model.local`        |
| 密码 | `.env` 中的 `ADMIN_PASS`，未设置时为 `3DPartHub@2026`      |
| 说明 | 管理员只在空数据库首次启动时创建；首次登录后会强制修改密码 |

自定义管理员账号可在 `.env` 中设置 `ADMIN_USER`、`ADMIN_EMAIL`、`ADMIN_PASS`，仅首次启动时生效。

如果已经启动过、恢复过备份或 Docker volume 中已有管理员账号，修改 `ADMIN_PASS` 不会覆盖旧密码。需要重置时可在 `api` 容器内更新管理员密码。

### 环境变量

| 变量              | 必填 | 默认值                                              | 说明                                                   |
| ----------------- | ---- | --------------------------------------------------- | ------------------------------------------------------ |
| `DB_PASSWORD`     | 否   | `3dparthub-default-db-password-change-me-2026`      | 数据库密码，正式环境建议在 `.env` 中覆盖               |
| `JWT_SECRET`      | 否   | `3dparthub-default-jwt-secret-change-me-2026-04-30` | JWT 签名密钥，正式环境建议至少 32 位随机字符串         |
| `PORT`            | 否   | `3780`                                              | 对外访问端口                                           |
| `ALLOWED_ORIGINS` | 否   | -                                                   | CORS 域名，多个用逗号分隔                              |
| `ADMIN_USER`      | 否   | `admin`                                             | 初始管理员用户名，仅首次启动                           |
| `ADMIN_EMAIL`     | 否   | `admin@model.local`                                 | 初始管理员邮箱，仅首次启动                             |
| `ADMIN_PASS`      | 否   | `3DPartHub@2026`                                    | 初始管理员密码，仅空数据库首次启动生效                 |
| `IMAGE_TAG`       | 否   | `latest`                                            | 镜像标签；默认自动跟随最新版本，写入固定标签可锁定版本 |
| `SMTP_HOST`       | 否   | -                                                   | SMTP 服务器                                            |
| `SMTP_USER`       | 否   | -                                                   | SMTP 用户名                                            |
| `SMTP_PASS`       | 否   | -                                                   | SMTP 密码或授权码                                      |

### 更新与升级

```bash
cd /opt/3dparthub

# 拉取最新镜像并强制重建容器
docker compose pull
docker compose up -d --force-recreate

# 验证服务正常
curl http://localhost:3780/api/health
```

> **注意：** 更新后如果页面没有变化，用 `Ctrl+Shift+R`（Mac: `Cmd+Shift+R`）强制刷新浏览器缓存。如果仍然不生效，执行 `docker compose down && docker compose pull && docker compose up -d` 彻底重建。

如需锁定特定版本，修改 `.env` 中的 `IMAGE_TAG`：

```bash
sed -i 's/IMAGE_TAG=.*/IMAGE_TAG=V2.8.6/' .env
docker compose pull && docker compose up -d --force-recreate
```

升级前建议在后台 **设置 -> 数据备份** 创建并校验一次备份。

要锁定到指定版本，在 `.env` 中设置 `IMAGE_TAG=V2.8.6` 等固定标签即可。

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

| 卷名           | 容器内路径                 | 内容                                           |
| -------------- | -------------------------- | ---------------------------------------------- |
| `pgdata`       | `/var/lib/postgresql/data` | PostgreSQL 数据库                              |
| `uploads-data` | `/app/uploads`             | 上传附件、上传元数据                           |
| `static-data`  | `/app/static`              | 转换模型、缩略图、原始文件、站点运行时静态资料 |

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

API 容器启动时会自动修复该目录的 UID/GID 权限，避免因无法创建 `/app/static/backups/.work` 而启动失败。

## 备份与恢复

备份包沿用完整备份格式，包含：

- PostgreSQL 全量 dump。
- `static` 下自动发现的业务目录，例如 `models`、`thumbnails`、`originals`、`drawings`、`option-images`、`logo`、`favicon`、`watermark` 等。
- `uploads` 下的业务上传目录与 `.metadata` 上传元数据。
- manifest 清单、数据库 SHA256、目录文件数量和体积信息。

恢复保护机制：

- 恢复前校验备份包结构、manifest、数据库 SHA256、目录文件数。
- 恢复前检查磁盘可用空间，不满足安全回滚空间时会中止。
- 恢复前创建当前数据库安全快照。
- 数据库恢复失败会自动回滚到安全快照。
- 文件目录按目录逐个恢复，保留旧目录回滚副本；文件恢复失败会回滚已替换目录。
- 恢复完成后清理缓存，使后台立即读取恢复后的数据。

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

| 层级      | 技术                                                             |
| --------- | ---------------------------------------------------------------- |
| 前端      | React 19, TypeScript, Vite, Three.js (R3F), Zustand, TailwindCSS |
| 后端      | Express 5, TypeScript, Prisma ORM, JWT, Node.js Cluster          |
| 数据库    | PostgreSQL 16                                                    |
| 缓存/队列 | Redis 7, BullMQ                                                  |
| 3D 转换   | OpenCASCADE (`occt-import-js`)                                   |
| 预览图    | Node.js Canvas + Three.js, Puppeteer + Chromium                  |
| 反向代理  | Nginx                                                            |

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
