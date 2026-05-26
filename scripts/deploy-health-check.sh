#!/bin/sh
set -u

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
PORT_OVERRIDE="${PORT:-}"
HEALTH_URL="${HEALTH_URL:-}"
STRICT="${STRICT:-0}"
SHOW_LOGS="${SHOW_LOGS:-0}"
CHECK_LOGS="${CHECK_LOGS:-1}"
REPORT_FILE="${REPORT_FILE:-}"
JSON_FILE="${JSON_FILE:-}"
EVIDENCE_BUNDLE_ID="${EVIDENCE_BUNDLE_ID:-}"
FAILURES=0
WARNINGS=0
PASSES=0
COMPOSE_KIND=""
DOCKER_READY=0
TEMP_FILES=""
CHECKS_FILE=""
EXPECTED_API_IMAGE_REPO="ghcr.io/liaoweixiang2024-blip/3dparthub-api"
EXPECTED_WEB_IMAGE_REPO="ghcr.io/liaoweixiang2024-blip/3dparthub-web"

cleanup() {
  if [ -n "$TEMP_FILES" ]; then
    rm -f $TEMP_FILES
  fi
}
trap cleanup EXIT INT TERM

if [ -t 1 ]; then
  GREEN="$(printf '\033[0;32m')"
  YELLOW="$(printf '\033[1;33m')"
  RED="$(printf '\033[0;31m')"
  BLUE="$(printf '\033[0;34m')"
  NC="$(printf '\033[0m')"
else
  GREEN=""
  YELLOW=""
  RED=""
  BLUE=""
  NC=""
fi

usage() {
  cat <<'EOF'
3DPartHub Docker 部署自检

用法:
  sh scripts/deploy-health-check.sh
  sh scripts/deploy-health-check.sh --compose-file docker-compose.yml --port 3780

参数:
  --compose-file FILE   指定 Compose 文件，默认 docker-compose.yml
  --env-file FILE       指定环境变量文件，默认 .env
  --port PORT           指定 Web 对外端口，默认读取 .env 的 PORT 或 3780
  --url URL             指定完整健康检查地址，例如 http://127.0.0.1:3780/api/health
  --strict              有警告也返回非 0，适合 CI 或升级前强校验
  --show-logs           输出 API/Web 最近日志
  --no-logs             不扫描 API/Web 日志
  --report FILE         保存一份纯文本自检报告
  --json FILE           保存一份结构化 JSON 自检摘要
  -h, --help            显示帮助
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --compose-file|-f)
      shift
      COMPOSE_FILE="${1:-$COMPOSE_FILE}"
      ;;
    --env-file)
      shift
      ENV_FILE="${1:-$ENV_FILE}"
      ;;
    --port)
      shift
      PORT_OVERRIDE="${1:-$PORT_OVERRIDE}"
      ;;
    --url)
      shift
      HEALTH_URL="${1:-$HEALTH_URL}"
      ;;
    --strict)
      STRICT=1
      ;;
    --show-logs)
      SHOW_LOGS=1
      ;;
    --no-logs)
      CHECK_LOGS=0
      ;;
    --report)
      shift
      REPORT_FILE="${1:-$REPORT_FILE}"
      ;;
    --json)
      shift
      JSON_FILE="${1:-$JSON_FILE}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      usage
      exit 2
      ;;
  esac
  shift
done

command_exists() {
  if [ "${DEPLOY_HEALTH_DISABLE_DOCKER:-0}" = "1" ]; then
    case "$1" in
      docker|docker-compose)
        return 1
        ;;
    esac
  fi
  command -v "$1" >/dev/null 2>&1
}

print_line() {
  printf '%s\n' "$1"
  if [ -n "$REPORT_FILE" ]; then
    printf '%s\n' "$1" >> "$REPORT_FILE"
  fi
}

print_status_line() {
  color="$1"
  message="$2"
  printf '%s%s%s\n' "$color" "$message" "$NC"
  if [ -n "$REPORT_FILE" ]; then
    printf '%s\n' "$message" >> "$REPORT_FILE"
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r/\\r/g'
}

json_bool() {
  if [ "$1" = "1" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

record_check() {
  if [ -n "$CHECKS_FILE" ]; then
    printf '%s\t%s\n' "$1" "$2" >> "$CHECKS_FILE"
  fi
}

current_time() {
  if command_exists date; then
    date '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null || date 2>/dev/null || printf 'unknown'
    return
  fi
  printf 'unknown'
}

host_name() {
  if command_exists hostname; then
    hostname 2>/dev/null || printf 'unknown'
    return
  fi
  uname -n 2>/dev/null || printf 'unknown'
}

system_info() {
  uname -a 2>/dev/null || printf 'unknown'
}

pass() {
  PASSES=$((PASSES + 1))
  printf '%s✓%s %s\n' "$GREEN" "$NC" "$1"
  if [ -n "$REPORT_FILE" ]; then
    printf '✓ %s\n' "$1" >> "$REPORT_FILE"
  fi
  record_check "pass" "$1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf '%s⚠%s %s\n' "$YELLOW" "$NC" "$1"
  if [ -n "$REPORT_FILE" ]; then
    printf '⚠ %s\n' "$1" >> "$REPORT_FILE"
  fi
  record_check "warn" "$1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  printf '%s✗%s %s\n' "$RED" "$NC" "$1"
  if [ -n "$REPORT_FILE" ]; then
    printf '✗ %s\n' "$1" >> "$REPORT_FILE"
  fi
  record_check "fail" "$1"
}

section() {
  printf '\n%s== %s ==%s\n' "$BLUE" "$1" "$NC"
  if [ -n "$REPORT_FILE" ]; then
    printf '\n== %s ==\n' "$1" >> "$REPORT_FILE"
  fi
}

compose_cmd() {
  if [ "$COMPOSE_KIND" = "plugin" ]; then
    if [ -f "$ENV_FILE" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      docker compose -f "$COMPOSE_FILE" "$@"
    fi
    return $?
  fi
  if [ "$COMPOSE_KIND" = "standalone" ]; then
    if [ -f "$ENV_FILE" ]; then
      docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      docker-compose -f "$COMPOSE_FILE" "$@"
    fi
    return $?
  fi
  return 127
}

compose_display() {
  if [ "$COMPOSE_KIND" = "standalone" ]; then
    printf 'docker-compose'
  else
    printf 'docker compose'
  fi
}

detect_compose() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    COMPOSE_KIND="plugin"
    return 0
  fi
  if command_exists docker-compose; then
    compose_version="$(docker-compose version 2>/dev/null | head -n 1 || true)"
    if printf '%s\n' "$compose_version" | grep -Eq 'version v?2\.'; then
      COMPOSE_KIND="standalone"
      return 0
    fi
  fi
  return 1
}

env_value() {
  key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d '=' -f 2- | sed "s/^['\"]//;s/['\"]$//" || true
}

file_permission_mode() {
  target="$1"
  mode=""
  if command_exists stat; then
    mode="$(stat -c '%a' "$target" 2>/dev/null || true)"
    if [ -z "$mode" ]; then
      mode="$(stat -f '%Lp' "$target" 2>/dev/null || true)"
    fi
  fi
  printf '%s' "$mode" | awk 'NF { gsub(/[^0-7]/, ""); if (length($0) >= 3) print substr($0, length($0) - 2); }'
}

check_env_file_permissions() {
  if [ ! -f "$ENV_FILE" ]; then
    return
  fi
  if [ -L "$ENV_FILE" ]; then
    warn "$ENV_FILE 是符号链接，生产环境建议改为普通文件并执行 chmod 600 $ENV_FILE。"
    return
  fi
  mode="$(file_permission_mode "$ENV_FILE")"
  if [ -z "$mode" ]; then
    warn "无法读取 $ENV_FILE 权限；请确认环境文件不是其他系统用户可读。"
    return
  fi
  case "$mode" in
    600|400)
      pass "环境文件权限安全（${ENV_FILE}: ${mode}）。"
      ;;
    *)
      warn "环境文件权限过宽（${ENV_FILE}: ${mode}），建议执行 chmod 600 ${ENV_FILE}，避免数据库/JWT/Redis 密钥被其他系统用户读取。"
      ;;
  esac
}

is_weak_value() {
  value="$1"
  case "$value" in
    ""|changeme|changeme-set-in-env|3DPartHub@2026|3dparthub-default-db-password-change-me-2026|3dparthub-default-jwt-secret-change-me-2026-04-30)
      return 0
      ;;
  esac
  return 1
}

value_length() {
  printf '%s' "$1" | wc -c | awk '{print $1}'
}

read_total_memory_mb() {
  if command_exists free; then
    free -m | awk '/^Mem:/ {print $2; exit}'
    return
  fi
  if [ -r /proc/meminfo ]; then
    awk '/MemTotal:/ {printf "%d\n", $2 / 1024; exit}' /proc/meminfo
    return
  fi
  printf ''
}

parse_size_mb() {
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')"
  if [ -z "$raw" ]; then
    return 1
  fi
  multiplier="1"
  case "$raw" in
    *gib)
      number="${raw%gib}"
      multiplier="1024"
      ;;
    *gb)
      number="${raw%gb}"
      multiplier="1024"
      ;;
    *g)
      number="${raw%g}"
      multiplier="1024"
      ;;
    *mib)
      number="${raw%mib}"
      ;;
    *mb)
      number="${raw%mb}"
      ;;
    *m)
      number="${raw%m}"
      ;;
    *)
      number="$raw"
      ;;
  esac
  awk -v number="$number" -v multiplier="$multiplier" '
    BEGIN {
      if (number ~ /^[0-9]+([.][0-9]+)?$/) {
        printf "%d", number * multiplier
        exit 0
      }
      exit 1
    }
  ' 2>/dev/null
}

parse_cpu_nano() {
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')"
  if [ -z "$raw" ]; then
    return 1
  fi
  awk -v number="$raw" '
    BEGIN {
      if (number ~ /^[0-9]+([.][0-9]+)?$/ && number > 0) {
        printf "%d", number * 1000000000
        exit 0
      }
      exit 1
    }
  ' 2>/dev/null
}

