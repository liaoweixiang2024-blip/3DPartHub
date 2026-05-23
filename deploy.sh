#!/usr/bin/env bash
# ============================================================
# 3DPartHub 一键部署脚本
# ============================================================
#
# 全新部署:
#   bash deploy.sh
#
# 远程一键安装:
#   curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | bash
#
# 带备份导入（自动复制到宿主机备份目录，登录网页后恢复）:
#   bash deploy.sh /path/to/backup_xxx.tar.gz
#   bash deploy.sh "/www/wwwroot/model备份"
#
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/3dparthub}"
BACKUP_DIR="$INSTALL_DIR/server/static/backups"
BACKUP_SOURCE="${1:-}"
COMPOSE_URL="${COMPOSE_URL:-https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml}"
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
COMPOSE_KIND=""

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

detect_bt_panel() {
  [ -d /www/server/panel ] || command_exists bt
}

compose_cmd() {
  if [ "$COMPOSE_KIND" = "plugin" ]; then
    docker compose "$@"
  elif [ "$COMPOSE_KIND" = "standalone" ]; then
    docker-compose "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command_exists docker-compose; then
    local compose_version
    compose_version="$(docker-compose version 2>/dev/null | head -n 1 || true)"
    if echo "$compose_version" | grep -Eq 'version v?2\.'; then
      docker-compose "$@"
    else
      return 127
    fi
  else
    return 127
  fi
}

compose_display() {
  if [ "$COMPOSE_KIND" = "standalone" ]; then
    echo "docker-compose"
  else
    echo "docker compose"
  fi
}

detect_compose() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    COMPOSE_KIND="plugin"
    return 0
  fi
  if command_exists docker-compose; then
    local compose_version
    compose_version="$(docker-compose version 2>/dev/null | head -n 1 || true)"
    if echo "$compose_version" | grep -Eq 'version v?2\.'; then
      COMPOSE_KIND="standalone"
      return 0
    fi
  fi
  return 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}错误: 请使用 root 用户执行，或用 sudo bash deploy.sh。${NC}"
    exit 1
  fi
}

ensure_install_dir_access() {
  if [ "$(id -u)" -eq 0 ]; then
    return
  fi

  local target="$INSTALL_DIR"
  local parent="$target"
  while [ ! -e "$parent" ] && [ "$parent" != "/" ]; do
    parent="$(dirname "$parent")"
  done

  if [ -e "$target" ]; then
    parent="$target"
  fi

  if [ ! -w "$parent" ]; then
    echo -e "${RED}错误: 当前用户没有写入 ${INSTALL_DIR} 的权限。${NC}"
    echo "请使用 root 执行，或指定有权限的目录，例如: INSTALL_DIR=\$HOME/3dparthub bash deploy.sh"
    exit 1
  fi
}

random_hex() {
  local bytes="$1"
  if command_exists openssl; then
    openssl rand -hex "$bytes"
  else
    tr -dc 'a-f0-9' < /dev/urandom | head -c "$((bytes * 2))"
  fi
}

random_password() {
  if command_exists openssl; then
    openssl rand -base64 24 | tr -d '\n'
  else
    tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32
  fi
}

detect_total_memory_mb() {
  if command_exists free; then
    free -m | awk '/^Mem:/ {print $2; exit}'
    return
  fi
  if [ -r /proc/meminfo ]; then
    awk '/MemTotal:/ {printf "%d\n", $2 / 1024; exit}' /proc/meminfo
    return
  fi
  echo 4096
}

detect_server_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [ -n "$ip" ]; then
    echo "$ip"
  else
    echo "127.0.0.1"
  fi
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

env_value() {
  local key="$1"
  if [ ! -f .env ]; then
    return 0
  fi
  grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d '=' -f 2- || true
}

env_has_key() {
  local key="$1"
  [ -f .env ] && grep -Eq "^${key}=" .env 2>/dev/null
}

ensure_env() {
  local key="$1"
  local value="$2"
  local current
  current="$(env_value "$key")"
  if [ -z "$current" ]; then
    upsert_env "$key" "$value"
  fi
}

