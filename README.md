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

> V2.4 公开发行版只包含通用源码、数据库结构、迁移、Docker/CI 配置和文档。数据库、模型文件、缩略图、Logo、Favicon、产品图片、企业资料、业务批次脚本、Excel/PDF 私有资料等运行时或定制内容不会随 Git 仓库和镜像发布。

## V2.4 更新

- **CAD 在线浏览 2.0**：新增统一 CAD 查看器面板，支持视图工具栏、ViewCube、结构树、属性面板、测量工具、爆炸视图、裁切反向、边线显示、全屏预览和渲染参数调校。
- **预览诊断与元数据**：转换后生成 GLB 预览资产和 `meta.json` 诊断信息，后台可查看零件数、顶点/面片统计、包围盒、转换耗时和预览警告。
- **转换队列增强**：模型转换改为隔离子进程执行，后台新增队列健康、任务详情、失败重试、重建取消、队列清理和转换并发控制，降低大模型卡死对主服务的影响。
- **模型管理增强**：后台模型列表加入预览诊断、批量重建、分组/主版本管理、分页组件和更完整的搜索/返回路径体验。
- **转换质量优化**：STEP/IGES/XT 转换清理无效网格、压缩可用索引、生成稳定 GLB、改进缩略图渲染和预览资产查找，提升大装配体浏览稳定性。
- **运维与安全**：补充分片上传文件名校验、ZIP 批量导入路径穿越防护、私有静态资源鉴权下载、Redis 分布式限流、下载次数事务锁、维护页入口、Host/IP 保护、后台业务配置默认值和审计/搜索接口兼容性；公开发行不内置任何企业模型、图片或业务数据。

## Release 与镜像

| 项目 | 值 |
|------|----|
| Tag | `v2.4` |
| Release 标题 | `V2.4 - CAD 在线浏览与转换队列增强` |
| API 镜像 | `ghcr.io/liaoweixiang2024-blip/3dparthub-api:v2.4` |
| Web 镜像 | `ghcr.io/liaoweixiang2024-blip/3dparthub-web:v2.4` |
| Latest 镜像 | `ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest` / `ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest` |

镜像说明：

- `3dparthub-api`：Express 5 + Prisma 后端，包含数据库迁移、隔离模型转换、转换队列、预览元数据、后台设置、备份/恢复、审计与 API 服务。
- `3dparthub-web`：React 19 + Vite 前端，包含 CAD 在线查看器、3D 预览、产品选型、询价报价、分享页和后台管理界面。

后台 **设置 -> 系统更新 -> 检查更新** 会读取 GitHub 最新 Release 的描述内容，并显示为后台更新日志。发布 V2.4 时，请以 Release 描述作为用户可见更新简介。

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

检查服务状态：

```bash
docker compose ps
docker compose logs api | tail -20
curl http://localhost:3780/api/health
```

首次启动会自动创建管理员账号：

| 项目 | 默认值 |
|------|--------|
| 邮箱 | `admin@model.com` |
| 密码 | `admin123` |
| 说明 | 首次登录强制修改密码 |

自定义管理员账号可在 `.env` 中设置 `ADMIN_USER`、`ADMIN_EMAIL`、`ADMIN_PASS`，仅首次启动时生效。

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_PASSWORD` | 是 | - | 数据库密码 |
| `JWT_SECRET` | 是 | - | JWT 签名密钥，建议至少 32 位 |
| `PORT` | 否 | `3780` | 对外访问端口 |
| `ALLOWED_ORIGINS` | 否 | - | CORS 域名，多个用逗号分隔 |
| `ADMIN_USER` | 否 | `admin` | 初始管理员用户名，仅首次启动 |
| `ADMIN_EMAIL` | 否 | `admin@model.com` | 初始管理员邮箱，仅首次启动 |
| `ADMIN_PASS` | 否 | `admin123` | 初始管理员密码，仅首次启动 |
| `SMTP_HOST` | 否 | - | SMTP 服务器 |
| `SMTP_USER` | 否 | - | SMTP 用户名 |
| `SMTP_PASS` | 否 | - | SMTP 密码或授权码 |

### 使用指定版本镜像

```bash
cd /opt/3dparthub
IMAGE_TAG=v2.4 docker compose pull
IMAGE_TAG=v2.4 docker compose up -d
curl http://localhost:3780/api/health
```

也可以在 `.env` 中写入：

```bash
IMAGE_TAG=v2.4
```

### 升级版本

```bash
cd /opt/3dparthub

# 1. 更新部署配置
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml

# 2. 拉取新镜像并重启
docker compose pull
docker compose up -d

# 3. 检查迁移和服务日志
docker compose logs -f api

# 4. 验证服务正常
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
| `static-data` | `/app/static` | 转换模型、缩略图、原始文件、站点运行时静态资料、备份包 |

## 备份与恢复

V2.4 备份包沿用完整备份格式，包含：

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

本仓库已用本地真实数据做过 V2.3 端到端校验：创建备份、导入备份、从导入备份恢复，再比对数据库和业务文件指纹。校验结果为 `22` 张表、`15522` 行、`19872` 个业务文件、约 `24.68GB` 恢复前后一致。V2.4 未改变备份包结构和恢复保护流程，继续使用同一套恢复校验机制。

### 迁移到新服务器

旧服务器：

```bash
# 1. 后台「设置 -> 数据备份」创建并校验备份
# 2. 导出备份记录和归档
docker cp 3dparthub-api:/app/static/backups/backup_XXXX.json /tmp/
docker cp 3dparthub-api:/app/static/backups/backup_XXXX.tar.gz /tmp/

# 3. 传到新服务器
scp /tmp/backup_XXXX.* root@新服务器IP:/tmp/
```

新服务器：

```bash
cd /opt/3dparthub
docker compose up -d

docker cp /tmp/backup_XXXX.json 3dparthub-api:/app/static/backups/
docker cp /tmp/backup_XXXX.tar.gz 3dparthub-api:/app/static/backups/
```

然后打开后台 **设置 -> 数据备份**，选择该备份执行恢复。也可以直接在网页上传 `.tar.gz` 备份包，系统会保存为备份记录或直接恢复。

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