env_or_default() {
  key="$1"
  fallback="$2"
  value="$(env_value "$key")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

positive_int_or_default() {
  value="$1"
  fallback="$2"
  case "$value" in
    ""|*[!0-9]*)
      printf '%s' "$fallback"
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

format_health_body() {
  printf '%s' "$1" | tr '\n' ' ' | cut -c 1-220
}

json_string_field() {
  key="$1"
  file="$2"
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" 2>/dev/null | sed -n '1p'
}

iso_timestamp_to_epoch() {
  value="$(printf '%s' "$1" | sed -E 's/[.][0-9]+Z$/Z/; s/[.][0-9]+([+-][0-9]{2}:?[0-9]{2})$/\1/')"
  if [ -z "$value" ] || ! command_exists date; then
    return 1
  fi
  if epoch="$(date -u -d "$value" '+%s' 2>/dev/null)"; then
    printf '%s' "$epoch"
    return 0
  fi
  bsd_value="$(printf '%s' "$value" | sed -E 's/Z$/+0000/; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')"
  if epoch="$(date -j -u -f '%Y-%m-%dT%H:%M:%S%z' "$bsd_value" '+%s' 2>/dev/null)"; then
    printf '%s' "$epoch"
    return 0
  fi
  if epoch="$(date -j -u -f '%Y-%m-%d %H:%M:%S%z' "$bsd_value" '+%s' 2>/dev/null)"; then
    printf '%s' "$epoch"
    return 0
  fi
  return 1
}

first_frontend_asset_path() {
  printf '%s' "$1" | tr '\n' ' ' | grep -Eo "/assets/[^\"'<> )]+[.](js|css)" 2>/dev/null | sed -n '1p' || true
}

redact_sensitive_text() {
  sed -E \
    -e 's#(postgresql?://[^[:space:]/:@]+:)[^@[:space:]/]+(@)#\1***\2#g' \
    -e 's#(redis://[^[:space:]/:@]*:)[^@[:space:]/]+(@)#\1***\2#g' \
    -e 's#((DB_PASSWORD|REDIS_PASSWORD|JWT_SECRET|ADMIN_PASS|BACKUP_SIGNING_SECRET|BACKUP_ENCRYPTION_SECRET|DATABASE_URL|REDIS_URL|REDISCLI_AUTH|SMTP_PASS|MINIO_SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN)[[:space:]]*[:=][[:space:]]*)[^[:space:]]+#\1[redacted]#g' \
    -e 's#(Authorization[[:space:]]*:[[:space:]]*(Bearer|Basic)[[:space:]]+)[A-Za-z0-9._~+/-]+=*#\1[redacted]#g'
}

init_report() {
  if [ -n "$REPORT_FILE" ] && [ -n "$JSON_FILE" ] && [ "$REPORT_FILE" = "$JSON_FILE" ]; then
    echo "--report 和 --json 不能写入同一个文件: $REPORT_FILE" >&2
    exit 2
  fi
  if [ -z "$REPORT_FILE" ]; then
    :
  else
    report_dir="$(dirname "$REPORT_FILE")"
    if [ "$report_dir" != "." ] && [ ! -d "$report_dir" ]; then
      mkdir -p "$report_dir" 2>/dev/null || {
        echo "无法创建报告目录: $report_dir" >&2
        exit 2
      }
    fi
    : > "$REPORT_FILE" || {
      echo "无法写入报告文件: $REPORT_FILE" >&2
      exit 2
    }
  fi

  if [ -n "$JSON_FILE" ]; then
    json_dir="$(dirname "$JSON_FILE")"
    if [ "$json_dir" != "." ] && [ ! -d "$json_dir" ]; then
      mkdir -p "$json_dir" 2>/dev/null || {
        echo "无法创建 JSON 报告目录: $json_dir" >&2
        exit 2
      }
    fi
    : > "$JSON_FILE" || {
      echo "无法写入 JSON 报告文件: $JSON_FILE" >&2
      exit 2
    }
    CHECKS_FILE="$(make_temp_file || true)"
    if [ -z "$CHECKS_FILE" ]; then
      echo "无法创建 JSON 报告临时文件" >&2
      exit 2
    fi
  fi
}

make_temp_file() {
  tmp_dir="${TMPDIR:-/tmp}"
  tmp_file="$(mktemp "${tmp_dir%/}/3dparthub-api-health.XXXXXX" 2>/dev/null || true)"
  if [ -z "$tmp_file" ]; then
    return 1
  fi
  TEMP_FILES="${TEMP_FILES} ${tmp_file}"
  printf '%s' "$tmp_file"
}

get_port() {
  if [ -n "$PORT_OVERRIDE" ]; then
    printf '%s' "$PORT_OVERRIDE"
    return
  fi
  env_port="$(env_value PORT)"
  if [ -n "$env_port" ]; then
    printf '%s' "$env_port"
    return
  fi
  printf '3780'
}

compose_service_has_key() {
  file="$1"
  service="$2"
  key="$3"
  awk -v svc="$service" -v key="$key" '
    $0 ~ "^  " svc ":" {
      in_service = 1
      next
    }
    in_service && $0 ~ "^  [^ ].*:" {
      exit
    }
    in_service && $0 ~ "^    " key ":" {
      found = 1
      exit
    }
    END {
      exit found ? 0 : 1
    }
  ' "$file"
}

compose_service_key_contains() {
  file="$1"
  service="$2"
  key="$3"
  expected="$4"
  awk -v svc="$service" -v key="$key" -v expected="$expected" '
    $0 ~ "^  " svc ":" {
      in_service = 1
      next
    }
    in_service && $0 ~ "^  [^ ].*:" {
      exit
    }
    in_service && $0 ~ "^    " key ":" {
      if (index($0, expected) > 0) {
        found = 1
      }
      exit
    }
    END {
      exit found ? 0 : 1
    }
  ' "$file"
}

compose_service_key_count() {
  file="$1"
  service="$2"
  key="$3"
  awk -v svc="$service" -v key="$key" '
    $0 ~ "^  " svc ":" {
      in_service = 1
      next
    }
    in_service && $0 ~ "^  [^ ].*:" {
      exit
    }
    in_service && $0 ~ "^    " key ":" {
      count += 1
    }
    END {
      printf "%d", count
    }
  ' "$file"
}

compose_service_block_contains() {
  file="$1"
  service="$2"
  needle="$3"
  awk -v svc="$service" -v needle="$needle" '
    $0 ~ "^  " svc ":" {
      in_service = 1
      next
    }
    in_service && $0 ~ "^  [^ ].*:" {
      exit
    }
    in_service && index($0, needle) > 0 {
      found = 1
      exit
    }
    END {
      exit found ? 0 : 1
    }
  ' "$file"
}

compose_top_level_child_exists() {
  file="$1"
  parent="$2"
  child="$3"
  awk -v parent="$parent" -v child="$child" '
    $0 ~ "^" parent ":" {
      in_parent = 1
      next
    }
    in_parent && $0 ~ "^[^ ].*:" {
      exit
    }
    in_parent && $0 ~ "^  " child ":" {
      found = 1
      exit
    }
    END {
      exit found ? 0 : 1
    }
  ' "$file"
}

check_compose_persistent_mount() {
  file="$1"
  service="$2"
  source="$3"
  target="$4"
  label="$5"
  if compose_service_block_contains "$file" "$service" "$source" && compose_service_block_contains "$file" "$service" "$target"; then
    pass "Compose 持久化挂载正常: ${label}。"
  else
    fail "Compose 持久化挂载缺失: ${label}（需要 ${source} -> ${target}）。"
  fi
}

check_compose_internal_network() {
  file="$1"
  missing=""
  if ! compose_top_level_child_exists "$file" networks internal; then
    missing="${missing} networks.internal"
  fi
  for service in api web postgres redis; do
    if compose_service_block_contains "$file" "$service" "internal"; then
      :
    else
      missing="${missing} ${service}.networks.internal"
    fi
  done
  if [ -z "$missing" ]; then
    pass "Compose 内部网络正常: api/web/postgres/redis 使用 internal。"
  else
    fail "Compose 内部网络缺失:${missing}；请确认核心服务都绑定 internal 网络。"
  fi
}

check_compose_duplicate_service_keys() {
  file="$1"
  duplicates=""
  for service in api web postgres redis; do
    for key in image container_name init shm_size mem_limit mem_reservation cpus deploy environment depends_on volumes healthcheck restart stop_grace_period logging networks ports ulimits command; do
      count="$(compose_service_key_count "$file" "$service" "$key")"
      case "$count" in
        ""|*[!0-9]*)
          count=0
          ;;
      esac
      if [ "$count" -gt 1 ]; then
        duplicates="${duplicates} ${service}.${key}"
      fi
    done
  done

  if [ -z "$duplicates" ]; then
    pass "Compose 服务键未重复: api/web/postgres/redis。"
  else
    fail "Compose 服务键重复:${duplicates}；请清理 docker-compose.yml 中重复键，避免 Compose 解析覆盖配置。"
  fi
}

check_compose_api_environment() {
  file="$1"
  missing=""
  for key in DATABASE_URL REDIS_URL JWT_SECRET BACKUP_SIGNING_SECRET BACKUP_ENCRYPTION_SECRET ALLOWED_ORIGINS; do
    if compose_service_block_contains "$file" api "${key}:" || compose_service_block_contains "$file" api "${key}="; then
      :
    else
      case "$key" in
        ALLOWED_ORIGINS)
          label="API CORS 允许来源"
          ;;
        *)
          label="$key"
          ;;
      esac
      missing="${missing} ${label}"
    fi
  done

  if [ -z "$missing" ]; then
    pass "Compose API 关键环境已声明。"
  else
    fail "Compose API 关键环境缺失:${missing}；请检查 docker-compose.yml 的 api.environment。"
  fi
}

check_compose_image_sources() {
  file="$1"
  expected_tag="$(env_value IMAGE_TAG)"
  expected_tag="${expected_tag:-latest}"
  missing=""
  if compose_service_block_contains "$file" api "image:" &&
    compose_service_block_contains "$file" api "${EXPECTED_API_IMAGE_REPO}:" &&
    compose_service_block_contains "$file" api ":${expected_tag}"; then
    :
  else
    missing="${missing} api"
  fi
  if compose_service_block_contains "$file" web "image:" &&
    compose_service_block_contains "$file" web "${EXPECTED_WEB_IMAGE_REPO}:" &&
    compose_service_block_contains "$file" web ":${expected_tag}"; then
    :
  else
    missing="${missing} web"
  fi

  if [ -z "$missing" ]; then
    pass "Compose 镜像来源正常: api/web 使用 3DPartHub 镜像与 IMAGE_TAG。"
  else
    fail "Compose 镜像来源异常:${missing}；请确认 api/web 镜像为 3DPartHub API/Web 且标签与 IMAGE_TAG 一致。"
  fi
}

check_compose_redis_healthcheck_auth() {
  file="$1"
  if compose_service_block_contains "$file" redis "REDISCLI_AUTH=" && compose_service_block_contains "$file" redis "redis-cli ping"; then
    pass "Compose Redis healthcheck 使用认证 ping。"
  else
    fail "Compose Redis healthcheck 未使用认证 ping；请使用 REDISCLI_AUTH 配合 redis-cli ping，避免 Redis 启用密码后健康检查失效。"
  fi
}

check_compose_web_port_mapping() {
  file="$1"
  port="$2"
  case "$port" in
    ""|*[!0-9]*)
      fail "Compose Web 端口映射无法验证: PORT 配置无效 ${port:-empty}。"
      return
      ;;
  esac

  if {
    compose_service_block_contains "$file" web "target: 80" &&
      {
        compose_service_block_contains "$file" web "published: \"${port}\"" ||
          compose_service_block_contains "$file" web "published: '${port}'" ||
          compose_service_block_contains "$file" web "published: ${port}"
      }
  } || compose_service_block_contains "$file" web "${port}:80"; then
    pass "Compose Web 端口映射正常: ${port}:80。"
  else
    fail "Compose Web 端口映射缺失或异常: 需要宿主机 ${port} -> web 80/tcp；请检查 docker-compose.yml 的 web.ports。"
  fi
}

check_compose_private_service_ports() {
  file="$1"
  exposed=""
  for service in api postgres redis; do
    if compose_service_has_key "$file" "$service" "ports"; then
      exposed="${exposed} ${service}.ports"
    fi
  done

  if [ -z "$exposed" ]; then
    pass "Compose 端口暴露正常: 仅 web 发布对外端口。"
  else
    fail "Compose 端口暴露异常:${exposed}；请不要把 API/PostgreSQL/Redis 直接发布到宿主机。"
  fi
}

check_compose_logging_rotation() {
  file="$1"
  missing=""
  for service in api web postgres redis; do
    if compose_service_block_contains "$file" "$service" "logging:" &&
      compose_service_block_contains "$file" "$service" "driver: json-file" &&
      compose_service_block_contains "$file" "$service" "max-size:" &&
      compose_service_block_contains "$file" "$service" "max-file:"; then
      :
    else
      missing="${missing} ${service}"
    fi
  done

  if [ -z "$missing" ]; then
    pass "Compose 日志轮转已配置: api/web/postgres/redis json-file max-size/max-file。"
  else
    warn "Compose 日志轮转未完整配置:${missing}；请为核心服务配置 json-file max-size/max-file，避免容器日志占满磁盘。"
  fi
}

check_compose_resource_controls() {
  file="$1"
  missing=""
  for service in api web postgres redis; do
    if compose_service_block_contains "$file" "$service" "mem_limit:" &&
      compose_service_block_contains "$file" "$service" "cpus:"; then
      :
    else
      missing="${missing} ${service}"
    fi
  done

  if [ -z "$missing" ]; then
    pass "Compose 资源限制已声明: api/web/postgres/redis mem_limit/cpus。"
  else
    fail "Compose 资源限制缺失:${missing}；请检查 docker-compose.yml 中核心服务的 mem_limit 和 cpus，避免容器无上限抢占服务器资源。"
  fi
}

check_compose_api_stop_grace_period() {
  file="$1"
  if compose_service_has_key "$file" api "stop_grace_period" &&
    {
      compose_service_block_contains "$file" api "5m" ||
        compose_service_block_contains "$file" api "300s"
    }; then
    pass "Compose API 停止宽限期正常: stop_grace_period >= 5m。"
  else
    fail "Compose API 停止宽限期缺失或过短: 需要 api.stop_grace_period 至少 5m，避免备份、恢复、上传或转换任务被 Docker 过早终止。"
  fi
}

