#!/usr/bin/env bash
# ============================================================
# safe-migrate.sh — Prisma 安全迁移包装脚本
# ============================================================
# 用法:
#   bash scripts/safe-migrate.sh dev --name <迁移名>   # 安全开发迁移（自动备份）
#   bash scripts/safe-migrate.sh dev --create-only ...  # 只生成迁移文件（不备份）
#   bash scripts/safe-migrate.sh deploy                 # 安全部署迁移
#   bash scripts/safe-migrate.sh force-reset            # 危险！需要 --i-know-what-im-doing
#
# 或通过 npm:
#   npm run prisma:migrate -- --name xxx
#   npm run prisma:deploy
#   npm run prisma:force-reset -- --i-know-what-im-doing
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_DIR="$PROJECT_DIR/static/_safety_snapshots"
BACKUP_DIR="$PROJECT_DIR/static/backups"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ---- Helper functions ----

info()  { echo -e "${CYAN}[SafeMigrate]${NC} $*"; }
warn()  { echo -e "${YELLOW}[SafeMigrate] WARNING:${NC} $*"; }
error() { echo -e "${RED}[SafeMigrate] ERROR:${NC} $*"; }
ok()    { echo -e "${GREEN}[SafeMigrate]${NC} $*"; }

# Quick pg_dump snapshot
create_snapshot() {
  local label="$1"
  local ts=$(date +%Y%m%d_%H%M%S)
  local snapshot_file="$SNAPSHOT_DIR/pre_${label}_${ts}.sql"

  mkdir -p "$SNAPSHOT_DIR"

  # Try Docker container first, then local pg_dump
  local container=""
  if command -v docker &>/dev/null; then
    container=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i postgres | head -1 || true)
  fi

  info "Creating database snapshot before '$label'..."
  if [ -n "$container" ]; then
    docker exec "$container" pg_dump -U modeluser -d 3dparthub --no-owner --no-privileges > "$snapshot_file" 2>/dev/null
  elif command -v pg_dump &>/dev/null; then
    source "$PROJECT_DIR/.env" 2>/dev/null || true
    pg_dump "${DATABASE_URL:-postgresql://modeluser:modelpass@localhost:5433/3dparthub}" --no-owner --no-privileges > "$snapshot_file" 2>/dev/null
  else
    warn "pg_dump not available, skipping snapshot"
    return
  fi

  if [ -s "$snapshot_file" ]; then
    local size=$(du -h "$snapshot_file" | cut -f1)
    ok "Snapshot saved: $snapshot_file ($size)"

    # Clean up snapshots older than 7 days
    find "$SNAPSHOT_DIR" -name "pre_*.sql" -mtime +7 -delete 2>/dev/null || true
    # Keep max 20 snapshots
    local count=$(ls -1 "$SNAPSHOT_DIR"/pre_*.sql 2>/dev/null | wc -l)
    if [ "$count" -gt 20 ]; then
      ls -1t "$SNAPSHOT_DIR"/pre_*.sql | tail -n +21 | xargs rm -f 2>/dev/null || true
    fi
  else
    warn "Snapshot creation failed (empty file)"
    rm -f "$snapshot_file"
  fi
}

# Countdown confirmation
confirm_dangerous() {
  local action="$1"
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ⚠️  危险操作: $action"
  echo -e "${RED}║  这将永久删除数据库中的所有数据！               ${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${YELLOW}必须同时满足:${NC}"
  echo "  1. 传入 --i-know-what-im-doing 参数"
  echo "  2. 在 5 秒倒计时内按 Ctrl+C 取消"
  echo ""

  # Countdown
  for i in 5 4 3 2 1; do
    echo -ne "\r${RED}$i 秒后执行... (Ctrl+C 取消)${NC} "
    sleep 1
  done
  echo ""
  ok "开始执行..."
}

# ---- Main logic ----

COMMAND="${1:-}"
shift || true

case "$COMMAND" in

  # ---- dev: safe migrate dev ----
  dev)
    # Check if --create-only (safe, no backup needed)
    if echo "$@" | grep -q "\-\-create-only"; then
      info "Running prisma migrate dev --create-only (safe, no DB changes)"
      npx prisma migrate dev --create-only "$@"
      ok "Done. Migration file created."
    else
      # This will modify the database — create snapshot first
      create_snapshot "migrate_dev"
      info "Running prisma migrate dev $*"
      npx prisma migrate dev "$@"
      ok "Done."
    fi
    ;;

  # ---- deploy: safe migrate deploy ----
  deploy)
    info "Running prisma migrate deploy (safe, applies pending migrations)"
    npx prisma migrate deploy "$@"
    ok "Done."
    ;;

  # ---- generate: safe prisma generate ----
  generate)
    info "Running prisma generate (safe, no DB changes)"
    npx prisma generate "$@"
    ok "Done."
    ;;

  # ---- force-reset: dangerous, needs confirmation ----
  force-reset)
    if ! echo "$@" | grep -q "\-\-i-know-what-im-doing"; then
      error "force-reset 被拦截！"
      error "如果要执行，必须传入 --i-know-what-im-doing 参数。"
      error "这会清空所有数据库数据！"
      echo ""
      info "正确用法: npm run prisma:force-reset -- --i-know-what-im-doing"
      info "或者: bash scripts/safe-migrate.sh force-reset --i-know-what-im-doing"
      exit 1
    fi

    confirm_dangerous "prisma db push --force-reset"
    create_snapshot "force_reset"
    npx prisma db push --force-reset
    ok "Done. Database has been reset."
    warn "Remember to re-seed data if needed."
    ;;

  # ---- db-push: intercept --force-reset and --accept-data-loss ----
  db-push)
    if echo "$@" | grep -q "\-\-force-reset\|\-\-accept-data-loss"; then
      if ! echo "$@" | grep -q "\-\-i-know-what-im-doing"; then
        error "检测到破坏性参数 (--force-reset 或 --accept-data-loss)！"
        error "已被拦截。请使用: bash scripts/safe-migrate.sh force-reset --i-know-what-im-doing"
        exit 1
      fi
      confirm_dangerous "prisma db push with destructive flags"
      create_snapshot "db_push_destructive"
      npx prisma db push "$@"
    else
      info "Running prisma db push $*"
      npx prisma db push "$@"
    fi
    ;;

  # ---- backup: quick snapshot ----
  backup)
    create_snapshot "manual"
    ;;

  # ---- help / default ----
  help|--help|-h|"")
    echo ""
    echo "Prisma 安全迁移包装脚本"
    echo ""
    echo "用法:"
    echo "  bash scripts/safe-migrate.sh dev --name <名>       开发迁移（自动备份）"
    echo "  bash scripts/safe-migrate.sh dev --create-only     只生成迁移文件"
    echo "  bash scripts/safe-migrate.sh deploy                部署迁移（安全）"
    echo "  bash scripts/safe-migrate.sh generate              生成 Prisma Client"
    echo "  bash scripts/safe-migrate.sh backup                手动创建数据库快照"
    echo "  bash scripts/safe-migrate.sh force-reset           危险！需确认参数"
    echo ""
    echo "npm 快捷命令:"
    echo "  npm run prisma:migrate -- --name <名>"
    echo "  npm run prisma:deploy"
    echo "  npm run prisma:generate"
    echo "  npm run prisma:backup"
    echo "  npm run prisma:force-reset -- --i-know-what-im-doing"
    echo ""
    ;;

  *)
    error "未知命令: $COMMAND"
    echo "运行 bash scripts/safe-migrate.sh help 查看帮助"
    exit 1
    ;;
esac