configure_docker_apt_repo() {
  if ! command_exists apt-get; then
    return 1
  fi

  . /etc/os-release
  if [ "$ID" != "debian" ] && [ "$ID" != "ubuntu" ]; then
    return 1
  fi

  echo -e "${YELLOW}正在配置 Docker 官方源...${NC}"
  rm -f /etc/apt/sources.list.d/docker.list
  rm -f /etc/apt/sources.list.d/download_docker_com_linux_debian.list
  rm -f /etc/apt/sources.list.d/download_docker_com_linux_ubuntu.list
  rm -f /etc/apt/keyrings/docker.asc
  rm -f /etc/apt/keyrings/docker.gpg

  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release openssl

  install -m 0755 -d /etc/apt/keyrings
  local docker_gpg_tmp
  docker_gpg_tmp="$(mktemp)"
  curl -fsSL -o "$docker_gpg_tmp" "https://download.docker.com/linux/${ID}/gpg"
  gpg --dearmor -o /etc/apt/keyrings/docker.gpg "$docker_gpg_tmp"
  rm -f "$docker_gpg_tmp"
  chmod a+r /etc/apt/keyrings/docker.gpg

  local codename
  codename="${VERSION_CODENAME:-}"
  if [ -z "$codename" ] && command_exists lsb_release; then
    codename="$(lsb_release -cs)"
  fi
  if [ -z "$codename" ]; then
    echo -e "${RED}错误: 无法识别系统版本代号，不能自动添加 Docker 源。${NC}"
    return 1
  fi

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" > /etc/apt/sources.list.d/docker.list

  apt-get update
  if apt-cache policy docker-ce | grep -q 'Candidate: (none)'; then
    echo -e "${YELLOW}Docker 官方源没有可安装版本，准备使用备用安装方式。${NC}"
    return 1
  fi
}