write_json_report() {
  result="$1"
  if [ -z "$JSON_FILE" ]; then
    return
  fi

  tmp_json="$(make_temp_file || true)"
  if [ -z "$tmp_json" ]; then
    warn "无法创建 JSON 报告临时文件，跳过 JSON 写入。"
    return
  fi

  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "tool": "3DPartHub Docker 部署自检",\n'
    printf '  "generatedAt": "%s",\n' "$(json_escape "$(current_time)")"
    printf '  "result": "%s",\n' "$(json_escape "$result")"
    printf '  "summary": {"passes": %s, "warnings": %s, "failures": %s},\n' "$PASSES" "$WARNINGS" "$FAILURES"
    printf '  "context": {\n'
    printf '    "host": "%s",\n' "$(json_escape "$(host_name)")"
    printf '    "system": "%s",\n' "$(json_escape "$(system_info)")"
    printf '    "directory": "%s",\n' "$(json_escape "$(pwd)")"
    printf '    "composeFile": "%s",\n' "$(json_escape "$COMPOSE_FILE")"
    printf '    "envFile": "%s",\n' "$(json_escape "$ENV_FILE")"
    printf '    "port": "%s",\n' "$(json_escape "${PORT_VALUE:-$(get_port)}")"
    printf '    "healthUrl": "%s",\n' "$(json_escape "${HEALTH_URL:-}")"
    printf '    "composeKind": "%s",\n' "$(json_escape "$COMPOSE_KIND")"
    printf '    "dockerReady": %s,\n' "$(json_bool "$DOCKER_READY")"
    printf '    "strict": %s,\n' "$(json_bool "$STRICT")"
    printf '    "evidenceBundleId": "%s",\n' "$(json_escape "$EVIDENCE_BUNDLE_ID")"
    printf '    "reportFile": "%s"\n' "$(json_escape "$REPORT_FILE")"
    printf '  },\n'
    printf '  "checks": [\n'
    first=1
    if [ -n "$CHECKS_FILE" ] && [ -f "$CHECKS_FILE" ]; then
      while IFS="$(printf '\t')" read -r check_status check_message; do
        [ -n "$check_status" ] || continue
        if [ "$first" = "1" ]; then
          first=0
        else
          printf ',\n'
        fi
        printf '    {"status": "%s", "message": "%s"}' "$(json_escape "$check_status")" "$(json_escape "$check_message")"
      done < "$CHECKS_FILE"
    fi
    printf '\n  ]\n'
    printf '}\n'
  } > "$tmp_json"

  mv "$tmp_json" "$JSON_FILE"
}

http_get() {
  url="$1"
  if command_exists curl; then
    curl -fsSL --max-time 8 "$url" 2>/dev/null
    return $?
  fi
  if command_exists wget; then
    wget -qO- -T 8 "$url" 2>/dev/null
    return $?
  fi
  return 127
}

http_probe() {
  url="$1"
  if command_exists curl; then
    curl -fsSL --max-time 8 -o /dev/null "$url" 2>/dev/null
    return $?
  fi
  if command_exists wget; then
    wget -qO /dev/null -T 8 "$url" 2>/dev/null
    return $?
  fi
  return 127
}

http_status() {
  url="$1"
  if command_exists curl; then
    code="$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    printf '%s' "${code:-000}"
    return 0
  fi
  if command_exists wget; then
    output="$(wget -S -O /dev/null -T 8 "$url" 2>&1 || true)"
    code="$(printf '%s\n' "$output" | awk '/HTTP\// {code = $2} END {print code}')"
    printf '%s' "${code:-000}"
    return 0
  fi
  return 127
}

http_headers() {
  url="$1"
  if command_exists curl; then
    curl -fsSL --max-time 8 -D - -o /dev/null "$url" 2>/dev/null
    return $?
  fi
  if command_exists wget; then
    wget -S -O /dev/null -T 8 "$url" 2>&1 | sed -n '/^[[:space:]]*HTTP\//,$p'
    return ${PIPESTATUS:-0}
  fi
  return 127
}

headers_have_value() {
  headers="$1"
  name="$2"
  expected="$3"
  printf '%s\n' "$headers" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | grep -Eq "^[[:space:]]*$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]'):[[:space:]]*.*$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
}

check_security_headers() {
  url="$1"
  label="$2"
  mode="$3"
  headers="$(http_headers "$url" || true)"
  if [ -z "$headers" ]; then
    warn "${label}无法读取；请检查 curl/wget 或反代响应头。"
    return
  fi

  missing=""
  if ! headers_have_value "$headers" "X-Content-Type-Options" "nosniff"; then
    missing="${missing} X-Content-Type-Options=nosniff"
  fi
  if ! headers_have_value "$headers" "X-Frame-Options" "SAMEORIGIN"; then
    missing="${missing} X-Frame-Options=SAMEORIGIN"
  fi
  if ! headers_have_value "$headers" "Referrer-Policy" "strict-origin-when-cross-origin"; then
    missing="${missing} Referrer-Policy=strict-origin-when-cross-origin"
  fi
  if [ "$mode" = "web" ] && ! headers_have_value "$headers" "Content-Security-Policy" "default-src"; then
    missing="${missing} Content-Security-Policy"
  fi

  if [ -z "$missing" ]; then
    pass "${label}正常: ${url}"
  else
    warn "${label}缺失或异常:${missing}；请检查 web Nginx、外部反代或安全中间件配置。"
  fi
}

normalize_version_tag() {
  value="$(printf '%s' "$1" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  case "$value" in
    v*|V*)
      printf 'v%s' "$(printf '%s' "$value" | cut -c 2-)"
      ;;
    [0-9]*.[0-9]*.[0-9]*)
      printf 'v%s' "$value"
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

json_string_value() {
  key="$1"
  body="$2"
  printf '%s' "$body" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | sed -n '1p'
}

check_runtime_version_endpoint() {
  base_url="$1"
  version_url="${base_url%/}/api/settings/version"
  body="$(http_get "$version_url" || true)"
  current="$(json_string_value current "$body")"
  if [ -z "$current" ] || [ "$current" = "unknown" ]; then
    fail "运行版本接口异常: ${version_url} $(format_health_body "$body")"
    return
  fi

  expected_tag="$(env_value IMAGE_TAG)"
  expected_tag="${expected_tag:-latest}"
  case "$expected_tag" in
    latest|dev|"")
      pass "运行版本可读取: current=${current}，IMAGE_TAG=${expected_tag}。"
      ;;
    *)
      normalized_current="$(normalize_version_tag "$current")"
      normalized_expected="$(normalize_version_tag "$expected_tag")"
      if [ "$normalized_current" = "$normalized_expected" ]; then
        pass "运行版本可读取: current=${current}，IMAGE_TAG=${expected_tag}，版本一致。"
      else
        fail "运行版本与 IMAGE_TAG 不一致: current=${current}，IMAGE_TAG=${expected_tag}；请确认镜像是否已 pull 并 force-recreate。"
      fi
      ;;
  esac
}

check_admin_health_endpoint_access_control() {
  base_url="$1"
  deep_url="${base_url%/}/api/health/deep"
  status="$(http_status "$deep_url" || printf '000')"
  case "$status" in
    401|403)
      pass "管理健康接口访问控制正常: ${deep_url} 未登录返回 HTTP${status}。"
      ;;
    404|405)
      pass "管理健康接口访问控制正常: ${deep_url} 未公开返回 HTTP${status}。"
      ;;
    30[0-9])
      pass "管理健康接口访问控制正常: ${deep_url} 未登录重定向 HTTP${status}。"
      ;;
    000)
      fail "管理健康接口访问控制无法验证: ${deep_url} 无响应；请检查外部反代和 API 路由。"
      ;;
    2[0-9][0-9])
      fail "管理健康接口未受保护: ${deep_url} 未登录返回 HTTP${status}；请避免公开数据库、Redis、存储或内部诊断信息。"
      ;;
    *)
      fail "管理健康接口访问控制异常: ${deep_url} 返回 HTTP${status}；请确认未登录只返回 401/403/404/405 或登录重定向。"
      ;;
  esac
}

check_sensitive_web_paths() {
  base_url="$1"
  if [ "$COMPOSE_KIND" = "" ] || [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 或 Compose 不可用，跳过 Web 敏感路径暴露检查。"
    return
  fi
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过 Web 敏感路径暴露检查。"
    return
  fi

  probe_name=".deploy-health-sensitive-probe-$$.txt"
  probe_dir=".deploy-health-sensitive-probe-$$"
  if ! compose_cmd exec -T api sh -c '
    set -eu
    probe_name="$1"
    probe_dir="$2"
    for dir in backups originals drawings ticket-attachments inquiry-attachments html-previews batch _backup_db _safety_snapshots .restore_deploy_health_probe; do
      mkdir -p "/app/static/${dir}/${probe_dir}"
      printf "%s\n" "deploy-health-sensitive-probe" > "/app/static/${dir}/${probe_dir}/${probe_name}"
    done
    mkdir -p "/app/uploads/${probe_dir}"
    printf "%s\n" "deploy-health-sensitive-probe" > "/app/uploads/${probe_dir}/${probe_name}"
  ' sh "$probe_name" "$probe_dir" >/dev/null 2>&1; then
    warn "无法创建 Web 敏感路径探针文件，跳过敏感静态目录和上传目录直连暴露检查。"
    return
  fi

  exposed=""
  for path in \
    "/static/backups/${probe_dir}/${probe_name}" \
    "/static/originals/${probe_dir}/${probe_name}" \
    "/static/drawings/${probe_dir}/${probe_name}" \
    "/static/ticket-attachments/${probe_dir}/${probe_name}" \
    "/static/inquiry-attachments/${probe_dir}/${probe_name}" \
    "/static/html-previews/${probe_dir}/${probe_name}" \
    "/static/batch/${probe_dir}/${probe_name}" \
    "/static/_backup_db/${probe_dir}/${probe_name}" \
    "/static/_safety_snapshots/${probe_dir}/${probe_name}" \
    "/static/.restore_deploy_health_probe/${probe_dir}/${probe_name}" \
    "/uploads/${probe_dir}/${probe_name}" \
    "/_protected_static/backups/${probe_dir}/${probe_name}" \
    "/_protected_static/originals/${probe_dir}/${probe_name}" \
    "/_protected_uploads/${probe_dir}/${probe_name}"; do
    url="${base_url%/}${path}"
    status="$(http_status "$url" || printf '000')"
    case "$status" in
      401|403|404)
        :
        ;;
      *)
        exposed="${exposed} ${path}=HTTP${status}"
        ;;
    esac
  done

  compose_cmd exec -T api sh -c '
    probe_name="$1"
    probe_dir="$2"
    for dir in backups originals drawings ticket-attachments inquiry-attachments html-previews batch _backup_db _safety_snapshots .restore_deploy_health_probe; do
      rm -f "/app/static/${dir}/${probe_dir}/${probe_name}"
      rmdir "/app/static/${dir}/${probe_dir}" 2>/dev/null || true
    done
    rm -f "/app/uploads/${probe_dir}/${probe_name}"
    rmdir "/app/uploads/${probe_dir}" 2>/dev/null || true
  ' sh "$probe_name" "$probe_dir" >/dev/null 2>&1 || true

  if [ -z "$exposed" ]; then
    pass "Web 敏感路径未暴露: 静态敏感目录、uploads 和 X-Accel 内部路径探针不可直接访问。"
  else
    fail "Web 敏感路径暴露异常:${exposed}；请检查 web Nginx、外部反代、X-Accel internal 配置和静态目录映射，避免备份或上传文件被直接下载。"
  fi
}

has_http_client() {
  command_exists curl || command_exists wget
}

container_state() {
  name="$1"
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    printf 'missing|missing|missing|false|0'
    return
  fi
  docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}' "$name" 2>/dev/null || printf 'unknown|unknown|unknown|unknown|unknown'
}

container_image() {
  name="$1"
  docker inspect --format '{{.Config.Image}}' "$name" 2>/dev/null || printf 'unknown'
}

container_mounts() {
  name="$1"
  docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Source}}|{{.Destination}}|{{.RW}}{{println}}{{end}}' "$name" 2>/dev/null || true
}

container_log_config() {
  name="$1"
  docker inspect --format '{{.HostConfig.LogConfig.Type}}|{{index .HostConfig.LogConfig.Config "max-size"}}|{{index .HostConfig.LogConfig.Config "max-file"}}' "$name" 2>/dev/null || true
}

container_restart_policy() {
  name="$1"
  docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null || true
}

