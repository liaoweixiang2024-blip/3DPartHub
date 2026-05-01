# Deploy Directory

生产部署以仓库根目录的 [docker-compose.yml](../docker-compose.yml) 为准。

本目录只保留历史部署入口和发布说明参考。更新生产 Compose 配置时，优先修改根目录 `docker-compose.yml`，避免维护两份不一致的部署文件。

推荐生产部署：

```bash
mkdir -p /opt/3dparthub && cd /opt/3dparthub
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
docker compose up -d
```

默认部署使用 `latest` 镜像，并启动 Watchtower 每小时自动检查和更新 `api` / `web` 容器。需要立即升级时：

```bash
cd /opt/3dparthub
curl -L -o docker-compose.yml https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
touch .env
grep -q '^IMAGE_TAG=' .env && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=latest/' .env || echo 'IMAGE_TAG=latest' >> .env
docker compose pull
docker compose up -d --force-recreate
```
