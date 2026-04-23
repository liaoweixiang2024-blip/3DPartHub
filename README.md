<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">3DPartHub</h1>

<p align="center">
  <strong>企业级 3D 零件模型管理平台</strong><br/>
  开源的 3D CAD 模型管理、格式转换、在线预览与团队协作平台
</p>

---

3DPartHub 是一个功能完整的开源平台，专为制造企业团队管理 3D 零件模型而设计。自动将 STEP/IGES/XT 文件转换为 glTF，实现浏览器内实时 3D 预览，支持批量导入、分类管理、团队协作和完整的后台管理。

## 功能特性

- **多格式支持** — STEP (.step/.stp)、IGES (.iges/.igs)、Parasolid (.xt/.x_t) 自动转换为 glTF
- **浏览器 3D 预览** — 基于 Three.js 的实时渲染，支持线框/实体/透明/爆炸视图
- **批量导入** — 扫描服务器目录批量导入，按文件夹结构自动归类
- **无限级分类** — 树形分类体系，拖拽排序
- **全文搜索** — 按名称、格式、分类多维度检索
- **RBAC 权限** — 管理员 / 编辑 / 查看者三级角色
- **数据备份** — 全量备份与恢复（数据库 + 模型 + 预览图）
- **版本检测** — 自动检测新版本，提示升级命令
- **站点自定义** — 站名、Logo、Favicon、配色方案、SEO、公告

---

## 快速部署

### 环境要求

- Docker 20.10+
- Docker Compose 2.0+

### 一键部署

```bash
# 1. 创建项目目录
mkdir -p /opt/3dparthub && cd /opt/3dparthub

# 2. 下载配置文件
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml

# 3. 生成随机密钥
cat > .env << EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF

# 4. 启动
docker compose up -d

# 5. 检查服务状态
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

> 自定义管理员账号：在 `.env` 中添加 `ADMIN_USER`、`ADMIN_EMAIL`、`ADMIN_PASS`，仅在首次启动时生效。

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_PASSWORD` | 是 | — | 数据库密码 |
| `JWT_SECRET` | 是 | — | JWT 签名密钥（至少 32 位） |
| `PORT` | 否 | `3780` | 对外访问端口 |
| `ALLOWED_ORIGINS` | 否 | — | CORS 域名（多个逗号分隔） |
| `ADMIN_USER` | 否 | `admin` | 初始管理员用户名（仅首次启动） |
| `ADMIN_EMAIL` | 否 | `admin@model.com` | 初始管理员邮箱（仅首次启动） |
| `ADMIN_PASS` | 否 | `admin123` | 初始管理员密码（仅首次启动） |
| `SMTP_HOST` | 否 | — | SMTP 服务器（注册验证码） |
| `SMTP_USER` | 否 | — | SMTP 用户名 |
| `SMTP_PASS` | 否 | — | SMTP 密码/授权码 |

### 升级版本

```bash
cd /opt/3dparthub

# 1. 下载最新配置文件（或手动修改 IMAGE_TAG 版本号）
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml

# 2. 拉取新镜像 + 重启
docker compose pull && docker compose up -d

# 3. 检查日志（确认数据库迁移成功）
docker compose logs -f api

# 4. 验证服务正常
curl http://localhost:3780/api/health
```

> **重要**：启动命令中 `prisma migrate deploy || true` 会在升级时自动迁移数据库。请务必检查日志确认迁移成功，`|| true` 会让容器忽略迁移失败继续启动。

---

## 数据持久化

所有数据存储在 Docker 命名卷中，升级/重建容器不会丢失：

| 卷名 | 容器内路径 | 内容 |
|------|-----------|------|
| `pgdata` | `/var/lib/postgresql/data` | 数据库 |
| `uploads-data` | `/app/uploads` | 原始模型文件 |
| `static-data` | `/app/static` | 转换模型、缩略图、备份文件 |

---

## 常见问题

### 1. 备份文件在服务器上，怎么恢复？

**方式一：网页上传（最简单）**

打开 **设置 → 数据备份 → 导入恢复 → 选择文件**，从电脑选择 `.tar.gz` 备份文件上传即可。大文件支持断点续传。

**方式二：从服务器本地文件恢复**

```bash
# 把服务器上的备份文件复制到容器内
docker cp /path/to/backup_1776890498343.json 3dparthub-api-1:/app/static/backups/
docker cp /path/to/backup_1776890498343.tar.gz 3dparthub-api-1:/app/static/backups/
```