container_stop_timeout() {
  name="$1"
  timeout="$(docker inspect --format '{{.HostConfig.StopTimeout}}' "$name" 2>/dev/null || true)"
  if [ -n "$timeout" ] && [ "$timeout" != "<nil>" ] && [ "$timeout" != "<no value>" ]; then
    printf '%s\n' "$timeout"
    return
  fi
  timeout="$(docker inspect --format '{{.Config.StopTimeout}}' "$name" 2>/dev/null || true)"
  if [ -n "$timeout" ] && [ "$timeout" != "<nil>" ] && [ "$timeout" != "<no value>" ]; then
    printf '%s\n' "$timeout"
    return
  fi
}

container_resource_limits() {
  name="$1"
  docker inspect --format '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.CpuQuota}}|{{.HostConfig.CpuPeriod}}' "$name" 2>/dev/null || true
}

container_env_value() {
  name="$1"
  key="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null | grep -E "^${key}=" | tail -n 1 | cut -d '=' -f 2- || true
}

container_command_text() {
  name="$1"
  docker inspect --format '{{range .Config.Cmd}}{{println .}}{{end}}' "$name" 2>/dev/null || true
}

container_port_bindings() {
  name="$1"
  docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{printf "%s=" $port}}{{range $bindings}}{{printf "%s:%s " .HostIp .HostPort}}{{end}}{{println}}{{end}}' "$name" 2>/dev/null || true
}

image_tag_matches() {
  image="$1"
  expected_tag="$2"
  case "$image" in
    *":${expected_tag}"|*":${expected_tag}@"*)
      return 0
      ;;
  esac
  return 1
}

image_repo_matches() {
  image="$1"
  expected_repo="$2"
  case "$image" in
    "${expected_repo}:"*|"${expected_repo}@"*)
      return 0
      ;;
  esac
  return 1
}

check_runtime_image_sources() {
  if [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 不可访问，跳过运行镜像来源检查。"
    return
  fi

  checked=0
  mismatches=""
  for pair in "3dparthub-api|${EXPECTED_API_IMAGE_REPO}" "3dparthub-web|${EXPECTED_WEB_IMAGE_REPO}"; do
    container="$(printf '%s' "$pair" | cut -d '|' -f 1)"
    expected_repo="$(printf '%s' "$pair" | cut -d '|' -f 2)"
    if ! docker container inspect "$container" >/dev/null 2>&1; then
      continue
    fi
    checked=1
    image="$(container_image "$container")"
    if ! image_repo_matches "$image" "$expected_repo"; then
      mismatches="${mismatches}${container}=${image} "
    fi
  done

  if [ "$checked" -eq 0 ]; then
    warn "未找到 api/web 容器，无法确认运行镜像来源。"
  elif [ -n "$mismatches" ]; then
    fail "运行镜像来源异常: ${mismatches}；请确认 api/web 容器来自 3DPartHub GHCR 镜像仓库（${EXPECTED_API_IMAGE_REPO} 和 ${EXPECTED_WEB_IMAGE_REPO}），然后重新拉取并重建容器。"
  else
    pass "运行镜像来源正常: api/web 来自 3DPartHub GHCR 镜像仓库。"
  fi
}

check_runtime_image_tag() {
  expected_tag="$(env_value IMAGE_TAG)"
  if [ -z "$expected_tag" ]; then
    warn "IMAGE_TAG 未在 $ENV_FILE 中设置，无法确认 api/web 是否运行预期镜像版本。"
    return
  fi
  if [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 不可访问，跳过 IMAGE_TAG 与运行镜像一致性检查。"
    return
  fi

  checked=0
  mismatches=""
  for container in 3dparthub-api 3dparthub-web; do
    if ! docker container inspect "$container" >/dev/null 2>&1; then
      continue
    fi
    checked=1
    image="$(container_image "$container")"
    if ! image_tag_matches "$image" "$expected_tag"; then
      mismatches="${mismatches}${container}=${image} "
    fi
  done

  if [ "$checked" -eq 0 ]; then
    warn "未找到 api/web 容器，无法确认运行镜像标签。"
  elif [ -n "$mismatches" ]; then
    warn "运行镜像标签与 IMAGE_TAG 不一致（期望 ${expected_tag}）：${mismatches}；请执行 docker compose pull && docker compose up -d --force-recreate。"
  else
    pass "运行镜像标签与 IMAGE_TAG 一致（${expected_tag}）。"
  fi
}

check_container_mount() {
  container="$1"
  marker="$2"
  destination="$3"
  expected_rw="$4"
  label="$5"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    return
  fi
  mounts="$(container_mounts "$container")"
  if printf '%s\n' "$mounts" | awk -F '|' -v marker="$marker" -v destination="$destination" -v expected_rw="$expected_rw" '
    $4 == destination && (index($2, marker) > 0 || index($3, marker) > 0) {
      if (expected_rw == "any" || $5 == expected_rw) {
        found = 1
      }
    }
    END {
      exit found ? 0 : 1
    }
  '; then
    pass "容器挂载正常: ${label}。"
  else
    fail "容器挂载缺失或读写状态异常: ${label}（需要 ${marker} -> ${destination}, rw=${expected_rw}）。"
  fi
}

check_runtime_container_mounts() {
  check_container_mount 3dparthub-api "uploads-data" "/app/uploads" "true" "api uploads-data -> /app/uploads"
  check_container_mount 3dparthub-api "static-data" "/app/static" "true" "api static-data -> /app/static"
  check_container_mount 3dparthub-api "server/static/backups" "/app/static/backups" "true" "api ./server/static/backups -> /app/static/backups"
  check_container_mount 3dparthub-web "static-data" "/app/static" "false" "web static-data -> /app/static:ro"
  check_container_mount 3dparthub-web "uploads-data" "/app/uploads" "false" "web uploads-data -> /app/uploads:ro"
  check_container_mount 3dparthub-postgres "pgdata" "/var/lib/postgresql/data" "true" "postgres pgdata -> /var/lib/postgresql/data"
  check_container_mount 3dparthub-redis "redis-data" "/data" "true" "redis redis-data -> /data"
}

check_web_port_binding() {
  port="$1"
  case "$port" in
    ""|*[!0-9]*)
      fail "PORT 配置无效: ${port:-empty}；请在 $ENV_FILE 中设置数字端口。"
      return
      ;;
  esac
  if ! docker container inspect 3dparthub-web >/dev/null 2>&1; then
    fail "Web 容器不存在，无法确认端口映射。"
    return
  fi

  bindings="$(container_port_bindings 3dparthub-web)"
  if printf '%s\n' "$bindings" | awk -v port="$port" '
    /^80\/tcp=/ {
      sub(/^80\/tcp=/, "")
      count = split($0, parts, /[[:space:]]+/)
      for (part_index = 1; part_index <= count; part_index += 1) {
        if (parts[part_index] ~ ":" port "$") {
          found = 1
        }
      }
    }
    END {
      exit found ? 0 : 1
    }
  '; then
    pass "Web 容器端口映射正常: 宿主机 ${port} -> 80/tcp。"
  else
    fail "Web 容器端口映射异常: 未发现宿主机端口 ${port} -> 80/tcp；当前映射: ${bindings:-none}。请执行 docker compose up -d --force-recreate web。"
  fi
}

check_runtime_private_port_bindings() {
  exposed=""
  checked=0
  for container in 3dparthub-api 3dparthub-postgres 3dparthub-redis; do
    if ! docker container inspect "$container" >/dev/null 2>&1; then
      continue
    fi
    checked=1
    bindings="$(container_port_bindings "$container")"
    if printf '%s\n' "$bindings" | awk -F '=' '
      NF >= 2 {
        count = split($2, parts, /[[:space:]]+/)
        for (part_index = 1; part_index <= count; part_index += 1) {
          if (parts[part_index] ~ /:[0-9]+$/) {
            found = 1
          }
        }
      }
      END {
        exit found ? 0 : 1
      }
    '; then
      exposed="${exposed} ${container}(${bindings})"
    fi
  done

  if [ "$checked" -eq 0 ]; then
    warn "未找到 api/postgres/redis 容器，跳过私有服务端口暴露检查。"
  elif [ -z "$exposed" ]; then
    pass "运行容器端口暴露正常: api/postgres/redis 未直接发布到宿主机。"
  else
    fail "运行容器端口暴露异常:${exposed}；请重建容器，避免 API/数据库/Redis 直接暴露。"
  fi
}

check_runtime_container_logging() {
  missing=""
  checked=0
  for container in 3dparthub-api 3dparthub-web 3dparthub-postgres 3dparthub-redis; do
    if ! docker container inspect "$container" >/dev/null 2>&1; then
      continue
    fi
    checked=1
    log_config="$(container_log_config "$container")"
    driver="$(printf '%s' "$log_config" | cut -d '|' -f 1)"
    max_size="$(printf '%s' "$log_config" | cut -d '|' -f 2)"
    max_file="$(printf '%s' "$log_config" | cut -d '|' -f 3)"
    if [ "$driver" = "json-file" ] && [ -n "$max_size" ] && [ -n "$max_file" ]; then
      :
    else
      missing="${missing} ${container}"
    fi
  done

  if [ "$checked" -eq 0 ]; then
    warn "未找到核心容器，无法确认运行容器日志轮转配置。"
  elif [ -z "$missing" ]; then
    pass "容器日志轮转正常: api/web/postgres/redis json-file max-size/max-file。"
  else
    warn "容器日志轮转未完整生效:${missing}；请执行 docker compose up -d --force-recreate 让 logging 配置进入运行容器。"
  fi
}

check_runtime_container_restart_policy() {
  missing=""
  checked=0
  for container in 3dparthub-api 3dparthub-web 3dparthub-postgres 3dparthub-redis; do
    if ! docker container inspect "$container" >/dev/null 2>&1; then
      continue
    fi
    checked=1
    policy="$(container_restart_policy "$container")"
    if [ "$policy" = "unless-stopped" ]; then
      :
    else
      missing="${missing} ${container}=${policy:-none}"
    fi
  done

  if [ "$checked" -eq 0 ]; then
    warn "未找到核心容器，无法确认运行容器重启策略。"
  elif [ -z "$missing" ]; then
    pass "容器重启策略正常: api/web/postgres/redis restart=unless-stopped。"
  else
    warn "容器重启策略未完整生效:${missing}；请执行 docker compose up -d --force-recreate 让 restart: unless-stopped 进入运行容器。"
  fi
}

check_runtime_api_stop_timeout() {
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过运行容器停止宽限期检查。"
    return
  fi
  timeout="$(container_stop_timeout 3dparthub-api)"
  case "$timeout" in
    ""|"<nil>"|*[!0-9]*)
      fail "API 停止宽限期无法识别: ${timeout:-none}；请重建 API 容器，让 stop_grace_period: 5m 生效。"
      ;;
    *)
      if [ "$timeout" -ge 300 ]; then
        pass "运行 API 停止宽限期正常: StopTimeout=${timeout}s。"
      else
        fail "API 停止宽限期过短: StopTimeout=${timeout}s；请执行 docker compose up -d --force-recreate api，让 stop_grace_period: 5m 生效。"
      fi
      ;;
  esac
}

is_positive_number() {
  value="$1"
  case "$value" in
    ""|*[!0-9]*)
      return 1
      ;;
  esac
  [ "$value" -gt 0 ]
}

cpu_limit_nano() {
  nano_cpus="$1"
  cpu_quota="$2"
  cpu_period="$3"
  if is_positive_number "$nano_cpus"; then
    printf '%s' "$nano_cpus"
    return
  fi
  if is_positive_number "$cpu_quota" && is_positive_number "$cpu_period"; then
    awk -v quota="$cpu_quota" -v period="$cpu_period" 'BEGIN { printf "%d", quota / period * 1000000000 }'
    return
  fi
  printf '0'
}

runtime_resource_issue() {
  container="$1"
  expected_memory_mb="$2"
  expected_cpu_nano="$3"
  label="$4"
  limits="$(container_resource_limits "$container")"
  memory_bytes="$(printf '%s' "$limits" | cut -d '|' -f 1)"
  nano_cpus="$(printf '%s' "$limits" | cut -d '|' -f 2)"
  cpu_quota="$(printf '%s' "$limits" | cut -d '|' -f 3)"
  cpu_period="$(printf '%s' "$limits" | cut -d '|' -f 4)"
  actual_cpu_nano="$(cpu_limit_nano "$nano_cpus" "$cpu_quota" "$cpu_period")"
  if ! is_positive_number "$memory_bytes" || ! is_positive_number "$actual_cpu_nano"; then
    printf ' %s=missing' "$label"
    return 1
  fi
  memory_mb="$(awk -v bytes="$memory_bytes" 'BEGIN { printf "%d", bytes / 1048576 }')"
  if [ "$memory_mb" -ne "$expected_memory_mb" ] || [ "$actual_cpu_nano" -ne "$expected_cpu_nano" ]; then
    printf ' %s=mismatch' "$label"
    return 1
  fi
  return 0
}

