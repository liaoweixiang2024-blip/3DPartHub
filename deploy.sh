#!/bin/bash
# ============================================================
# 3DPartHub 一键部署脚本
# ============================================================
#
# 全新部署:
#   bash deploy.sh
#
# 带备份恢复（自动复制到容器内并恢复）:
#   bash deploy.sh /path/to/backup_xxx.tar.gz
#   bash deploy.sh "/www/wwwroot/model备份"
#
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="/opt/3dparthub"
BACKUP_DIR="$INSTALL_DIR/server/static/backups"
BACKUP_SOURCE="$1"
RESOURCE_PROFILE=""
API_MEMORY_LIMIT_VALUE=""
API_MEMORY_RESERVATION_VALUE=""
API_CPU_LIMIT_VALUE=""
POSTGRES_MEMORY_LIMIT_VALUE=""
POSTGRES_CPU_LIMIT_VALUE=""
REDIS_MEMORY_LIMIT_VALUE=""
REDIS_CPU_LIMIT_VALUE=""
REDIS_MAXMEMORY_VALUE=""
WEB_MEMORY_LIMIT_VALUE=""
WEB_CPU_LIMIT_VALUE=""

detect_total_memory_mb() {
  if command -v free >/dev/null 2>&1; then
    free -m | awk '/^Mem:/ {print $2; exit}'
    return
  fi
  if [ -r /proc/meminfo ]; then
    awk '/MemTotal:/ {printf "%d\n", $2 / 1024; exit}' /proc/meminfo
    return
  fi
  echo 4096
}

upsert_env() {
  local key="$1"
  local value="$2"
  touch .env
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) print key "=" value
    }
  ' .env > "$tmp"
  mv "$tmp" .env
}

apply_resource_profile() {
  local total_mb profile api_memory api_reservation api_cpu api_workers api_shm conversion_workers
  local postgres_memory postgres_cpu redis_memory redis_cpu redis_maxmemory web_memory web_cpu db_connections

  total_mb="$(detect_total_memory_mb)"
  if [ "$total_mb" -lt 6144 ]; then
    profile="4G"; api_memory="2G"; api_reservation="512M"; api_cpu="1.5"; api_workers="1"; api_shm="512M"; conversion_workers="1"; postgres_memory="768M"; postgres_cpu="1"; redis_memory="256M"; redis_cpu="0.5"; redis_maxmemory="192mb"; web_memory="256M"; web_cpu="0.5"; db_connections="5"
  elif [ "$total_mb" -lt 12288 ]; then
    profile="8G"; api_memory="4G"; api_reservation="1G"; api_cpu="2"; api_workers="2"; api_shm="1G"; conversion_workers="1"; postgres_memory="1G"; postgres_cpu="1"; redis_memory="512M"; redis_cpu="0.5"; redis_maxmemory="384mb"; web_memory="512M"; web_cpu="0.75"; db_connections="10"
  elif [ "$total_mb" -lt 24576 ]; then
    profile="16G"; api_memory="8G"; api_reservation="2G"; api_cpu="3"; api_workers="3"; api_shm="2G"; conversion_workers="2"; postgres_memory="2G"; postgres_cpu="2"; redis_memory="1G"; redis_cpu="1"; redis_maxmemory="768mb"; web_memory="512M"; web_cpu="1"; db_connections="15"
  else
    profile="32G"; api_memory="12G"; api_reservation="3G"; api_cpu="4"; api_workers="4"; api_shm="4G"; conversion_workers="2"; postgres_memory="4G"; postgres_cpu="2"; redis_memory="2G"; redis_cpu="1"; redis_maxmemory="1536mb"; web_memory="1G"; web_cpu="1"; db_connections="20"
  fi

  upsert_env RESOURCE_PROFILE "$profile"
  upsert_env API_MEMORY_LIMIT "$api_memory"
  upsert_env API_MEMORY_RESERVATION "$api_reservation"
  upsert_env API_CPU_LIMIT "$api_cpu"
  upsert_env API_WORKERS "$api_workers"
  upsert_env API_SHM_SIZE "$api_shm"
  upsert_env CONVERSION_WORKER_CONCURRENCY "$conversion_workers"
  upsert_env POSTGRES_MEMORY_LIMIT "$postgres_memory"
  upsert_env POSTGRES_CPU_LIMIT "$postgres_cpu"
  upsert_env REDIS_MEMORY_LIMIT "$redis_memory"
  upsert_env REDIS_CPU_LIMIT "$redis_cpu"
  upsert_env REDIS_MAXMEMORY "$redis_maxmemory"
  upsert_env WEB_MEMORY_LIMIT "$web_memory"
  upsert_env WEB_CPU_LIMIT "$web_cpu"
  upsert_env DB_CONNECTION_LIMIT "$db_connections"

  RESOURCE_PROFILE="$profile"
  API_MEMORY_LIMIT_VALUE="$api_memory"
  API_MEMORY_RESERVATION_VALUE="$api_reservation"
  API_CPU_LIMIT_VALUE="$api_cpu"
  POSTGRES_MEMORY_LIMIT_VALUE="$postgres_memory"
  POSTGRES_CPU_LIMIT_VALUE="$postgres_cpu"
  REDIS_MEMORY_LIMIT_VALUE="$redis_memory"
  REDIS_CPU_LIMIT_VALUE="$redis_cpu"
  REDIS_MAXMEMORY_VALUE="$redis_maxmemory"
  WEB_MEMORY_LIMIT_VALUE="$web_memory"
  WEB_CPU_LIMIT_VALUE="$web_cpu"

  echo -e "${GREEN}  ✓ 资源配置: ${profile} 档（检测到约 ${total_mb}MB 内存）${NC}"
}

