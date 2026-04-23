#!/bin/bash
# ============================================================
# 3DPartHub 一键部署脚本
# ============================================================
#
# 全新部署:
#   bash deploy.sh
#
# 带备份恢复（自动复制到容器内并恢复）:
#   bash deploy.sh /path/to/backup_1776890498343.tar.gz
#   bash deploy.sh "/www/wwwroot/model备份"
#
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="/opt/3dparthub"
BACKUP_SOURCE="$1"

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
cd "$INSTALL_DIR"
echo -e "${GREEN}  ✓ $INSTALL_DIR${NC}"

# ---------- 2. 下载配置 ----------
echo -e "${YELLOW}[2/4] 下载配置文件...${NC}"
if [ ! -f docker-compose.yml ]; then
  curl -sO https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/docker-compose.yml
  echo -e "${GREEN}  ✓ docker-compose.yml 已下载${NC}"
else
  echo -e "${GREEN}  ✓ docker-compose.yml 已存在${NC}"
fi

# ---------- 3. 生成密钥 ----------
echo -e "${YELLOW}[3/4] 配置密钥...${NC}"
if [ ! -f .env ]; then
  cat > .env << EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
EOF
  echo -e "${GREEN}  ✓ .env 已生成（随机密码和密钥）${NC}"
else
  echo -e "${GREEN}  ✓ .env 已存在，保持不变${NC}"
fi

# ---------- 4. 启动服务 ----------
echo -e "${YELLOW}[4/4] 拉取镜像并启动（首次可能需要几分钟）...${NC}"
docker compose pull 2>/dev/null || true
docker compose up -d

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
    # docker cp 到容器
    docker cp "$TARGZ" 3dparthub-api:/app/static/backups/ 2>/dev/null && echo -e "${GREEN}  ✓ $(basename "$TARGZ") 已复制${NC}" || echo -e "${RED}  ✗ 复制失败${NC}"
    if [ -n "$JSON" ] && [ -f "$JSON" ]; then
      docker cp "$JSON" 3dparthub-api:/app/static/backups/ 2>/dev/null && echo -e "${GREEN}  ✓ $(basename "$JSON") 已复制${NC}" || true
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
echo "    邮箱: admin@model.com"
echo "    密码: admin123"
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
echo "    升级:  改 IMAGE_TAG 版本号 → docker compose pull && docker compose up -d"
echo ""