check_runtime_container_resource_limits() {
  missing=""
  checked=0
  api_memory_mb="$(parse_size_mb "$(env_or_default API_MEMORY_LIMIT 2G)" || true)"
  web_memory_mb="$(parse_size_mb "$(env_or_default WEB_MEMORY_LIMIT 256M)" || true)"
  postgres_memory_mb="$(parse_size_mb "$(env_or_default POSTGRES_MEMORY_LIMIT 512M)" || true)"
  redis_memory_mb="$(parse_size_mb "$(env_or_default REDIS_MEMORY_LIMIT 256M)" || true)"
  api_cpu_nano="$(parse_cpu_nano "$(env_or_default API_CPU_LIMIT 2)" || true)"
  web_cpu_nano="$(parse_cpu_nano "$(env_or_default WEB_CPU_LIMIT 0.5)" || true)"
  postgres_cpu_nano="$(parse_cpu_nano "$(env_or_default POSTGRES_CPU_LIMIT 1)" || true)"
  redis_cpu_nano="$(parse_cpu_nano "$(env_or_default REDIS_CPU_LIMIT 0.5)" || true)"

  if [ -z "$api_memory_mb" ] || [ -z "$web_memory_mb" ] || [ -z "$postgres_memory_mb" ] || [ -z "$redis_memory_mb" ] ||
    [ -z "$api_cpu_nano" ] || [ -z "$web_cpu_nano" ] || [ -z "$postgres_cpu_nano" ] || [ -z "$redis_cpu_nano" ]; then
    fail "资源限制一致性无法验证：请检查 API/WEB/POSTGRES/REDIS 的 MEMORY_LIMIT 与 CPU_LIMIT 配置。"
    return
  fi

  if docker container inspect 3dparthub-api >/dev/null 2>&1; then
    checked=1
    issue="$(runtime_resource_issue 3dparthub-api "$api_memory_mb" "$api_cpu_nano" "api" || true)"
    missing="${missing}${issue}"
  fi
  if docker container inspect 3dparthub-web >/dev/null 2>&1; then
    checked=1
    issue="$(runtime_resource_issue 3dparthub-web "$web_memory_mb" "$web_cpu_nano" "web" || true)"
    missing="${missing}${issue}"
  fi
  if docker container inspect 3dparthub-postgres >/dev/null 2>&1; then
    checked=1
    issue="$(runtime_resource_issue 3dparthub-postgres "$postgres_memory_mb" "$postgres_cpu_nano" "postgres" || true)"
    missing="${missing}${issue}"
  fi
  if docker container inspect 3dparthub-redis >/dev/null 2>&1; then
    checked=1
    issue="$(runtime_resource_issue 3dparthub-redis "$redis_memory_mb" "$redis_cpu_nano" "redis" || true)"
    missing="${missing}${issue}"
  fi

  if [ "$checked" -eq 0 ]; then
    warn "未找到核心容器，无法确认运行容器资源限制。"
  elif [ -z "$missing" ]; then
    pass "容器资源限制正常: api/web/postgres/redis memory/cpu limits 与 .env 一致。"
  else
    fail "容器资源限制未完整生效或与 .env 不一致:${missing}；请执行 docker compose up -d --force-recreate 让 mem_limit/cpus 进入运行容器。"
  fi
}

check_container_env_equals() {
  container="$1"
  key="$2"
  expected="$3"
  label="$4"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    return
  fi
  actual="$(container_env_value "$container" "$key")"
  if [ -z "$actual" ]; then
    fail "容器环境缺失: ${label}。"
  elif [ "$actual" = "$expected" ]; then
    pass "容器环境与 .env 一致: ${label}。"
  else
    fail "容器环境与 .env 不一致: ${label}；请执行 docker compose up -d --force-recreate。"
  fi
}

check_container_env_contains() {
  container="$1"
  key="$2"
  expected="$3"
  label="$4"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    return
  fi
  actual="$(container_env_value "$container" "$key")"
  if [ -z "$actual" ]; then
    fail "容器环境缺失: ${label}。"
  elif printf '%s' "$actual" | grep -F -q -- "$expected"; then
    pass "容器环境与 .env 一致: ${label}。"
  else
    fail "容器环境与 .env 不一致: ${label}；请执行 docker compose up -d --force-recreate。"
  fi
}

check_container_optional_env_equals() {
  container="$1"
  key="$2"
  expected="$3"
  label="$4"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    return
  fi
  actual="$(container_env_value "$container" "$key")"
  if [ "$actual" = "$expected" ]; then
    pass "容器环境与 .env 一致: ${label}。"
  else
    fail "容器环境与 .env 不一致: ${label}；请执行 docker compose up -d --force-recreate。"
  fi
}

check_container_command_contains() {
  container="$1"
  expected="$2"
  label="$3"
  if ! docker container inspect "$container" >/dev/null 2>&1; then
    return
  fi
  command_text="$(container_command_text "$container")"
  if printf '%s' "$command_text" | grep -F -q -- "$expected"; then
    pass "容器启动参数与 .env 一致: ${label}。"
  else
    fail "容器启动参数与 .env 不一致: ${label}；请执行 docker compose up -d --force-recreate。"
  fi
}

check_runtime_env_consistency() {
  db_password="$(env_value DB_PASSWORD)"
  redis_password="$(env_value REDIS_PASSWORD)"
  jwt_secret="$(env_value JWT_SECRET)"
  backup_signing_secret="$(env_value BACKUP_SIGNING_SECRET)"
  backup_encryption_secret="$(env_value BACKUP_ENCRYPTION_SECRET)"
  allowed_origins="$(env_value ALLOWED_ORIGINS)"

  if [ -n "$db_password" ]; then
    check_container_env_contains 3dparthub-api DATABASE_URL "$db_password" "API DATABASE_URL 使用 DB_PASSWORD"
    check_container_env_equals 3dparthub-postgres POSTGRES_PASSWORD "$db_password" "PostgreSQL POSTGRES_PASSWORD 使用 DB_PASSWORD"
  else
    warn "DB_PASSWORD 未在 $ENV_FILE 中设置，跳过运行时数据库密码一致性检查。"
  fi

  if [ -n "$redis_password" ]; then
    check_container_env_contains 3dparthub-api REDIS_URL "$redis_password" "API REDIS_URL 使用 REDIS_PASSWORD"
    check_container_command_contains 3dparthub-redis "$redis_password" "Redis requirepass 使用 REDIS_PASSWORD"
  else
    warn "REDIS_PASSWORD 未在 $ENV_FILE 中设置，跳过运行时 Redis 密码一致性检查。"
  fi

  if [ -n "$jwt_secret" ]; then
    check_container_env_equals 3dparthub-api JWT_SECRET "$jwt_secret" "API JWT_SECRET"
  else
    warn "JWT_SECRET 未在 $ENV_FILE 中设置，跳过运行时 JWT_SECRET 一致性检查。"
  fi

  if [ -n "$backup_signing_secret" ]; then
    check_container_env_equals 3dparthub-api BACKUP_SIGNING_SECRET "$backup_signing_secret" "API BACKUP_SIGNING_SECRET"
  else
    warn "BACKUP_SIGNING_SECRET 未在 $ENV_FILE 中设置，跳过运行时备份签名密钥一致性检查。"
  fi

  if [ -n "$backup_encryption_secret" ]; then
    check_container_env_equals 3dparthub-api BACKUP_ENCRYPTION_SECRET "$backup_encryption_secret" "API BACKUP_ENCRYPTION_SECRET"
  else
    warn "BACKUP_ENCRYPTION_SECRET 未在 $ENV_FILE 中设置，跳过运行时备份加密密钥一致性检查。"
  fi

  check_container_optional_env_equals 3dparthub-api ALLOWED_ORIGINS "$allowed_origins" "API CORS 允许来源"
}

check_api_process_user() {
  if [ "$COMPOSE_KIND" = "" ] || [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 或 Compose 不可用，跳过 API 主进程用户检查。"
    return
  fi
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过主进程用户检查。"
    return
  fi
  status="$(docker inspect --format '{{.State.Status}}' 3dparthub-api 2>/dev/null || true)"
  if [ "$status" != "running" ]; then
    warn "API 容器未运行，跳过主进程用户检查。"
    return
  fi

  process_user_output="$(
    compose_cmd exec -T api sh -c '
      uid="$(awk "/^Uid:/ {print \$2; exit}" /proc/1/status 2>/dev/null || true)"
      gid="$(awk "/^Gid:/ {print \$2; exit}" /proc/1/status 2>/dev/null || true)"
      user=""
      if [ -n "$uid" ] && [ -r /etc/passwd ]; then
        user="$(awk -F: -v uid="$uid" "\$3 == uid { print \$1; exit }" /etc/passwd 2>/dev/null || true)"
      fi
      printf "%s|%s|%s\n" "$uid" "${user:-unknown}" "$gid"
    ' 2>&1
  )"
  process_user_status=$?
  safe_output="$(printf '%s' "$process_user_output" | redact_sensitive_text)"
  if [ "$process_user_status" -ne 0 ] || [ -z "$safe_output" ]; then
    fail "API 主进程用户无法验证: $(format_health_body "$safe_output")"
    return
  fi

  uid="$(printf '%s' "$safe_output" | cut -d '|' -f 1)"
  user="$(printf '%s' "$safe_output" | cut -d '|' -f 2)"
  gid="$(printf '%s' "$safe_output" | cut -d '|' -f 3)"
  case "$uid" in
    ""|*[!0-9]*)
      fail "API 主进程用户无法识别: $(format_health_body "$safe_output")"
      ;;
    0)
      fail "API 主进程以 root 运行: uid=${uid}, user=${user:-unknown}, gid=${gid:-unknown}；请确认 API 镜像启动命令仍使用 su-exec node:node。"
      ;;
    *)
      pass "API 主进程非 root 运行: uid=${uid}, user=${user:-unknown}, gid=${gid:-unknown}。"
      ;;
  esac
}

check_secret() {
  key="$1"
  min_len="$2"
  label="$3"
  value="$(env_value "$key")"
  if [ -z "$value" ]; then
    warn "$label 未在 $ENV_FILE 中设置，Compose 会使用默认值；生产环境建议改为随机强密钥。"
    return
  fi
  if is_weak_value "$value"; then
    warn "$label 使用默认或弱值；生产环境建议立即更换。"
    return
  fi
  len="$(value_length "$value")"
  if [ "$len" -lt "$min_len" ]; then
    warn "$label 长度只有 ${len}，建议至少 ${min_len} 个字符。"
    return
  fi
  pass "$label 已设置。"
}

check_port_listener() {
  port="$1"
  listeners=""
  if command_exists ss; then
    listeners="$(ss -ltnp 2>/dev/null | grep ":${port} " || true)"
  elif command_exists lsof; then
    listeners="$(lsof -i ":${port}" 2>/dev/null || true)"
  fi

  if [ -z "$listeners" ]; then
    warn "宿主机端口 ${port} 未检测到监听；如果服务刚启动，稍后再试。"
    return
  fi

  if printf '%s\n' "$listeners" | grep -qi 'nginx'; then
    warn "端口 ${port} 当前有 nginx 监听；若健康检查失败，请确认是否被宝塔/nginx 占用或反代配置错误。"
    return
  fi

  pass "宿主机端口 ${port} 已有监听。"
}

