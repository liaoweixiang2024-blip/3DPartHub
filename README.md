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

| 卷名 | 内容 | 备注 |
|------|------|------|
| `pgdata` | PostgreSQL 数据库 | 数据库所有数据 |
| `uploads-data` | 上传的原始模型文件 | STEP/IGES 原文件 |
| `static-data` | 转换文件、缩略图、备份 | 备份文件在 `static/backups/`，注意磁盘容量 |

```bash
# 查看卷占用空间
docker system df -v

# 备份整个数据目录
docker run --rm -v 3dparthub_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tar.gz -C /data .
```

---

## 常见问题

### 1. 备份文件在服务器上，怎么恢复？

**方式一：网页端（推荐）**

```bash
# 把备份文件复制到容器内
docker cp /root/backup_20260423.tar.gz 3dparthub-api-1:/app/static/backups/
```

然后打开 **设置 → 数据备份 → 导入恢复 → 服务器文件**，会自动列出备份文件，点击恢复即可。

**方式二：命令行**

```bash
# 1. 登录获取管理员 token
TOKEN=$(curl -s -X POST http://localhost:3780/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@model.com","password":"你的密码"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# 2. 触发恢复
curl -X POST http://localhost:3780/api/settings/backup/import-path \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"/app/static/backups/backup_20260423.tar.gz"}'

# 返回 {"jobId":"restore_xxx"}

# 3. 查看恢复进度
curl -s http://localhost:3780/api/settings/backup/restore-progress/restore_xxx \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 2. 忘记管理员密码怎么办？

通过 `docker exec` 直接重置数据库中的密码：

```bash
# 1. 进入 API 容器
docker exec -it 3dparthub-api-1 sh

# 2. 生成新密码的 bcrypt 哈希（新密码设为 newpass123）
HASH=$(node -e "require('bcryptjs').hash('newpass123', 12).then(h => console.log(h))")
echo $HASH

# 3. 更新数据库
npx prisma db execute --stdin << SQL
UPDATE users SET password_hash = '$HASH', must_change_password = true WHERE email = 'admin@model.com';
SQL

# 4. 退出容器
exit
```

现在可以用新密码 `newpass123` 登录，登录后系统会要求你再设一个新密码。

### 3. 忘记管理员用户名/邮箱怎么办？

```bash
# 查看所有管理员账号
docker exec -it 3dparthub-api-1 sh -c \
  "npx prisma db execute --stdin" << SQL
SELECT username, email, role FROM users WHERE role = 'ADMIN';
SQL
```

找到邮箱后，用上面的方法重置密码即可。

### 4. 忘记数据库密码怎么办？

数据库密码只在 `.env` 文件中，如果忘了：

```bash
cd /opt/3dparthub

# 方法一：查看 .env 文件
cat .env

# 方法二：如果 .env 也丢了，直接重置
# 1. 停止服务
docker compose down

# 2. 重新生成密码并写入 .env
cat > .env << EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF

# 3. 删除旧数据库卷（会丢失数据！）
docker volume rm 3dparthub_pgdata

# 4. 重新启动（会创建新的空数据库）
docker compose up -d
```

> **如果有备份**：启动后通过网页端或命令行恢复备份即可找回数据。

### 5. 容器启动后访问报错怎么办？

```bash
# 1. 看容器状态
docker compose ps

# 2. 看 API 日志（最常见的错误在这里）
docker compose logs api --tail 50

# 3. 常见原因：
#    - "P1001: Can't reach database server" → postgres 还没就绪，等 30 秒
#    - "jwt secret is required" → 检查 .env 中的 JWT_SECRET
#    - "ECONNREFUSED redis" → 重启 redis: docker compose restart redis
```

### 6. 端口被占用怎么办？

```bash
# 修改 .env 中的端口
echo "PORT=8080" >> .env

# 重启
docker compose up -d
```

### 7. 如何迁移到新服务器？

```bash
# 旧服务器：
# 1. 在网页端创建完整备份，下载到本地
# 或用命令行导出卷数据：
docker run --rm -v 3dparthub_pgdata:/data -v $(pwd):/backup alpine tar czf /backup/pgdata.tar.gz -C /data .

# 新服务器：
# 1. 部署新实例（按上面的"一键部署"）
# 2. 通过网页端恢复备份
#    或命令行导入：docker cp backup.tar.gz 3dparthub-api-1:/app/static/backups/
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
