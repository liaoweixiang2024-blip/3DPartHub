# docs 目录说明

这个目录分成两类资料：

- 画册整理资料：用于定义北泽 2025 画册的分类树、筛选字段和详情模板
- 项目实现资料：用于说明当前仓库里"产品选型 + 询价 + 报价模板 + 备份恢复"功能已经做到哪里，以及后续怎么继续补数据

## 当前文件

- `北泽选型清单.md`
  画册人工整理稿，偏产品运营视角，说明类目结构、筛选项、详情页字段模板和录入优先级。

- `北泽选型结构.json`
  结构化数据源，当前被 `server/prisma/seed-beize.ts` 直接读取，用来初始化北泽选型分类。

- `选型询价实现说明.md`
  当前项目的完整实现说明，包含：
  - 选型/询价/报价模板功能
  - 数据库表结构和接口
  - 备份恢复系统（安全快照、staging 恢复、并发保护、缓存清理）
  - 种子脚本和分类初始化
  - 继续扩充时的约束和建议

- `北泽数据导入进度.md`
  当前北泽产品数据的导入覆盖范围，按 `slug / 类目 / 画册页码 / 批次脚本` 做了对应，可直接从未覆盖类目继续补脚本。

## 建议阅读顺序

1. 先看 `北泽选型清单.md`，确认业务结构
2. 再看 `选型询价实现说明.md`，确认代码里已经怎么落地，包括备份恢复能力和设置/报价模板
3. 最后看 `北泽数据导入进度.md`，从未完成的类目继续补批次脚本

## 对应代码入口

- 分类结构来源：`server/prisma/seed-beize.ts`
- 产品批次脚本：`data/seeds/products/batch*.ts`（79 个，不随应用发布）
- 回填脚本：`data/seeds/backfill-groups.ts`、`backfill-sort-types.ts`
- 前端静态蓝图：`client/src/data/beizeSelection.ts`
- 选型接口：`server/src/routes/selections.ts`
- 询价接口：`server/src/routes/inquiries.ts`
- 设置接口：`server/src/routes/settings.ts`
- 备份恢复核心：`server/src/lib/backup.ts`
- 设置缓存管理：`server/src/lib/settings.ts`
- 选型页：`client/src/pages/SelectionPage.tsx`
- 选型管理页：`client/src/pages/SelectionAdminPage.tsx`
- 询价详情页：`client/src/pages/InquiryDetailPage.tsx`
- 系统设置页：`client/src/pages/SettingsPage.tsx`
- 报价模板编辑页：`client/src/pages/QuoteTemplateEditor.tsx`