check_disk() {
  target="$1"
  label="${2:-磁盘}"
  if ! command_exists df; then
    warn "未找到 df，跳过${label}空间检查。"
    return
  fi
  line="$(df -Pm "$target" 2>/dev/null | awk 'NR==2 {print $4 "|" $5 "|" $6}')"
  free_mb="$(printf '%s' "$line" | cut -d '|' -f 1)"
  used_pct="$(printf '%s' "$line" | cut -d '|' -f 2)"
  mount_point="$(printf '%s' "$line" | cut -d '|' -f 3)"
  if [ -z "$free_mb" ]; then
    warn "无法读取${label}空间。"
    return
  fi
  if [ "$free_mb" -lt 1024 ]; then
    fail "${label}剩余不足 1GB（${mount_point}，已用 ${used_pct}），备份和模型上传可能失败。"
  elif [ "$free_mb" -lt 5120 ]; then
    warn "${label}剩余不足 5GB（${mount_point}，已用 ${used_pct}），建议尽快清理或扩容。"
  else
    pass "${label}空间正常（${mount_point} 剩余约 ${free_mb}MB）。"
  fi
}

check_inodes() {
  target="$1"
  label="${2:-目录}"
  if ! command_exists df; then
    warn "未找到 df，跳过${label} inode 检查。"
    return
  fi
  line="$(df -Pi "$target" 2>/dev/null | awk 'NR==2 {print $4 "|" $5 "|" $6}')"
  free_inodes="$(printf '%s' "$line" | cut -d '|' -f 1)"
  used_pct="$(printf '%s' "$line" | cut -d '|' -f 2 | tr -d '%')"
  mount_point="$(printf '%s' "$line" | cut -d '|' -f 3)"
  if [ -z "$free_inodes" ] || printf '%s' "$free_inodes" | grep -Eq '[^0-9]'; then
    warn "无法读取${label} inode。"
    return
  fi
  case "$used_pct" in
    ""|*[!0-9]*)
      used_pct=0
      ;;
  esac
  if [ "$free_inodes" -lt 10000 ] || [ "$used_pct" -ge 98 ]; then
    fail "${label} inode 剩余不足（${mount_point}，剩余 ${free_inodes}，已用 ${used_pct}%），模型文件、预览图或备份可能无法写入。"
  elif [ "$free_inodes" -lt 50000 ] || [ "$used_pct" -ge 95 ]; then
    warn "${label} inode 剩余偏低（${mount_point}，剩余 ${free_inodes}，已用 ${used_pct}%），建议清理小文件或扩容。"
  else
    pass "${label} inode 正常（${mount_point} 剩余 ${free_inodes}）。"
  fi
}

docker_data_root_dir() {
  if [ "$DOCKER_READY" != "1" ]; then
    return 1
  fi
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -z "$root" ] || printf '%s' "$root" | grep -q '{{'; then
    root="$(docker info 2>/dev/null | awk -F': ' '/Docker Root Dir:/ {print $2; exit}' || true)"
  fi
  printf '%s' "$root"
}

check_docker_data_root() {
  if [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 不可访问，跳过 Docker 数据目录磁盘/inode 检查。"
    return
  fi
  root="$(docker_data_root_dir)"
  if [ -z "$root" ]; then
    warn "无法识别 Docker 数据目录，跳过 Docker 数据目录磁盘/inode 检查。"
    return
  fi
  if [ ! -d "$root" ]; then
    warn "Docker 数据目录不存在或不可访问: $root"
    return
  fi
  check_disk "$root" "Docker 数据目录磁盘"
  check_inodes "$root" "Docker 数据目录"
}

check_writable_directory() {
  target="$1"
  label="$2"
  if [ ! -d "$target" ]; then
    warn "${label}不存在: $target"
    return
  fi
  probe="${target%/}/.deploy-health-write-test-$$"
  if (umask 077 && : > "$probe") 2>/dev/null; then
    if rm -f "$probe" 2>/dev/null; then
      pass "${label}可写。"
    else
      fail "${label}可写但无法清理探针文件: $probe"
    fi
  else
    fail "${label}不可写，无法创建探针文件: $target"
  fi
}

check_memory() {
  if ! command_exists free; then
    warn "未找到 free，跳过内存检查。"
    return
  fi
  available_mb="$(free -m | awk '/^Mem:/ {print $7; exit}')"
  total_mb="$(free -m | awk '/^Mem:/ {print $2; exit}')"
  if [ -z "$available_mb" ]; then
    warn "无法读取内存状态。"
    return
  fi
  if [ "$available_mb" -lt 256 ]; then
    fail "可用内存不足 256MB（总内存 ${total_mb}MB），容器可能反复重启。"
  elif [ "$available_mb" -lt 512 ]; then
    warn "可用内存不足 512MB（总内存 ${total_mb}MB），转换模型时可能卡顿。"
  else
    pass "内存状态正常（总 ${total_mb}MB，可用 ${available_mb}MB）。"
  fi
}

check_resource_budget() {
  total_mb="$(read_total_memory_mb)"
  case "$total_mb" in
    ""|*[!0-9]*)
      warn "无法读取服务器总内存，跳过资源配置预算检查。"
      return
      ;;
  esac

  if [ "$total_mb" -lt 3072 ]; then
    profile="2G"; max_api_workers=1; max_conversion_workers=1; max_db_connections=5
  elif [ "$total_mb" -lt 6144 ]; then
    profile="4G"; max_api_workers=1; max_conversion_workers=1; max_db_connections=8
  elif [ "$total_mb" -lt 12288 ]; then
    profile="8G"; max_api_workers=2; max_conversion_workers=1; max_db_connections=12
  elif [ "$total_mb" -lt 24576 ]; then
    profile="16G"; max_api_workers=3; max_conversion_workers=2; max_db_connections=20
  else
    profile="32G+"; max_api_workers=4; max_conversion_workers=2; max_db_connections=30
  fi

  api_memory_limit="$(env_value API_MEMORY_LIMIT)"
  postgres_memory_limit="$(env_value POSTGRES_MEMORY_LIMIT)"
  redis_memory_limit="$(env_value REDIS_MEMORY_LIMIT)"
  web_memory_limit="$(env_value WEB_MEMORY_LIMIT)"
  api_shm_size="$(env_value API_SHM_SIZE)"
  redis_maxmemory="$(env_value REDIS_MAXMEMORY)"
  api_workers="$(positive_int_or_default "$(env_value API_WORKERS)" 2)"
  conversion_workers="$(positive_int_or_default "$(env_value CONVERSION_WORKER_CONCURRENCY)" 1)"
  db_connections="$(positive_int_or_default "$(env_value DB_CONNECTION_LIMIT)" 5)"

  api_memory_mb="$(parse_size_mb "${api_memory_limit:-2G}" || true)"
  postgres_memory_mb="$(parse_size_mb "${postgres_memory_limit:-512M}" || true)"
  redis_memory_mb="$(parse_size_mb "${redis_memory_limit:-256M}" || true)"
  web_memory_mb="$(parse_size_mb "${web_memory_limit:-256M}" || true)"
  api_shm_mb="$(parse_size_mb "${api_shm_size:-1G}" || true)"
  redis_maxmemory_mb="$(parse_size_mb "${redis_maxmemory:-192mb}" || true)"

  if [ -z "$api_memory_mb" ] || [ -z "$postgres_memory_mb" ] || [ -z "$redis_memory_mb" ] || [ -z "$web_memory_mb" ] || [ -z "$api_shm_mb" ] || [ -z "$redis_maxmemory_mb" ]; then
    fail "资源配置包含无法识别的内存单位；请检查 API_MEMORY_LIMIT、POSTGRES_MEMORY_LIMIT、REDIS_MEMORY_LIMIT、WEB_MEMORY_LIMIT、API_SHM_SIZE 和 REDIS_MAXMEMORY。"
    return
  fi

  configured_total_mb=$((api_memory_mb + postgres_memory_mb + redis_memory_mb + web_memory_mb))
  max_total_mb=$((total_mb * 85 / 100))
  problems=""
  if [ "$configured_total_mb" -gt "$max_total_mb" ]; then
    problems="${problems}容器内存上限合计 ${configured_total_mb}MB 超过服务器总内存 85%(${max_total_mb}MB)；"
  fi
  if [ "$api_workers" -gt "$max_api_workers" ]; then
    problems="${problems}API_WORKERS=${api_workers} 超过 ${profile} 档建议值 ${max_api_workers}；"
  fi
  if [ "$conversion_workers" -gt "$max_conversion_workers" ]; then
    problems="${problems}CONVERSION_WORKER_CONCURRENCY=${conversion_workers} 超过 ${profile} 档建议值 ${max_conversion_workers}；"
  fi
  if [ "$db_connections" -gt "$max_db_connections" ]; then
    problems="${problems}DB_CONNECTION_LIMIT=${db_connections} 超过 ${profile} 档建议值 ${max_db_connections}；"
  fi
  if [ "$api_shm_mb" -gt "$api_memory_mb" ]; then
    problems="${problems}API_SHM_SIZE=${api_shm_mb}MB 大于 API_MEMORY_LIMIT=${api_memory_mb}MB；"
  fi
  if [ "$redis_maxmemory_mb" -gt "$redis_memory_mb" ]; then
    problems="${problems}REDIS_MAXMEMORY=${redis_maxmemory_mb}MB 大于 REDIS_MEMORY_LIMIT=${redis_memory_mb}MB；"
  fi

  if [ -n "$problems" ]; then
    fail "资源配置超过当前内存档位（${profile}，总内存 ${total_mb}MB）：${problems}请运行 scripts/tune-resources.sh 或重新执行一键部署后重建容器。"
  else
    pass "资源配置适配当前内存档位（${profile}，容器上限合计约 ${configured_total_mb}MB / 总内存 ${total_mb}MB）。"
  fi
}

check_postgres_password() {
  if ! docker container inspect 3dparthub-postgres >/dev/null 2>&1; then
    warn "PostgreSQL 容器不存在，跳过数据库登录验证。"
    return
  fi
  status="$(docker inspect --format '{{.State.Status}}' 3dparthub-postgres 2>/dev/null || true)"
  if [ "$status" != "running" ]; then
    warn "PostgreSQL 容器未运行，跳过数据库登录验证。"
    return
  fi
  if compose_cmd exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select 1" >/dev/null' >/dev/null 2>&1; then
    pass "PostgreSQL 当前密码可登录。"
  else
    fail "PostgreSQL 当前密码不可登录；如果改过 .env 的 DB_PASSWORD，已有 pgdata 卷不会自动改库内密码。"
  fi
}

check_prisma_migration_status() {
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过数据库迁移状态检查。"
    return
  fi
  status="$(docker inspect --format '{{.State.Status}}' 3dparthub-api 2>/dev/null || true)"
  if [ "$status" != "running" ]; then
    warn "API 容器未运行，跳过数据库迁移状态检查。"
    return
  fi

  migration_output="$(
    compose_cmd exec -T api sh -c '
      set -eu
      schema="prisma/schema.prisma"
      if [ ! -f "$schema" ]; then
        echo "Prisma schema missing: $schema"
        exit 2
      fi
      if [ -x ./node_modules/.bin/prisma ]; then
        ./node_modules/.bin/prisma migrate status --schema "$schema"
      else
        npx --no-install prisma migrate status --schema "$schema"
      fi
    ' 2>&1
  )"
  migration_status=$?
  safe_output="$(printf '%s' "$migration_output" | redact_sensitive_text)"
  if [ "$migration_status" -eq 0 ]; then
    pass "数据库迁移状态正常: Prisma migrations 与当前数据库一致。"
  else
    fail "数据库迁移状态异常: $(format_health_body "$safe_output")"
  fi
}

check_api_runtime_dirs() {
  if [ "$COMPOSE_KIND" = "" ] || [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 或 Compose 不可用，跳过 API 运行目录权限检查。"
    return
  fi
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过运行目录权限检查。"
    return
  fi
  status="$(docker inspect --format '{{.State.Status}}' 3dparthub-api 2>/dev/null || true)"
  if [ "$status" != "running" ]; then
    warn "API 容器未运行，跳过运行目录权限检查。"
    return
  fi

  runtime_output="$(
    compose_cmd exec -T api sh -c '
      for dir in /app/uploads /app/static /app/static/backups; do
        if [ ! -d "$dir" ]; then
          echo "missing:$dir"
          exit 2
        fi
        if [ ! -w "$dir" ]; then
          echo "not_writable:$dir"
          exit 3
        fi
      done
    ' 2>&1
  )"
  runtime_status=$?
  if [ "$runtime_status" -eq 0 ]; then
    pass "API 容器运行目录可写（uploads/static/backups）。"
  else
    fail "API 容器运行目录不可写或缺失：$(format_health_body "$runtime_output")"
  fi
}