然后打开 **设置 → 数据备份**，列表里自动出现，点「恢复」。

> 恢复完成后数据已写入数据库和命名卷，安全不会丢。`docker cp` 进去的备份归档文件在容器重建后会消失，但数据已经恢复了，无所谓。

### 2. 忘记管理员密码怎么办？

```bash
docker exec -it 3dparthub-api-1 sh

# 生成新密码的哈希（新密码设为 newpass123）
HASH=$(node -e "require('bcryptjs').hash('newpass123', 12).then(h => console.log(h))")

# 写入数据库
npx prisma db execute --stdin << SQL
UPDATE users SET password_hash = '$HASH', must_change_password = true WHERE email = 'admin@model.com';
SQL
exit
```

用新密码 `newpass123` 登录后，系统会要求再设一个新密码。

### 3. 忘记管理员用户名/邮箱怎么办？

```bash
docker exec -it 3dparthub-api-1 sh -c \
  "npx prisma db execute --stdin" << SQL
SELECT username, email, role FROM users WHERE role = 'ADMIN';
SQL
```

### 4. 忘记数据库密码怎么办？

```bash
# 查看 .env
cat /opt/3dparthub/.env

# 如果 .env 也丢了，只能重置（数据会丢，需重新恢复备份）
docker compose down
cat > .env << EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF
docker volume rm 3dparthub_pgdata
docker compose up -d
```

### 5. 容器启动报错？

```bash
docker compose logs api --tail 50

# 常见原因：
# "P1001: Can't reach database" → postgres 还没就绪，等 30 秒
# "jwt secret is required"     → 检查 .env 中的 JWT_SECRET
# "ECONNREFUSED redis"         → docker compose restart redis
```

### 6. 如何迁移到新服务器？

```bash
# ===== 旧服务器 =====
# 1. 网页端「设置 → 数据备份」→ 创建备份
# 2. 把备份文件从容器导出到宿主机
docker cp 3dparthub-api-1:/app/static/backups/backup_XXXX.json /tmp/
docker cp 3dparthub-api-1:/app/static/backups/backup_XXXX.tar.gz /tmp/
# 3. 传到新服务器
scp /tmp/backup_XXXX.* root@新服务器IP:/tmp/

# ===== 新服务器 =====
# 1. 部署（按上面的"快速部署"操作）
cd /opt/3dparthub && docker compose up -d
# 2. 等服务启动后，把备份文件复制到容器
docker cp /tmp/backup_XXXX.json 3dparthub-api-1:/app/static/backups/
docker cp /tmp/backup_XXXX.tar.gz 3dparthub-api-1:/app/static/backups/
# 3. 网页端「设置 → 数据备份」→ 点「恢复」
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite, Three.js (R3F), Zustand, TailwindCSS |
| 后端 | Express 5, TypeScript, Prisma ORM, JWT, Node.js Cluster |
| 数据库 | PostgreSQL 16 |
| 缓存/队列 | Redis 7, BullMQ |
| 3D 转换 | OpenCASCADE (occt-import-js) — STEP/IGES/XT → glTF |
| 预览图 | Node.js Canvas + Three.js, Puppeteer + Chromium |
| 反向代理 | Nginx (HTTP/2, gzip_static, 安全头) |

## 项目结构

```
3DPartHub/
├── client/                 # React 前端 (Vite + Nginx)
│   ├── src/
│   │   ├── api/           # API 客户端
│   │   ├── components/3d/ # Three.js 3D 查看器
│   │   ├── components/shared/ # 通用 UI 组件
│   │   ├── pages/         # 页面
│   │   ├── stores/        # Zustand 状态管理
│   │   └── lib/           # 工具库
│   ├── Dockerfile
│   └── nginx.conf
├── server/                 # Express 后端
│   ├── src/
│   │   ├── cluster.ts     # 多进程入口
│   │   ├── main.ts        # Express 应用
│   │   ├── lib/           # 缓存、JWT、队列、设置
│   │   ├── middleware/    # 认证、RBAC、审计
│   │   ├── routes/        # API 路由
│   │   ├── services/      # 转换、预览图服务
│   │   └── workers/       # BullMQ 消费者
│   ├── prisma/schema.prisma
│   └── Dockerfile
├── deploy/                 # 纯镜像部署配置
│   └── docker-compose.yml
├── docker-compose.yml      # 默认部署配置
└── .github/workflows/      # CI 自动构建镜像
```

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

Copyright (c) 2024-2026 [liaoweixiang](https://liaoweixiang.com)