install_docker_with_apt() {
  configure_docker_apt_repo || return 1

  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_compose_plugin_only() {
  if ! command_exists apt-get; then
    return 1
  fi
  configure_docker_apt_repo || return 1
  apt-get install -y docker-compose-plugin
}

install_docker_with_official_script() {
  echo -e "${YELLOW}正在使用 Docker 官方脚本安装...${NC}"
  if command_exists apt-get; then
    apt-get update
    apt-get install -y ca-certificates curl openssl
  fi
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
}

ensure_docker() {
  if detect_bt_panel; then
    echo -e "${YELLOW}检测到宝塔环境，脚本会复用现有 Docker，不会修改宝塔 nginx 配置。${NC}"
  fi

  if command_exists docker; then
    if command_exists systemctl; then
      systemctl start docker >/dev/null 2>&1 || true
    fi
    if detect_compose; then
      echo -e "${GREEN}  ✓ Docker 已安装，复用当前环境${NC}"
    else
      require_root
      echo -e "${YELLOW}检测到 Docker 已安装，但 Docker Compose 不可用，尝试只补装 Compose 插件...${NC}"
      install_compose_plugin_only || true
      if ! detect_compose; then
        echo -e "${RED}错误: Docker 已安装，但 Docker Compose 不可用。${NC}"
        echo "请在宝塔 Docker 管理器或系统中安装 Docker Compose v2 后重试。"
        exit 1
      fi
    fi
  else
    require_root
    echo -e "${YELLOW}未检测到 Docker，开始自动安装...${NC}"
    if ! install_docker_with_apt; then
      install_docker_with_official_script
    fi
    detect_compose || true
  fi

  if command_exists systemctl; then
    systemctl enable docker >/dev/null 2>&1 || true
    systemctl start docker >/dev/null 2>&1 || true
  fi

  if ! command_exists docker; then
    echo -e "${RED}错误: Docker 安装失败，未找到 docker 命令。${NC}"
    exit 1
  fi
  if ! detect_compose; then
    echo -e "${RED}错误: Docker Compose v2 不可用。${NC}"
    exit 1
  fi

  echo -e "${GREEN}  ✓ $(docker --version)${NC}"
  if [ "$COMPOSE_KIND" = "plugin" ]; then
    echo -e "${GREEN}  ✓ $(docker compose version)${NC}"
  else
    echo -e "${GREEN}  ✓ $(docker-compose version | head -n 1)${NC}"
  fi
}

apply_resource_profile() {
  local total_mb profile api_memory api_reservation api_cpu api_workers api_shm conversion_workers
  local postgres_memory postgres_cpu redis_memory redis_cpu redis_maxmemory web_memory web_cpu db_connections

  total_mb="$(detect_total_memory_mb)"
  if [ "$total_mb" -lt 3072 ]; then
    profile="2G"; api_memory="900M"; api_reservation="256M"; api_cpu="1.2"; api_workers="1"; api_shm="256M"; conversion_workers="1"; postgres_memory="384M"; postgres_cpu="0.7"; redis_memory="128M"; redis_cpu="0.3"; redis_maxmemory="96mb"; web_memory="128M"; web_cpu="0.3"; db_connections="3"
  elif [ "$total_mb" -lt 6144 ]; then
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
      echo -e "${YELLOW}  ⚠ $container 上限调整失败，可能当前占用高于新上限${NC}"
    fi
  else
    if docker update --memory "$memory" --cpus "$cpus" "$container" >/dev/null 2>&1; then
      echo -e "${GREEN}  ✓ $container 上限: memory=$memory cpus=$cpus${NC}"
    else
      echo -e "${YELLOW}  ⚠ $container 上限调整失败，可能当前占用高于新上限${NC}"
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
}

stop_nginx_service() {
  if command_exists systemctl; then
    systemctl stop nginx >/dev/null 2>&1 || true
    systemctl disable nginx >/dev/null 2>&1 || true
  fi
  if command_exists service; then
    service nginx stop >/dev/null 2>&1 || true
  fi
}

port_listeners() {
  local port="$1"
  if command_exists ss; then
    ss -ltnp 2>/dev/null | grep ":${port} " || true
  elif command_exists lsof; then
    lsof -i ":${port}" 2>/dev/null || true
  fi
}

release_nginx_port() {
  local port="$1"
  local listeners=""

  listeners="$(port_listeners "$port")"

  if echo "$listeners" | grep -qi 'nginx'; then
    if [ "${AUTO_STOP_NGINX:-0}" = "1" ]; then
      echo -e "${YELLOW}检测到宿主机 nginx 占用 ${port}，AUTO_STOP_NGINX=1，正在停止 nginx...${NC}"
      stop_nginx_service
      listeners="$(port_listeners "$port")"
      if echo "$listeners" | grep -qi 'nginx'; then
        echo -e "${RED}nginx 仍在占用 ${port}，请先在面板或系统里手动释放端口。${NC}"
        echo "$listeners"
        return 1
      fi
      return 0
    fi
    echo -e "${RED}端口 ${port} 已被 nginx 占用。为避免影响宝塔或现有网站，脚本不会自动停止 nginx。${NC}"
    echo ""
    echo "可选处理方式:"
    echo "  1. 确认 nginx 不需要保留后执行: curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | AUTO_STOP_NGINX=1 bash"
    echo "  2. 换端口部署: curl -fsSL https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/install.sh | PORT=3781 bash"
    echo "  3. 保留宝塔 nginx，在宝塔里反向代理到 3DPartHub 的实际端口"
    echo ""
    echo "当前占用:"
    echo "$listeners"
    return 1
  elif [ -n "$listeners" ] && ! echo "$listeners" | grep -qi 'docker'; then
    echo -e "${RED}端口 ${port} 已被占用，Docker 无法绑定。${NC}"
    echo "$listeners"
    echo "可换端口部署: PORT=3781 bash deploy.sh"
    return 1
  fi
  return 0
}

print_diagnostics() {
  echo ""
  echo -e "${YELLOW}容器状态:${NC}"
  compose_cmd ps || true
  echo ""
  echo -e "${YELLOW}API 最近日志:${NC}"
  compose_cmd logs --tail=160 api || true
}

echo ""
echo "=============================="
echo "  3DPartHub 一键部署"
echo "=============================="
echo ""

ensure_docker

echo -e "${YELLOW}[1/4] 创建项目目录...${NC}"
ensure_install_dir_access
mkdir -p "$INSTALL_DIR"
mkdir -p "$BACKUP_DIR"
cd "$INSTALL_DIR"
echo -e "${GREEN}  ✓ $INSTALL_DIR${NC}"
echo -e "${GREEN}  ✓ 备份目录: $BACKUP_DIR${NC}"

echo -e "${YELLOW}[2/4] 下载部署配置...${NC}"
if [ -f docker-compose.yml ]; then
  cp docker-compose.yml "docker-compose.yml.bak.$(date +%Y%m%d%H%M%S)"
fi
curl -fsSL -o docker-compose.yml "$COMPOSE_URL"
echo -e "${GREEN}  ✓ docker-compose.yml 已更新${NC}"

echo -e "${YELLOW}[3/4] 配置运行参数...${NC}"
touch .env
chmod 600 .env 2>/dev/null || true

PORT_FROM_ENV="${PORT:-}"
PORT_VALUE="${PORT_FROM_ENV:-$(env_value PORT)}"
PORT_VALUE="${PORT_VALUE:-3780}"
SERVER_IP="$(detect_server_ip)"

ensure_env IMAGE_TAG "latest"
if [ -n "$PORT_FROM_ENV" ]; then
  upsert_env PORT "$PORT_VALUE"
else
  ensure_env PORT "$PORT_VALUE"
fi
ensure_env DB_PASSWORD "$(random_hex 24)"
ensure_env REDIS_PASSWORD "$(random_hex 24)"
ensure_env JWT_SECRET "$(random_hex 32)"
ensure_env ADMIN_USER "admin"
ensure_env ADMIN_EMAIL "admin@model.com"
ensure_env ADMIN_PASS "$(random_password)"

DEFAULT_ALLOWED_ORIGIN="http://${SERVER_IP}:${PORT_VALUE}"
ALLOWED_VALUE="$(env_value ALLOWED_ORIGINS)"
if [ "${ALLOWED_ORIGINS+x}" = "x" ]; then
  upsert_env ALLOWED_ORIGINS "$ALLOWED_ORIGINS"
elif ! env_has_key ALLOWED_ORIGINS; then
  upsert_env ALLOWED_ORIGINS "$DEFAULT_ALLOWED_ORIGIN"
elif echo "$ALLOWED_VALUE" | grep -Eq 'localhost|^\*$'; then
  upsert_env ALLOWED_ORIGINS "$DEFAULT_ALLOWED_ORIGIN"
elif [ -n "$PORT_FROM_ENV" ]; then
  case "$ALLOWED_VALUE" in
    "http://${SERVER_IP}:"*|"https://${SERVER_IP}:"*)
      upsert_env ALLOWED_ORIGINS "$DEFAULT_ALLOWED_ORIGIN"
      ;;
  esac