update_container_limits() {
  local container="$1"
  local memory="$2"
  local reservation="$3"
  local cpus="$4"

  if ! docker container inspect "$container" >/dev/null 2>&1; then
    echo -e "${YELLOW}  - $container 未创建，跳过运行时上限调整${NC}"
    return
  fi

  if [ -n "$reservation" ]; then
    if docker update --memory "$memory" --memory-reservation "$reservation" --cpus "$cpus" "$container" >/dev/null 2>&1; then
      echo -e "${GREEN}  ✓ $container 上限: memory=$memory reservation=$reservation cpus=$cpus${NC}"
    else
      echo -e "${YELLOW}  ⚠ $container 上限调整失败，可能当前内存占用高于新上限${NC}"
    fi
  else
    if docker update --memory "$memory" --cpus "$cpus" "$container" >/dev/null 2>&1; then
      echo -e "${GREEN}  ✓ $container 上限: memory=$memory cpus=$cpus${NC}"
    else
      echo -e "${YELLOW}  ⚠ $container 上限调整失败，可能当前内存占用高于新上限${NC}"
    fi
  fi
}

apply_runtime_limits() {
  echo -e "${YELLOW}正在按 ${RESOURCE_PROFILE:-自动} 档调整正在运行的容器上限...${NC}"
  update_container_limits "3dparthub-api" "$API_MEMORY_LIMIT_VALUE" "$API_MEMORY_RESERVATION_VALUE" "$API_CPU_LIMIT_VALUE"
  update_container_limits "3dparthub-web" "$WEB_MEMORY_LIMIT_VALUE" "" "$WEB_CPU_LIMIT_VALUE"
  update_container_limits "3dparthub-postgres" "$POSTGRES_MEMORY_LIMIT_VALUE" "" "$POSTGRES_CPU_LIMIT_VALUE"
  update_container_limits "3dparthub-redis" "$REDIS_MEMORY_LIMIT_VALUE" "" "$REDIS_CPU_LIMIT_VALUE"

  if docker container inspect 3dparthub-redis >/dev/null 2>&1; then
    if docker exec 3dparthub-redis redis-cli CONFIG SET maxmemory "$REDIS_MAXMEMORY_VALUE" >/dev/null 2>&1; then
      echo -e "${GREEN}  ✓ 3dparthub-redis maxmemory=$REDIS_MAXMEMORY_VALUE${NC}"
    else
      echo -e "${YELLOW}  ⚠ Redis maxmemory 运行时调整失败，下次重建容器会使用 .env 配置${NC}"
    fi
  fi

  echo -e "${YELLOW}  说明: API_WORKERS、API_SHM_SIZE、DB_CONNECTION_LIMIT 已写入 .env，重建 api 后完全生效。${NC}"
}

echo ""
echo "=============================="
echo "  3DPartHub 一键部署"
echo "=============================="
echo ""

# ---------- 检查 Docker ----------
if ! command -v docker &> /dev/null; then
  echo -e "${RED}错误: 未安装 Docker${NC}"
  echo "  安装: curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  echo -e "${RED}错误: Docker Compose v2 不可用${NC}"
  exit 1
fi

# ---------- 1. 创建目录 ----------
echo -e "${YELLOW}[1/4] 创建项目目录...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$BACKUP_DIR"
cd "$INSTALL_DIR"
echo -e "${GREEN}  ✓ $INSTALL_DIR${NC}"
echo -e "${GREEN}  ✓ 备份目录: $BACKUP_DIR${NC}"

# ---------- 2. 下载配置 ----------
echo -e "${YELLOW}[2/4] 下载配置文件...${NC}"
if [ ! -f docker-compose.yml ]; then
  curl -sO https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
  echo -e "${GREEN}  ✓ docker-compose.yml 已下载${NC}"