check_api_data_volume_capacity() {
  if [ "$COMPOSE_KIND" = "" ] || [ "$DOCKER_READY" != "1" ]; then
    warn "Docker daemon 或 Compose 不可用，跳过 API 数据卷容量检查。"
    return
  fi
  if ! docker container inspect 3dparthub-api >/dev/null 2>&1; then
    warn "API 容器不存在，跳过数据卷容量检查。"
    return
  fi
  status="$(docker inspect --format '{{.State.Status}}' 3dparthub-api 2>/dev/null || true)"
  if [ "$status" != "running" ]; then
    warn "API 容器未运行，跳过数据卷容量检查。"
    return
  fi

  capacity_output="$(
    compose_cmd exec -T api sh -c '
      set -u
      deploy_health_data_volume_capacity=1
      for dir in /app/uploads /app/static; do
        if [ ! -d "$dir" ]; then
          echo "fail:${dir}:missing"
          continue
        fi
        disk_line="$(df -Pm "$dir" 2>/dev/null | awk "NR==2 {gsub(/%/, \"\", \$5); print \$4 \"|\" \$5 \"|\" \$6}")"
        disk_free="$(printf "%s" "$disk_line" | cut -d "|" -f 1)"
        disk_used="$(printf "%s" "$disk_line" | cut -d "|" -f 2)"
        disk_mount="$(printf "%s" "$disk_line" | cut -d "|" -f 3)"
        case "$disk_free" in
          ""|*[!0-9]*)
            echo "fail:${dir}:disk_unreadable"
            ;;
          *)
            if [ "$disk_free" -lt 1024 ]; then
              echo "fail:${dir}:disk_free_${disk_free}MB_used_${disk_used}%_mount_${disk_mount}"
            elif [ "$disk_free" -lt 5120 ]; then
              echo "warn:${dir}:disk_free_${disk_free}MB_used_${disk_used}%_mount_${disk_mount}"
            else
              echo "ok:${dir}:disk_free_${disk_free}MB_used_${disk_used}%_mount_${disk_mount}"
            fi
            ;;
        esac

        inode_line="$(df -Pi "$dir" 2>/dev/null | awk "NR==2 {gsub(/%/, \"\", \$5); print \$4 \"|\" \$5 \"|\" \$6}")"
        inode_free="$(printf "%s" "$inode_line" | cut -d "|" -f 1)"
        inode_used="$(printf "%s" "$inode_line" | cut -d "|" -f 2)"
        inode_mount="$(printf "%s" "$inode_line" | cut -d "|" -f 3)"
        case "$inode_free" in
          ""|*[!0-9]*)
            echo "fail:${dir}:inode_unreadable"
            ;;
          *)
            if [ "$inode_free" -lt 10000 ] || [ "${inode_used:-0}" -ge 98 ] 2>/dev/null; then
              echo "fail:${dir}:inode_free_${inode_free}_used_${inode_used}%_mount_${inode_mount}"
            elif [ "$inode_free" -lt 50000 ] || [ "${inode_used:-0}" -ge 95 ] 2>/dev/null; then
              echo "warn:${dir}:inode_free_${inode_free}_used_${inode_used}%_mount_${inode_mount}"
            else
              echo "ok:${dir}:inode_free_${inode_free}_used_${inode_used}%_mount_${inode_mount}"
            fi
            ;;
        esac
      done
    ' 2>&1
  )"
  capacity_status=$?
  safe_output="$(printf '%s' "$capacity_output" | redact_sensitive_text)"
  if [ "$capacity_status" -ne 0 ] || [ -z "$safe_output" ]; then
    fail "API 数据卷容量检查失败: $(format_health_body "$safe_output")"
  elif printf '%s\n' "$safe_output" | grep -q '^fail:'; then
    fail "API 数据卷容量不足: $(format_health_body "$safe_output")"
  elif printf '%s\n' "$safe_output" | grep -q '^warn:'; then
    warn "API 数据卷容量偏低: $(format_health_body "$safe_output")"
  else
    pass "API 数据卷容量正常: uploads/static 磁盘和 inode 充足。"
  fi
}

check_backup_restore_drill_evidence() {
  backup_dir="$1"
  drill_file="${backup_dir%/}/.restore-drills/latest.json"
  if [ ! -f "$drill_file" ]; then
    warn "备份恢复演练证据缺失: 未找到 ${drill_file}；最终生产闭环前请在维护窗口执行 docker compose exec api npm run backup:e2e。"
    return
  fi

  status="$(json_string_field status "$drill_file")"
  checked_at="$(json_string_field checkedAt "$drill_file")"
  restored_from="$(json_string_field restoredFromBackupId "$drill_file")"
  if [ "$status" != "passed" ]; then
    warn "备份恢复演练证据异常: status=${status:-unknown}；请重新执行 docker compose exec api npm run backup:e2e 后再采集证据。"
    return
  fi
  if [ -z "$checked_at" ]; then
    warn "备份恢复演练证据缺少 checkedAt；请重新执行 docker compose exec api npm run backup:e2e 后再采集证据。"
    return
  fi

  checked_epoch="$(iso_timestamp_to_epoch "$checked_at" || true)"
  now_epoch="$(date -u '+%s' 2>/dev/null || true)"
  if [ -z "$checked_epoch" ] || [ -z "$now_epoch" ]; then
    warn "备份恢复演练时间无法验证: checkedAt=${checked_at}；请重新执行恢复演练或确认服务器时间。"
    return
  fi
  age_seconds=$((now_epoch - checked_epoch))
  if [ "$age_seconds" -lt 0 ]; then
    warn "备份恢复演练时间晚于当前服务器时间: checkedAt=${checked_at}；请确认服务器时间后重新采集证据。"
    return
  fi
  max_age_seconds=$((30 * 24 * 60 * 60))
  if [ "$age_seconds" -gt "$max_age_seconds" ]; then
    warn "备份恢复演练证据已超过 30 天: checkedAt=${checked_at}；建议重新执行 docker compose exec api npm run backup:e2e。"
    return
  fi

  pass "备份恢复演练证据正常: status=passed, checkedAt=${checked_at}, restoredFromBackupId=${restored_from:-unknown}。"
}

scan_api_logs() {
  if [ "$CHECK_LOGS" != "1" ]; then
    warn "已按参数跳过 API 日志扫描。"
    return
  fi
  log_file="$(make_temp_file || true)"
  if [ -z "$log_file" ]; then
    warn "无法创建临时日志文件，跳过 API 日志扫描。"
    return
  fi
  if ! compose_cmd logs --tail=180 api >"$log_file" 2>/dev/null; then
    warn "无法读取 API 日志。"
    return
  fi
  if grep -Eiq 'PrismaClientInitializationError|password authentication failed|P1000|P1001|ECONNREFUSED|EADDRINUSE|Cannot find module|permission denied|No such file or directory|FATAL|uncaught|Unhandled' "$log_file"; then
    fail "API 最近日志包含常见启动错误，请查看下面日志关键片段。"
    log_snippet="$(grep -Ein 'PrismaClientInitializationError|password authentication failed|P1000|P1001|ECONNREFUSED|EADDRINUSE|Cannot find module|permission denied|No such file or directory|FATAL|uncaught|Unhandled' "$log_file" | tail -n 12 | redact_sensitive_text)"
    printf '%s\n' "$log_snippet"
    if [ -n "$REPORT_FILE" ]; then
      printf '%s\n' "$log_snippet" >> "$REPORT_FILE"
    fi
  elif grep -Eiq 'Security warning|insecure default|must be explicitly set' "$log_file"; then
    warn "API 日志包含生产安全警告，建议补齐随机密钥和访问来源。"
  else
    pass "API 最近日志未发现常见启动错误。"
  fi

  if [ "$SHOW_LOGS" = "1" ]; then
    print_line ""
    print_line "API 最近日志:"
    recent_logs="$(tail -n 80 "$log_file" | redact_sensitive_text)"
    printf '%s\n' "$recent_logs"
    if [ -n "$REPORT_FILE" ]; then
      printf '%s\n' "$recent_logs" >> "$REPORT_FILE"
    fi
  fi
}

scan_web_logs() {
  if [ "$CHECK_LOGS" != "1" ]; then
    warn "已按参数跳过 Web 日志扫描。"
    return
  fi
  log_file="$(make_temp_file || true)"
  if [ -z "$log_file" ]; then
    warn "无法创建临时日志文件，跳过 Web 日志扫描。"
    return
  fi
  if ! compose_cmd logs --tail=180 web >"$log_file" 2>/dev/null; then
    warn "无法读取 Web 日志。"
    return
  fi
  if grep -Eiq '\[(emerg|alert|crit|error)\]|host not found in upstream|permission denied|No such file or directory|directory index of .* is forbidden|open\(\) .* failed|rewrite or internal redirection cycle|connect\(\) failed|upstream timed out|Cannot find module|FATAL|uncaught|Unhandled' "$log_file"; then
    fail "Web 最近日志包含常见入口错误，请查看下面日志关键片段。"
    log_snippet="$(grep -Ein '\[(emerg|alert|crit|error)\]|host not found in upstream|permission denied|No such file or directory|directory index of .* is forbidden|open\(\) .* failed|rewrite or internal redirection cycle|connect\(\) failed|upstream timed out|Cannot find module|FATAL|uncaught|Unhandled' "$log_file" | tail -n 12 | redact_sensitive_text)"
    printf '%s\n' "$log_snippet"
    if [ -n "$REPORT_FILE" ]; then
      printf '%s\n' "$log_snippet" >> "$REPORT_FILE"
    fi
  else
    pass "Web 最近日志未发现常见错误。"
  fi

  if [ "$SHOW_LOGS" = "1" ]; then
    print_line ""
    print_line "Web 最近日志:"
    recent_logs="$(tail -n 80 "$log_file" | redact_sensitive_text)"
    printf '%s\n' "$recent_logs"
    if [ -n "$REPORT_FILE" ]; then
      printf '%s\n' "$recent_logs" >> "$REPORT_FILE"
    fi
  fi
}

init_report

print_line "=============================="
print_line "  3DPartHub Docker 部署自检"
print_line "=============================="
print_line "生成时间: $(current_time)"
print_line "主机: $(host_name)"
print_line "系统: $(system_info)"
print_line "目录: $(pwd)"
print_line "Compose: $COMPOSE_FILE"
print_line "环境文件: $ENV_FILE"
if [ -n "$EVIDENCE_BUNDLE_ID" ]; then
  print_line "证据批次: $EVIDENCE_BUNDLE_ID"
fi
if [ -n "$REPORT_FILE" ]; then
  print_line "报告文件: $REPORT_FILE"
fi
if [ -n "$JSON_FILE" ]; then
  print_line "JSON报告: $JSON_FILE"
fi

section "基础环境"
if command_exists docker; then
  pass "$(docker --version 2>/dev/null || echo Docker 已安装)"
else
  fail "未找到 docker 命令。"
fi

if detect_compose; then
  pass "$($(compose_display) version 2>/dev/null | head -n 1)"
else
  fail "未找到 Docker Compose v2（docker compose 或 docker-compose v2）。"
fi

if command_exists docker && docker info >/dev/null 2>&1; then
  DOCKER_READY=1
  pass "Docker daemon 可访问。"
else
  DOCKER_READY=0
  fail "Docker daemon 不可访问；请确认 Docker 服务已启动，当前用户有权限。"
fi

if [ -f "$COMPOSE_FILE" ]; then
  pass "Compose 文件存在。"
else
  fail "Compose 文件不存在: $COMPOSE_FILE"
fi

if [ -f "$ENV_FILE" ]; then
  pass "$ENV_FILE 存在。"
  check_env_file_permissions
else
  warn "$ENV_FILE 不存在，生产部署会使用 Compose 默认值。"
fi

