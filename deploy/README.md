# Deploy Directory

生产部署以仓库根目录的 [docker-compose.yml](../docker-compose.yml) 为准。

本目录只保留历史部署入口和发布说明参考。更新生产 Compose 配置时，优先修改根目录 `docker-compose.yml`，避免维护两份不一致的部署文件。

推荐生产部署：

```bash
mkdir -p /opt/3dparthub && cd /opt/3dparthub
curl -O https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
docker compose up -d
```