else
  echo -e "${GREEN}  ✓ docker-compose.yml 已存在${NC}"
  if ! grep -q "./server/static/backups:/app/static/backups" docker-compose.yml 2>/dev/null; then
    echo -e "${YELLOW}  ⚠ 当前 docker-compose.yml 未挂载宿主机备份目录，建议更新为新版配置。${NC}"
    echo -e "${YELLOW}    否则网页备份仍会留在 Docker 卷中，不会直接出现在 $BACKUP_DIR${NC}"
  fi
fi

# ---------- 3. 生成密钥 ----------
echo -e "${YELLOW}[3/4] 配置密钥...${NC}"
if [ ! -f .env ]; then
  cat > .env << EOF
IMAGE_TAG=latest
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASS=$(openssl rand -base64 24 | tr -d '\n')
EOF
  echo -e "${GREEN}  ✓ .env 已生成（latest 镜像、随机数据库密码、JWT 密钥和初始管理员密码）${NC}"
  echo -e "${YELLOW}  初始管理员密码已写入 .env 的 ADMIN_PASS，请首次登录后立即修改。${NC}"
else
  echo -e "${GREEN}  ✓ .env 已存在，保持不变${NC}"
fi
apply_resource_profile

# ---------- 4. 启动服务 ----------
echo -e "${YELLOW}[4/4] 拉取镜像并启动（首次可能需要几分钟）...${NC}"
docker compose pull 2>/dev/null || true
docker compose up -d
apply_runtime_limits

echo ""
echo -e "${YELLOW}等待服务就绪...${NC}"
sleep 15

HEALTH_OK=false
for i in $(seq 1 15); do
  HEALTH=$(curl -s http://localhost:${PORT:-3780}/api/health 2>/dev/null || echo "")
  if echo "$HEALTH" | grep -q "ok"; then
    HEALTH_OK=true
    echo -e "${GREEN}  ✓ API 服务正常${NC}"
    break
  fi
  echo "  等待中... ($i/15)"
  sleep 3
done

# ---------- 导入备份 ----------
if [ -n "$BACKUP_SOURCE" ] && [ "$HEALTH_OK" = true ]; then
  echo ""
  echo -e "${YELLOW}正在导入备份文件...${NC}"

  # 找到备份文件
  TARGZ=""
  JSON=""
  if [ -d "$BACKUP_SOURCE" ]; then
    TARGZ=$(find "$BACKUP_SOURCE" -maxdepth 1 -name "backup_*.tar.gz" 2>/dev/null | head -1)
    JSON=$(find "$BACKUP_SOURCE" -maxdepth 1 -name "backup_*.json" 2>/dev/null | head -1)
  elif [ -f "$BACKUP_SOURCE" ]; then
    TARGZ="$BACKUP_SOURCE"
    JSON="${BACKUP_SOURCE%.tar.gz}.json"
    [ ! -f "$JSON" ] && JSON=""
  fi

  if [ -z "$TARGZ" ]; then
    echo -e "${RED}  ✗ 未找到 backup_*.tar.gz${NC}"
  else
    # 复制到宿主机备份目录；新版 compose 会挂载到容器 /app/static/backups
    cp "$TARGZ" "$BACKUP_DIR/" && echo -e "${GREEN}  ✓ $(basename "$TARGZ") 已复制到 $BACKUP_DIR${NC}" || echo -e "${RED}  ✗ 复制失败${NC}"
    if [ -n "$JSON" ] && [ -f "$JSON" ]; then
      cp "$JSON" "$BACKUP_DIR/" && echo -e "${GREEN}  ✓ $(basename "$JSON") 已复制到 $BACKUP_DIR${NC}" || true
    fi
    echo ""
    echo -e "${YELLOW}  备份文件已导入容器，请登录网页恢复：${NC}"
    echo "  设置 → 数据备份 → 点「恢复」"
  fi
fi

# ---------- 结果 ----------
echo ""
echo -e "${GREEN}=============================="
echo "  部署完成！"
echo "==============================${NC}"
echo ""

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "服务器IP")
echo "  访问地址: http://${SERVER_IP}:${PORT:-3780}"
echo ""
echo "  默认管理员:"
echo "    邮箱: admin@model.local"
echo "    密码: .env 中的 ADMIN_PASS"
echo "    (首次登录强制修改密码)"
echo ""

if [ "$HEALTH_OK" = false ]; then
  echo -e "${RED}  ⚠ 健康检查未通过，查看日志:${NC}"
  echo "  docker compose logs api"
  echo ""
fi

echo "  常用命令:"
echo "    日志:  docker compose logs -f api"
echo "    状态:  docker compose ps"
echo "    停止:  docker compose down"
echo "    升级:  docker compose pull && docker compose up -d --force-recreate"
echo ""
