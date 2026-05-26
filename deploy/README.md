# Deploy Directory

生产部署以仓库根目录的 [docker-compose.yml](../docker-compose.yml) 为准。

本目录只保留历史部署入口和发布说明参考。更新生产 Compose 配置时，优先修改根目录 `docker-compose.yml`，避免维护两份不一致的部署文件。

推荐生产部署：

```bash
curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | bash
```

脚本会复用已有 Docker 或自动安装 Docker，修复 Docker GPG 源，下载生产 Compose，生成 `.env`，设置访问来源，按内存写入资源上限，启动 `api`、`web`、`postgres`、`redis` 四个核心容器，并在启动后自动运行部署自检。

检测到宝塔面板或已有 nginx 站点时，脚本默认不会停止 nginx。若 `3780` 被占用，请先确认端口归属，或显式接管：

```bash
curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | AUTO_STOP_NGINX=1 bash
```

需要立即升级时：

```bash
cd /opt/3dparthub
curl -L -o docker-compose.yml https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
touch .env
grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env || echo 'IMAGE_TAG=latest' >> .env
docker compose pull
docker compose up -d --force-recreate
```

部署或升级后建议运行只读自检：

```bash
cd /opt/3dparthub
curl -fsSL -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/scripts/deploy-health-check.sh
sh deploy-health-check.sh --report deploy-health-report.txt --json deploy-health-report.json
```

自检不会改配置或重启服务；除备份目录写入并删除一个隐藏探针文件外，只读取运行状态。它会输出 Docker、Compose、Compose 持久化挂载、Compose/运行容器日志轮转、API 停止宽限期、Compose 内部网络、Compose/运行容器端口暴露、运行容器重启策略、Redis healthcheck 是否使用 `REDISCLI_AUTH` 认证 ping、实际容器挂载、运行容器关键环境是否与 `.env` 一致、API 主进程是否非 root 运行、`.env` 密钥、`ALLOWED_ORIGINS` 和文件权限、备份签名/加密密钥、`IMAGE_TAG` 与运行镜像标签、运行镜像来源、运行版本、容器、容器镜像、OOMKilled/重启次数、端口、Web 敏感路径和 X-Accel 内部下载路径、健康/就绪/存活接口、管理健康接口访问控制、API/Web 安全响应头、Web 首页入口、Web 前端静态资源、数据库密码、数据库迁移状态、Redis、宿主机备份目录可写性、备份恢复演练证据、部署目录磁盘和 inode、Docker 数据目录磁盘和 inode、备份目录磁盘和 inode、API 数据卷容量、服务器内存、资源配置预算和 API/Web 日志扫描的健康报告，也可以保存带生成时间、主机和系统信息的 `deploy-health-report.txt` 留档，并可同时保存 `deploy-health-report.json` 作为结构化摘要。核心容器未配置 healthcheck、最近发生过 OOMKilled、重启次数较高、API 停止宽限期缺失或过短、备份恢复演练证据缺失或过期、API 主进程以 root 运行、`.env` 权限过宽、资源配置超过当前内存档位、运行容器关键环境与 `.env` 不一致、api/web 运行镜像标签与 `IMAGE_TAG` 不一致、运行镜像来源异常、管理健康接口未受保护、运行版本接口异常、数据库迁移状态异常、API 数据卷容量不足、存活接口失败、API/Web 安全响应头缺失、Web 首页入口无法返回前端 HTML、Web 前端静态资源无法加载、Web 敏感路径或 X-Accel 内部下载路径暴露、API/Web 日志包含常见入口或启动错误、关键持久化挂载缺失、运行容器挂载仍是旧配置、Compose/运行容器日志轮转缺失、私有服务端口暴露、运行容器重启策略未生效，或 Compose 服务未设置 `restart: unless-stopped`，都会记为警告或失败，生产验收默认不接受。若用于发布前强校验，可加 `--strict`。如果生产环境使用了非默认文件名或目录，必须显式传入，例如 `sh deploy-health-check.sh --compose-file /opt/3dparthub/docker-compose.yml --env-file /opt/3dparthub/.env --report deploy-health-report.txt --json deploy-health-report.json`。

需要回传排障资料时，可以生成不包含 `.env` 的证据包：

```bash
cd /opt/3dparthub
curl -fsSL -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/scripts/collect-deploy-evidence.sh
sh collect-deploy-evidence.sh
```