fi

apply_resource_profile
if ! release_nginx_port "$PORT_VALUE"; then
  exit 1
fi

echo -e "${GREEN}  ✓ .env 已准备完成${NC}"
echo -e "${YELLOW}  初始管理员密码写在 $INSTALL_DIR/.env 的 ADMIN_PASS。首次登录后请立即修改。${NC}"

echo -e "${YELLOW}[4/4] 拉取镜像并启动（首次可能需要几分钟）...${NC}"
set +e
compose_cmd pull
PULL_STATUS=$?
compose_cmd up -d --force-recreate
UP_STATUS=$?
set -e

if [ "$PULL_STATUS" -ne 0 ]; then
  echo -e "${YELLOW}⚠ 镜像拉取出现异常，如果本机已有镜像会继续尝试启动。${NC}"
fi

if [ "$UP_STATUS" -ne 0 ]; then
  echo -e "${RED}服务启动失败。${NC}"
  print_diagnostics
  exit 1
fi

apply_runtime_limits

echo ""
echo -e "${YELLOW}等待服务就绪...${NC}"
HEALTH_OK=false
for i in $(seq 1 20); do
  HEALTH="$(curl -fsS "http://localhost:${PORT_VALUE}/api/health" 2>/dev/null || true)"
  if echo "$HEALTH" | grep -q "ok"; then
    HEALTH_OK=true
    echo -e "${GREEN}  ✓ API 服务正常${NC}"
    break
  fi
  echo "  等待中... ($i/20)"
  sleep 3
done

if [ "$HEALTH_OK" != true ]; then
  echo -e "${RED}健康检查未通过。${NC}"
  print_diagnostics
  exit 1
fi

if [ -n "$BACKUP_SOURCE" ]; then
  echo ""
  echo -e "${YELLOW}正在导入备份文件到宿主机备份目录...${NC}"
  TARGZ=""
  JSON=""
  if [ -d "$BACKUP_SOURCE" ]; then
    TARGZ="$(find "$BACKUP_SOURCE" -maxdepth 1 -name "backup_*.tar.gz" 2>/dev/null | head -1 || true)"
    JSON="$(find "$BACKUP_SOURCE" -maxdepth 1 -name "backup_*.json" 2>/dev/null | head -1 || true)"
  elif [ -f "$BACKUP_SOURCE" ]; then
    TARGZ="$BACKUP_SOURCE"
    JSON="${BACKUP_SOURCE%.tar.gz}.json"
    [ -f "$JSON" ] || JSON=""
  fi

  if [ -z "$TARGZ" ]; then
    echo -e "${RED}  ✗ 未找到 backup_*.tar.gz${NC}"
  else
    cp "$TARGZ" "$BACKUP_DIR/"
    echo -e "${GREEN}  ✓ $(basename "$TARGZ") 已复制到 $BACKUP_DIR${NC}"
    if [ -n "$JSON" ] && [ -f "$JSON" ]; then
      cp "$JSON" "$BACKUP_DIR/"
      echo -e "${GREEN}  ✓ $(basename "$JSON") 已复制到 $BACKUP_DIR${NC}"
    fi
    echo -e "${YELLOW}  请登录网页端：系统设置 → 数据备份 → 恢复。${NC}"
  fi
fi

echo ""
echo -e "${GREEN}=============================="
echo "  部署完成！"
echo "==============================${NC}"
echo ""
echo "  访问地址: http://${SERVER_IP}:${PORT_VALUE}"
echo ""
echo "  默认管理员:"
echo "    邮箱: $(env_value ADMIN_EMAIL)"
echo "    密码: $INSTALL_DIR/.env 中的 ADMIN_PASS"
echo "    说明: 管理员只在空数据库首次启动时创建"
echo ""
echo "  常用命令:"
echo "    状态:  cd $INSTALL_DIR && $(compose_display) ps"
echo "    日志:  cd $INSTALL_DIR && $(compose_display) logs -f api"
echo "    升级:  cd $INSTALL_DIR && $(compose_display) pull && $(compose_display) up -d --force-recreate"
echo ""
