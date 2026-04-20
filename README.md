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

<p align="center">
  <a href="#功能特性">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#api-概览">API</a> ·
  <a href="#许可证">许可证</a>
</p>

---

3DPartHub 是一个功能完整的开源平台，专为制造企业团队管理 3D 零件模型而设计。自动将 STEP/IGES/XT 文件转换为 glTF，实现浏览器内实时 3D 预览，支持批量导入、分类管理、团队协作和完整的后台管理。

## 功能特性

### 模型管理
- **多格式支持** — STEP (.step/.stp)、IGES (.iges/.igs)、Parasolid (.xt/.x_t) 自动转换为 glTF
- **浏览器 3D 预览** — 基于 Three.js 的实时渲染，支持线框/实体/透明/爆炸视图、尺寸标注
- **批量导入** — 扫描服务器目录批量导入模型，按文件夹结构自动归类
- **版本管理** — 上传新版本、版本对比、一键回滚
- **分片上传** — 大文件断点续传，支持 GB 级模型文件

### 分类与搜索
- **无限级分类** — 树形分类体系，支持拖拽排序、自定义图标
- **全文搜索** — 按名称、描述、格式、分类多维度检索
- **项目管理** — 按项目组织模型，支持多人协作

### 团队与安全
- **RBAC 权限** — 管理员 (ADMIN)、编辑 (EDITOR)、查看者 (VIEWER) 三级角色
- **JWT 认证** — 无状态 Token 认证，支持刷新
- **操作审计** — 管理员操作完整日志，可追溯
- **请求限流** — 内置 Rate Limit 防护

### 后台管理
- **用户管理** — 查看用户列表、修改角色、禁用账号
- **分类管理** — 树形分类增删改、拖拽排序
- **模型管理** — 批量操作、重新转换、缩略图管理
- **站点设置** — 自定义站点名称、Logo、Favicon、SEO、联系邮箱、页脚
- **系统公告** — 首页公告横幅，支持 HTML 内容
- **数据备份** — 全量备份与恢复（数据库 + 模型 + 预览图）
- **邮件配置** — SMTP 配置，用于注册验证码

### 性能优化
- **Redis 缓存** — 热点 API 缓存（QPS 700 → 2400+），Redis 故障自动降级
- **Cluster 多进程** — Node.js 集群模式，充分利用多核 CPU
- **Nginx 优化** — HTTP/2、gzip 预压缩、静态资源长缓存
- **PostgreSQL** — 连接池 + 索引优化

## 快速开始

### 环境要求
- Docker 20.10+
- Docker Compose 2.0+

### 部署

```bash
# 1. 克隆仓库
git clone https://github.com/liaoweixiang2024-blip/3DPartHub.git
cd 3DPartHub

# 2. 配置环境变量
cp .env.production .env
# 编辑 .env，设置 DB_PASSWORD、JWT_SECRET、ALLOWED_ORIGINS

# 3. 启动服务
docker-compose up -d

# 4. 查看自动生成的管理员密码
docker-compose logs api | grep "Admin account"
```

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `WEB_PORT` | 否 | `5173` | 对外访问端口 |
| `DB_PASSWORD` | **是** | `modelpass` | 数据库密码 |
| `JWT_SECRET` | **是** | — | JWT 密钥（至少 32 位） |
| `ALLOWED_ORIGINS` | 否 | `http://localhost:5173` | CORS 允许的域名 |
| `ADMIN_USER` | 否 | `admin` | 初始管理员用户名（仅首次启动） |
| `ADMIN_PASS` | 否 | *随机生成* | 初始管理员密码（仅首次启动） |
| `SMTP_HOST` | 否 | — | SMTP 服务器 |
| `SMTP_USER` | 否 | — | SMTP 用户名 |
| `SMTP_PASS` | 否 | — | SMTP 密码/授权码 |

> 管理员账号仅在首次启动时创建，密码会打印在 API 容器日志中。首次登录后请立即修改密码。

### 本地开发