最终生产验收默认要求最近一次备份恢复演练纳入生产证据。维护窗口内先执行 `docker compose exec api npm run backup:e2e`，再运行 `sh collect-deploy-evidence.sh`。演练成功会写入 `server/static/backups/.restore-drills/latest.json`，证据包里的 `backup-inventory.txt` 会出现 `Restore drill evidence: status=passed`，验收摘要会显示“备份恢复演练已执行”。缺少演练、演练时间无效、超过 30 天，或备份目录残留 `.work` 临时工作目录时，`backupInventory.riskLevel` 会提升为中风险，`productionEvidence.finalConclusionReady` 不会为 `true`。该命令会真实执行恢复流程，生产环境执行前应确认已有外部副本。

如果指定 `--output-dir`，目录必须为空；脚本会拒绝复用已有旧证据目录，避免新旧报告混在同一个证据包里。

采集脚本默认会同时生成 `deploy-evidence-*.tar.gz.sha256`，回传证据包时必须和 `.tar.gz` 一起带回；生产验收入口会先校验外层 SHA-256，并确认摘要内容引用当前 `.tar.gz` 文件名，再校验证据包内部 manifest。只有旧证据包确实遗失摘要文件时才使用 `--allow-missing-sidecar` 临时验收。

一键部署默认会自动执行这套自检，并在安装目录生成 `deploy-health-report.txt` 和 `deploy-health-report.json`；如果服务启动失败、初始健康检查未通过或自检失败，部署脚本会自动尝试生成 `deploy-evidence-failed-YYYYMMDD-HHMMSS.tar.gz` 和同名 `.sha256`，方便直接回传排查。仅在临时排障时使用 `SKIP_DEPLOY_CHECK=1` 跳过。

证据目录、健康报告和验收摘要包含主机名、部署目录和日志片段，采集脚本会对常见密钥、连接串和 `Authorization` 头做敏感信息脱敏，验收器也会拒绝明显未脱敏的证据文本。仓库默认已忽略 `deploy-evidence-*`、`deploy-health-report.*` 和 `deploy-health-acceptance.*`，避免误提交运维信息。

把生产服务器上的证据包或两份报告拷回仓库后，可以执行结构化验收：

```bash
npm run deploy:acceptance -- deploy-evidence-20260526-120000.tar.gz
npm run deploy:report:verify -- deploy-evidence-20260526-120000.tar.gz --max-age-hours 24
npm run deploy:report:verify -- deploy-evidence-20260526-120000.tar.gz --max-age-hours 24 --summary deploy-health-acceptance.md --summary-json deploy-health-acceptance.json
npm run deploy:report:verify -- deploy-health-report.json --require-text deploy-health-report.txt --max-age-hours 24
```

`deploy:acceptance` 默认要求完整证据包或完整证据目录、报告不超过 24 小时；验收 `.tar.gz` 时还要求同名 `.tar.gz.sha256` 存在，并生成 `deploy-health-acceptance.md` 和 `deploy-health-acceptance.json`。默认验收会强制 `productionEvidence.finalConclusionReady=true`，因此退出码也能作为最终生产证据闭环判断。最终闭环还要求 `productionEvidence.backupInventoryReady=true`，即备份库存风险为低、最近一次备份恢复演练有效，并且备份目录没有残留 `.work` 临时工作目录。直接校验证据包时，验收器会同时确认健康报告、Compose 状态、API/Web 日志尾部、Docker/宿主机资源、网络监听、备份库存、版本/镜像追踪和 README 是否齐全，辅助证据内容必须符合预期结构，主健康报告 `deploy-health-report.json`、`manifest.json`、`README.txt` 和 `deployment-provenance.txt` 的证据批次 ID 必须一致，核心容器必须带 `image=`、`imageId=sha256:`、`status=`、`health=`、`restartPolicy=`、`restartCount=` 和 `oom=`，并按 `manifest.json` 校验关键文件 SHA-256，只允许固定白名单文件，拒绝包含 `.env`、额外文件或被篡改的证据包；`--max-age-hours 24` 可避免误用过期报告。加上 `--summary` 和 `--summary-json` 可自定义 Markdown 与 JSON 验收摘要路径，记录完成情况、必要检查、备份库存闭环和剩余风险。

完整通过条件、失败处理和剩余风险见 [生产部署健康验收清单](../docs/部署健康验收清单.md)。

修改一键部署、自检或证据包脚本后，可先在仓库根目录执行 `npm run verify:deploy`，再按需执行完整的 `npm run verify:local`。

已经部署好的服务器可以动态调整正在运行容器的内存/CPU 上限：

```bash
cd /opt/3dparthub
curl -L -o tune-resources.sh https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/scripts/tune-resources.sh
sh tune-resources.sh .env
docker stats --no-stream
```
