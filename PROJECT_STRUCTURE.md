# Project Structure

这份文件说明仓库根目录各目录的职责，避免源码、运行时数据、私有资料和部署文件混在一起。

## 根目录

| 路径 | 用途 | 是否应提交 |
|------|------|------------|
| `client/` | React/Vite 前端源码 | 是 |
| `server/` | Express/Prisma 后端源码 | 是 |
| `docs/` | 通用项目文档 | 是 |
| `deploy/` | 历史部署参考说明 | 是 |
| `docker-compose.yml` | 生产纯 Docker 部署主入口 | 是 |
| `docker-compose.local.yml` | 本地 Docker 测试和本地依赖服务配置 | 是 |
| `private-docs/` | 私有画册、批次脚本、Excel、临时资料 | 否 |
| `server/static/` | 运行时模型、缩略图、备份、站点资源 | 仅少数模板文件提交 |
| `server/uploads/` | 运行时上传文件 | 否 |
| `client/dist/`、`server/dist/` | 构建产物 | 否 |
| `node_modules/` | 依赖安装目录 | 否 |

## 文档放置规则

`docs/` 只放通用文档，例如运行规范、公开开发计划、架构说明。

不要把这些资料放进 `docs/`：

- 企业画册 PDF。
- Excel 原始资料。
- 客户定制文档。
- OCR 参考图。
- 私有批次导入脚本。
- 临时 HTML 或测试导出文件。

这些资料统一放到 `private-docs/`，该目录已被 Git 忽略。

## 部署文件规则

生产部署只认根目录：

```text
docker-compose.yml
```

本地开发和本地容器测试只认：

```text
docker-compose.local.yml
```

`deploy/` 目录只保留历史部署参考，不作为生产主入口。

## 运行时数据规则

以下目录可能很大，不能作为源码提交：

```text
server/static/models/
server/static/originals/
server/static/thumbnails/
server/static/backups/
server/static/html-previews/
server/uploads/
```

迁移或备份运行时数据时，使用后台备份功能或 Docker 卷备份，不要复制到源码目录里提交。

## 本地端口规则

| 端口 | 用途 |
|------|------|
| `5173` | Vite 前端开发服务 |
| `8000` | 后端开发服务 |
| `5433` | 本地 PostgreSQL |
| `6380` | 本地 Redis |
| `3780` | Docker Web 入口 |

更完整的运行说明见 [docs/运行环境规范.md](docs/运行环境规范.md)。

## 维护规范

新增代码、调整接口和提交前检查请看 [docs/代码维护规范.md](docs/代码维护规范.md)。
