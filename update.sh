#!/bin/bash
# ===== 3DPartHub 一键更新脚本 =====
# 用法: bash update.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "=============================="
echo "  3DPartHub 一键更新"
echo "=============================="
echo ""

# 检查是否在项目目录
if [ ! -f "docker-compose.prod.yml" ]; then
  echo -e "${RED}错误: 请在项目根目录运行此脚本${NC}"
  exit 1
fi

# 1. 备份数据库
echo -e "${YELLOW}[1/5] 备份数据库...${NC}"
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
docker-compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U modeluser 3dparthub > "$BACKUP_FILE" 2>/dev/null || true
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
  echo -e "${GREEN}  ✓ 数据库已备份: $BACKUP_FILE${NC}"
else
  echo -e "${YELLOW}  ⚠ 数据库备份跳过（服务可能未运行）${NC}"
  rm -f "$BACKUP_FILE"
fi

# 2. 拉取最新代码
echo ""
echo -e "${YELLOW}[2/5] 拉取最新代码...${NC}"
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo -e "${GREEN}  ✓ 已是最新版本${NC}"
  echo -e "  当前: $(git log -1 --oneline)"
  echo ""
  read -p "  是否强制重新构建？(y/N): " FORCE
  if [ "$FORCE" != "y" ] && [ "$FORCE" != "Y" ]; then
    echo -e "${GREEN}  无需更新，退出${NC}"
    exit 0
  fi
else
  echo "  新版本:"
  git log --oneline HEAD..origin/main
  git pull origin main
  echo -e "${GREEN}  ✓ 代码已更新${NC}"
fi

# 3. 重新构建并启动
echo ""
echo -e "${YELLOW}[3/5] 重新构建容器（可能需要几分钟）...${NC}"
docker-compose -f docker-compose.prod.yml up -d --build

# 4. 等待服务就绪
echo ""
echo -e "${YELLOW}[4/5] 等待服务启动...${NC}"
sleep 5

# 检查健康状态
for i in $(seq 1 10); do
  HEALTH=$(curl -s http://localhost:3780/api/health 2>/dev/null || echo "")
  if echo "$HEALTH" | grep -q '"ok"'; then
    echo -e "${GREEN}  ✓ API 服务正常${NC}"
    break
  fi
  if [ $i -eq 10 ]; then
    echo -e "${RED}  ✗ API 启动超时，请检查日志${NC}"
  else
    echo "  等待中... ($i/10)"
    sleep 3
  fi
done

# 5. 显示状态
echo ""
echo -e "${YELLOW}[5/5] 容器状态:${NC}"
docker-compose -f docker-compose.prod.yml ps

# 清理旧备份（保留最近 5 个）
ls -t backup_*.sql 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

echo ""
echo -e "${GREEN}=============================="
echo "  更新完成！"
echo "==============================${NC}"
echo "  访问: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):3780"
echo "  版本: $(git log -1 --oneline)"
echo ""