```bash
# 启动基础设施
docker-compose up -d postgres redis

# 启动后端
cd server
npm install
cp ../.env.example .env
npx prisma migrate dev
npm run dev  # http://localhost:8000

# 启动前端
cd client
npm install
npm run dev  # http://localhost:5173
```

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
| 部署 | Docker Compose (api + web + postgres + redis) |

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                   Nginx (Web)                    │
│          HTTP/2 · gzip · 安全头 · 反向代理        │
├──────────────┬──────────────────────────────────┤
│  静态资源 (SPA) │         API 代理 /api/*          │
└──────────────┼──────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────┐
│           Express API (Cluster × N)              │
│     JWT 认证 · RBAC · 限流 · 审计 · 缓存         │
├──────────┬──────────┬──────────┬────────────────┤
│  Prisma   │  Redis   │  BullMQ  │   3D 转换引擎   │
│ (Postgres)│  (缓存)   │  (队列)   │ (OpenCASCADE)  │
└──────────┴──────────┴──────────┴────────────────┘
```

## 项目结构

```
3DPartHub/
├── client/                    # React 前端 (Vite + Nginx)
│   ├── src/
│   │   ├── api/              # API 客户端
│   │   ├── components/3d/    # Three.js 3D 查看器
│   │   ├── components/shared/ # 通用 UI 组件
│   │   ├── pages/            # 20+ 页面
│   │   ├── stores/           # Zustand 状态管理
│   │   └── lib/              # 工具库
│   ├── Dockerfile
│   └── nginx.conf
├── server/                    # Express 后端
│   ├── src/
│   │   ├── cluster.ts        # 多进程入口
│   │   ├── main.ts           # Express 应用
│   │   ├── lib/              # 缓存、JWT、队列、设置...
│   │   ├── middleware/       # 认证、RBAC、安全、审计
│   │   ├── routes/           # 16 个 API 模块
│   │   ├── services/         # 转换、预览图、对比
│   │   └── workers/          # BullMQ 消费者
│   ├── prisma/schema.prisma  # 15 个数据库模型
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── .env.production
```

## API 概览

### 认证
`POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/refresh`

### 模型
`GET /api/models` · `POST /api/models/upload` · `GET /api/models/:id` · `GET /api/models/:id/download` · `PUT /api/models/:id` · `DELETE /api/models/:id` · `POST /api/models/:id/reconvert` · `GET /api/models/:id/versions` · `POST /api/models/compare`

### 分类
`GET /api/categories` · `POST /api/categories` · `PUT /api/categories/:id` · `DELETE /api/categories/:id` · `PUT /api/categories/reorder`

### 文件上传
`POST /api/upload/init` · `PUT /api/upload/chunk` · `POST /api/upload/complete`

### 用户功能
`GET/POST /api/favorites` · `GET /api/downloads` · `GET/POST /api/comments` · `POST /api/shares` · `GET /api/notifications`

### 管理
`GET/PUT /api/settings` · `GET /api/settings/public` · `POST /api/settings/backup/create` · `POST /api/settings/backup/restore/:id` · `GET /api/admin/users` · `PUT /api/admin/users/:id/role` · `GET /api/audit`

## 性能

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| QPS (50 并发) | ~700 | ~2400 |
| P50 延迟 | 68ms | 3ms (缓存命中) |
| Worker 进程 | 1 | 4 (Cluster) |

## 作者

**liaoweixiang** — [liaoweixiang.com](https://liaoweixiang.com) · [GitHub](https://github.com/liaoweixiang2024-blip)

## 参与贡献

欢迎提交 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交改动 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 发起 Pull Request

## 致谢

- [OpenCASCADE](https://dev.opencascade.org/) — STEP/IGES 解析引擎
- [Three.js](https://threejs.org/) — WebGL 3D 渲染
- [occt-import-js](https://github.com/nicholasgasior/occt-import-js) — OpenCASCADE WASM 绑定
- [Prisma](https://www.prisma.io/) — TypeScript ORM
- [BullMQ](https://bullmq.io/) — Redis 消息队列

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

Copyright (c) 2024-2026 [liaoweixiang](https://liaoweixiang.com)
