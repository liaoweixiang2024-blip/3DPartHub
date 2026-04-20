#!/bin/bash
# ===== 3DPartHub - 恢复脚本 =====
# 使用: ./restore.sh <备份目录路径>
# 示例: ./restore.sh ./backups/20260419_120000

set -e

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
RESTORE_PATH="$1"

if [ -z "$RESTORE_PATH" ] || [ ! -d "$RESTORE_PATH" ]; then
  echo "用法: ./restore.sh <备份目录路径>"
  echo "示例: ./restore.sh ./backups/20260419_120000"
  exit 1
fi

echo "=== 3DPartHub 恢复 ==="
echo "备份目录: $RESTORE_PATH"
echo ""
read -p "确认恢复？这将覆盖当前数据库和模型文件 (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "已取消"
  exit 0
fi

# 1. 确保容器在运行
echo "[1/3] 启动容器..."
docker compose -f "$COMPOSE_FILE" up -d
sleep 5

# 2. 恢复数据库
echo "[2/3] 恢复数据库..."
if [ -f "$RESTORE_PATH/database.sql" ]; then
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U modeluser -d 3dparthub \
    < "$RESTORE_PATH/database.sql"
  echo "  ✓ 数据库已恢复"
else
  echo "  ✗ 未找到 database.sql"
fi

# 3. 恢复模型文件
echo "[3/3] 恢复模型文件和缩略图..."
if [ -f "$RESTORE_PATH/static.tar.gz" ]; then
  if [ -d "./server/static" ]; then
    # 本地环境
    tar xzf "$RESTORE_PATH/static.tar.gz" -C ./server/static
  else
    # Docker 环境
    docker compose -f "$COMPOSE_FILE" exec api sh -c "rm -rf /app/static/models /app/static/thumbnails"
    tar xzf "$RESTORE_PATH/static.tar.gz" -C /tmp/
    docker compose -f "$COMPOSE_FILE" cp /tmp/models api:/app/static/models
    docker compose -f "$COMPOSE_FILE" cp /tmp/thumbnails api:/app/static/thumbnails
    rm -rf /tmp/models /tmp/thumbnails
  fi
  echo "  ✓ 模型文件已恢复"
else
  echo "  ✗ 未找到 static.tar.gz"
fi

# 重启 API 让缓存生效
echo "重启 API 服务..."
docker compose -f "$COMPOSE_FILE" restart api

echo ""
echo "=== 恢复完成 ==="