section "Compose 配置"
if [ "$COMPOSE_KIND" != "" ] && [ -f "$COMPOSE_FILE" ]; then
  check_compose_duplicate_service_keys "$COMPOSE_FILE"
  if compose_cmd config --quiet >/dev/null 2>&1; then
    pass "Compose 配置语法有效。"
    compose_config_file="$(make_temp_file || true)"
    if [ -n "$compose_config_file" ] && compose_cmd config > "$compose_config_file" 2>/dev/null; then
      :
    else
      compose_config_file=""
      warn "无法读取规范化 Compose 配置，跳过服务策略检查。"
    fi
  else
    fail "Compose 配置解析失败，请运行: $(compose_display) -f $COMPOSE_FILE config"
  fi

  services="$(compose_cmd config --services 2>/dev/null || true)"
  for service in api web postgres redis; do
    if printf '%s\n' "$services" | grep -qx "$service"; then
      pass "服务已声明: $service"
      if [ -n "${compose_config_file:-}" ]; then
        if compose_service_has_key "$compose_config_file" "$service" "healthcheck"; then
          pass "Compose 服务 $service 已声明 healthcheck。"
        else
          warn "Compose 服务 $service 未声明 healthcheck，生产验收会拒绝缺少健康探针的部署。"
        fi
        if compose_service_key_contains "$compose_config_file" "$service" "restart" "unless-stopped"; then
          pass "Compose 服务 $service 已设置 restart: unless-stopped。"
        else
          warn "Compose 服务 $service 未设置 restart: unless-stopped，宿主机或 Docker 重启后可能无法自动恢复。"
        fi
      fi
    else
      fail "Compose 缺少服务: $service"
    fi
  done
  if [ -n "${compose_config_file:-}" ]; then
    check_compose_persistent_mount "$compose_config_file" api "uploads-data" "/app/uploads" "api uploads-data -> /app/uploads"
    check_compose_persistent_mount "$compose_config_file" api "static-data" "/app/static" "api static-data -> /app/static"
    check_compose_persistent_mount "$compose_config_file" api "server/static/backups" "/app/static/backups" "api ./server/static/backups -> /app/static/backups"
    check_compose_persistent_mount "$compose_config_file" web "static-data" "/app/static" "web static-data -> /app/static"
    check_compose_persistent_mount "$compose_config_file" web "uploads-data" "/app/uploads" "web uploads-data -> /app/uploads"
    check_compose_persistent_mount "$compose_config_file" postgres "pgdata" "/var/lib/postgresql/data" "postgres pgdata -> /var/lib/postgresql/data"
    check_compose_persistent_mount "$compose_config_file" redis "redis-data" "/data" "redis redis-data -> /data"
    check_compose_api_environment "$compose_config_file"
    check_compose_image_sources "$compose_config_file"
    check_compose_redis_healthcheck_auth "$compose_config_file"
    check_compose_web_port_mapping "$compose_config_file" "$(get_port)"
    check_compose_private_service_ports "$compose_config_file"
    check_compose_logging_rotation "$compose_config_file"
    check_compose_resource_controls "$compose_config_file"
    check_compose_api_stop_grace_period "$compose_config_file"
    check_compose_internal_network "$compose_config_file"
  fi
fi

section "生产密钥"
check_secret DB_PASSWORD 16 "数据库密码 DB_PASSWORD"
check_secret REDIS_PASSWORD 16 "Redis 密码 REDIS_PASSWORD"
check_secret JWT_SECRET 32 "JWT_SECRET"
check_secret BACKUP_SIGNING_SECRET 32 "备份签名密钥 BACKUP_SIGNING_SECRET"
check_secret BACKUP_ENCRYPTION_SECRET 32 "备份加密密钥 BACKUP_ENCRYPTION_SECRET"
admin_pass="$(env_value ADMIN_PASS)"
if [ -z "$admin_pass" ]; then
  warn "ADMIN_PASS 未设置；空数据库首次启动会使用 Compose 默认管理员密码。"
elif is_weak_value "$admin_pass"; then
  warn "ADMIN_PASS 使用默认值；首次登录后请立即修改管理员密码。"
else
  pass "ADMIN_PASS 已设置。"
fi

allowed_origins="$(env_value ALLOWED_ORIGINS)"
if [ -z "$allowed_origins" ]; then
  pass "ALLOWED_ORIGINS 留空，同源反代部署可用。"
elif printf '%s' "$allowed_origins" | grep -Eq 'localhost|\*'; then
  warn "ALLOWED_ORIGINS 包含 localhost 或通配符，生产环境建议改为真实域名/IP。"
else
  pass "ALLOWED_ORIGINS 已设置为生产来源。"
fi

section "容器状态"
if [ "$DOCKER_READY" = "1" ]; then
  for container in 3dparthub-postgres 3dparthub-redis 3dparthub-api 3dparthub-web; do
    state="$(container_state "$container")"
    status="$(printf '%s' "$state" | cut -d '|' -f 1)"
    health="$(printf '%s' "$state" | cut -d '|' -f 2)"
    exit_code="$(printf '%s' "$state" | cut -d '|' -f 3)"
    oom="$(printf '%s' "$state" | cut -d '|' -f 4)"
    restart_count="$(printf '%s' "$state" | cut -d '|' -f 5)"
    image="$(container_image "$container")"
    if [ "$status" = "missing" ]; then
      fail "$container 不存在。"
    elif [ "$status" != "running" ]; then
      fail "${container} 状态为 ${status}（image=${image}, exit=${exit_code}, oom=${oom}, restartCount=${restart_count}）。"
    elif [ "$health" = "healthy" ]; then
      pass "${container} 正在运行（image=${image}, health=${health}）。"
    elif [ "$health" = "none" ]; then
      warn "${container} 正在运行但未配置 healthcheck（image=${image}）。"
    else
      fail "${container} 正在运行但健康状态为 ${health}（image=${image}）。"
    fi
    if [ "$status" = "running" ]; then
      if [ "$oom" = "true" ]; then
        warn "${container} 最近发生过 OOMKilled（image=${image}），请检查内存上限和服务器可用内存。"
      fi
      case "$restart_count" in
        ""|*[!0-9]*)
          ;;
        *)
          if [ "$restart_count" -ge 3 ]; then
            warn "${container} 重启次数较高（restartCount=${restart_count}, image=${image}），请检查日志和资源限制。"
          fi
          ;;
      esac
    fi
  done
  check_runtime_image_tag
  check_runtime_image_sources
  check_runtime_container_mounts
  check_runtime_container_logging
  check_runtime_container_restart_policy
  check_runtime_api_stop_timeout
  check_runtime_container_resource_limits
  check_runtime_env_consistency
  check_api_process_user
else
  warn "Docker daemon 不可访问，跳过容器状态细查。"
fi

section "数据库与缓存"
if [ "$COMPOSE_KIND" != "" ] && [ "$DOCKER_READY" = "1" ]; then
  check_postgres_password
  check_prisma_migration_status
  if docker container inspect 3dparthub-redis >/dev/null 2>&1 && [ "$(docker inspect --format '{{.State.Status}}' 3dparthub-redis 2>/dev/null || true)" = "running" ]; then
    redis_password="$(env_value REDIS_PASSWORD)"
    redis_password="${redis_password:-changeme-set-in-env}"
    if compose_cmd exec -T redis sh -c 'REDISCLI_AUTH="$1" redis-cli ping' sh "$redis_password" 2>/dev/null | grep -q PONG; then
      pass "Redis 密码可用，PING 正常。"
    else
      fail "Redis PING 失败；请检查 REDIS_PASSWORD 与容器配置。"
    fi
  else
    warn "Redis 容器未运行，跳过 PING。"
  fi
else
  warn "Docker daemon 或 Compose 不可用，跳过数据库与缓存连通性验证。"
fi

section "网络访问"
PORT_VALUE="$(get_port)"
if [ -z "$HEALTH_URL" ]; then
  HEALTH_URL="http://127.0.0.1:${PORT_VALUE}/api/health"
fi
check_port_listener "$PORT_VALUE"
if [ "$DOCKER_READY" = "1" ]; then
  check_web_port_binding "$PORT_VALUE"
  check_runtime_private_port_bindings
else
  warn "Docker daemon 不可访问，跳过 Web 容器端口映射检查。"
fi

if ! has_http_client; then
  fail "未找到 curl 或 wget，无法请求健康接口: $HEALTH_URL"
else
  health_body="$(http_get "$HEALTH_URL" || true)"
  if [ -n "$health_body" ] && printf '%s' "$health_body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"|ok'; then
    pass "健康接口正常: $HEALTH_URL"
    check_security_headers "$HEALTH_URL" "API 安全响应头" "api"
  else
    fail "健康接口失败: $HEALTH_URL $(format_health_body "$health_body")"
  fi

  ready_url="$(printf '%s' "$HEALTH_URL" | sed 's#/api/health.*#/api/health/ready#')"
  ready_body="$(http_get "$ready_url" || true)"
  if [ -n "$ready_body" ] && printf '%s' "$ready_body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"|ready'; then
    pass "就绪接口正常: $ready_url"
  else
    warn "就绪接口未返回 ready: $ready_url $(format_health_body "$ready_body")"
  fi

  live_url="$(printf '%s' "$HEALTH_URL" | sed 's#/api/health.*#/api/health/live#')"
  live_body="$(http_get "$live_url" || true)"
  if [ -n "$live_body" ] && printf '%s' "$live_body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"alive"|alive'; then
    pass "存活接口正常: $live_url"
  else
    fail "存活接口失败: $live_url $(format_health_body "$live_body")"
  fi

  web_health_url="$(printf '%s' "$HEALTH_URL" | sed 's#/api/health.*#/healthz#')"
  if http_get "$web_health_url" >/dev/null 2>&1; then
    pass "Web healthz 正常: $web_health_url"
  else
    warn "Web healthz 未通过: $web_health_url"
  fi

  web_home_url="$(printf '%s' "$HEALTH_URL" | sed 's#/api/health.*#/#')"
  web_origin="$(printf '%s' "$web_home_url" | sed 's#^\(https\{0,1\}://[^/]*\).*#\1#')"
  check_admin_health_endpoint_access_control "$web_origin"
  check_runtime_version_endpoint "$web_origin"
  web_home_body="$(http_get "$web_home_url" || true)"
  if [ -n "$web_home_body" ] && printf '%s' "$web_home_body" | grep -Eiq '<html|id="root"|id='\''root'\''|/assets/|3DPartHub'; then
    pass "Web 首页入口正常: $web_home_url"
    check_security_headers "$web_home_url" "Web 首页安全响应头" "web"
    check_sensitive_web_paths "$web_origin"
    web_asset_path="$(first_frontend_asset_path "$web_home_body")"
    if [ -z "$web_asset_path" ]; then
      fail "Web 首页未发现前端静态资源引用；请确认 web 镜像内的前端构建产物完整。"
    else
      web_asset_url="${web_origin}${web_asset_path}"
      if http_probe "$web_asset_url"; then
        pass "Web 前端静态资源正常: $web_asset_url"
      else
        fail "Web 前端静态资源失败: $web_asset_url"
      fi
    fi
  else
    fail "Web 首页入口失败: $web_home_url $(format_health_body "$web_home_body")"
  fi
fi

section "资源与目录"
check_disk "." "部署目录磁盘"
check_inodes "." "部署目录"
check_memory
check_resource_budget
check_docker_data_root
if [ -d "./server/static/backups" ]; then
  pass "宿主机备份目录存在: ./server/static/backups"
  check_writable_directory "./server/static/backups" "宿主机备份目录"
  check_disk "./server/static/backups" "备份目录磁盘"
  check_inodes "./server/static/backups" "备份目录"
  check_backup_restore_drill_evidence "./server/static/backups"
else
  warn "宿主机备份目录不存在: ./server/static/backups；首次备份前请确认 Compose 挂载目录。"
fi
check_api_runtime_dirs
check_api_data_volume_capacity

if [ "$DOCKER_READY" = "1" ] && docker system df >/dev/null 2>&1; then
  pass "Docker 存储可读取。"
fi

section "应用日志"
if [ "$COMPOSE_KIND" != "" ]; then
  scan_api_logs
  scan_web_logs
else
  warn "Compose 不可用，跳过应用日志扫描。"
fi

section "结论"
print_line "通过: ${PASSES}，警告: ${WARNINGS}，失败: ${FAILURES}"
if [ "$FAILURES" -gt 0 ]; then
  print_status_line "$RED" "部署自检未通过。优先处理失败项，再执行: $(compose_display) ps && $(compose_display) logs --tail=160 api"
  write_json_report "failed"
  exit 1
fi
if [ "$STRICT" = "1" ] && [ "$WARNINGS" -gt 0 ]; then
  print_status_line "$YELLOW" "严格模式下存在警告，自检返回失败。"
  write_json_report "strict_failed"
  exit 1
fi
if [ "$WARNINGS" -gt 0 ]; then
  print_status_line "$YELLOW" "部署可用，但建议处理警告项以降低生产风险。"
  write_json_report "warning"
else
  print_status_line "$GREEN" "部署自检通过。"
  write_json_report "passed"
fi
