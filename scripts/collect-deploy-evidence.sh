#!/bin/sh
set -u

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
PORT_OVERRIDE="${PORT:-}"
HEALTH_URL="${HEALTH_URL:-}"
OUTPUT_DIR="${OUTPUT_DIR:-}"
STRICT="${STRICT:-0}"
MAKE_ARCHIVE="${MAKE_ARCHIVE:-1}"
BUNDLE_ID="${EVIDENCE_BUNDLE_ID:-}"
DEPLOY_CHECK_URL="${DEPLOY_CHECK_URL:-https://raw.githubusercontent.com/liaoweixiang2024-blip/3DPartHub/main/scripts/deploy-health-check.sh}"

usage() {
  cat <<'EOF'
3DPartHub 生产部署证据采集

用法:
  sh scripts/collect-deploy-evidence.sh
  sh scripts/collect-deploy-evidence.sh --output-dir deploy-evidence

参数:
  --compose-file FILE   指定 Compose 文件，默认 docker-compose.yml
  --env-file FILE       指定环境变量文件，默认 .env
  --port PORT           指定 Web 对外端口
  --url URL             指定完整健康检查地址
  --output-dir DIR      指定证据输出目录
  --strict              自检存在警告也返回失败
  --no-archive          不生成 tar.gz 证据包
  -h, --help            显示帮助

说明:
  该脚本不重启服务、不修改配置，也不会打包 .env；除备份目录写入并删除一个隐藏探针文件外，只读取运行状态。
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
    --output-dir)
      shift
      OUTPUT_DIR="${1:-$OUTPUT_DIR}"
      ;;
    --strict)
      STRICT=1
      ;;
    --no-archive)
      MAKE_ARCHIVE=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

timestamp() {
  if command_exists date; then
    date '+%Y%m%d-%H%M%S' 2>/dev/null || date '+%s' 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

script_dir() {
  dir="$(dirname "$0")"
  (cd "$dir" 2>/dev/null && pwd) || printf '%s' "$dir"
}

compose_cmd() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    if [ -f "$ENV_FILE" ]; then
      docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      docker compose -f "$COMPOSE_FILE" "$@"
    fi
    return $?
  fi
  if command_exists docker-compose; then
    compose_version="$(docker-compose version 2>/dev/null | head -n 1 || true)"
    if ! printf '%s\n' "$compose_version" | grep -Eq 'version v?2\.'; then
      return 127
    fi
    if [ -f "$ENV_FILE" ]; then
      docker-compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
    else
      docker-compose -f "$COMPOSE_FILE" "$@"
    fi
    return $?
  fi
  return 127
}

write_command_output() {
  label="$1"
  file="$2"
  shift 2
  {
    printf '== %s ==\n' "$label"
    printf '$'
    printf ' %s' "$@"
    printf '\n\n'
    "$@"
  } 2>&1 | redact_sensitive_text >"$file" || true
}

write_unavailable_output() {
  label="$1"
  file="$2"
  message="$3"
  {
    printf '== %s ==\n' "$label"
    printf '%s\n' "$message"
  } >"$file" 2>&1 || true
}

write_host_resources() {
  file="$OUTPUT_DIR/host-resources.txt"
  {
    printf '== host resources ==\n'
    printf 'Generated at: %s\n' "$(date 2>/dev/null || printf 'unknown')"
    printf 'Directory: %s\n' "$(pwd)"

    printf '\n== uname ==\n'
    uname -a 2>/dev/null || printf 'unavailable\n'

    printf '\n== uptime ==\n'
    if command_exists uptime; then
      uptime 2>/dev/null || printf 'unavailable\n'
    else
      printf 'unavailable\n'
    fi

    printf '\n== memory ==\n'
    if command_exists free; then
      free -h 2>/dev/null || free -m 2>/dev/null || printf 'unavailable\n'
    elif [ -r /proc/meminfo ]; then
      cat /proc/meminfo 2>/dev/null || printf 'unavailable\n'
    else
      printf 'unavailable\n'
    fi

    printf '\n== disk ==\n'
    if command_exists df; then
      df -h . ./server/static/backups 2>/dev/null || df -h . 2>/dev/null || printf 'unavailable\n'
    else
      printf 'unavailable\n'
    fi

    printf '\n== inodes ==\n'
    if command_exists df; then
      df -ih . ./server/static/backups 2>/dev/null || df -ih . 2>/dev/null || printf 'unavailable\n'
    else
      printf 'unavailable\n'
    fi

    printf '\n== docker stats ==\n'
    if command_exists docker; then
      docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' 2>/dev/null || printf 'docker stats unavailable\n'
    else
      printf 'docker command not available\n'
    fi
  } 2>&1 | redact_sensitive_text >"$file" || true
}

write_network_listeners() {
  file="$OUTPUT_DIR/network-listeners.txt"
  port="$PORT_OVERRIDE"
  if [ -z "$port" ]; then
    port="$(env_value PORT || true)"
  fi
  if [ -z "$port" ]; then
    port="3780"
  fi
  {
    printf '== network listeners ==\n'
    printf 'Generated at: %s\n' "$(date 2>/dev/null || printf 'unknown')"
    printf 'Port: %s\n' "$port"
    if [ -n "$HEALTH_URL" ]; then
      printf 'Health URL: %s\n' "$HEALTH_URL"
    else
      printf 'Health URL: http://127.0.0.1:%s/api/health\n' "$port"
    fi

    printf '\n== listeners on port %s ==\n' "$port"
    if command_exists ss; then
      listeners="$(ss -ltnp 2>/dev/null || true)"
      printf '%s\n' "$listeners" | grep -E "[:.]${port}[[:space:]]" 2>/dev/null || printf 'no listener found for port %s\n' "$port"
      printf '\n== all tcp listeners ==\n'
      printf '%s\n' "$listeners" | sed -n '1,120p'
    elif command_exists lsof; then
      listeners="$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true)"
      printf '%s\n' "$listeners" | grep -F ":${port}" 2>/dev/null || printf 'no listener found for port %s\n' "$port"
      printf '\n== all tcp listeners ==\n'
      printf '%s\n' "$listeners" | sed -n '1,120p'
    else
      printf 'ss and lsof are unavailable\n'
    fi
  } 2>&1 | redact_sensitive_text >"$file" || true
}

json_string_field() {
  key="$1"
  file="$2"
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" 2>/dev/null | sed -n '1p'
}

json_value_present() {
  key="$1"
  file="$2"
  if grep -Eq "\"$key\"[[:space:]]*:" "$file" 2>/dev/null; then
    printf 'present'
  else
    printf 'missing'
  fi
}

list_backup_files() {
  dir="$1"
  pattern="$2"
  if command_exists find && command_exists ls; then
    find "$dir" -maxdepth 1 -type f -name "$pattern" -exec ls -dt {} + 2>/dev/null | sed -n '1,10p'
    return
  fi
  for candidate in "$dir"/$pattern; do
    [ -f "$candidate" ] || continue
    printf '%s\n' "$candidate"
  done | sort -r | sed -n '1,10p'
}

write_backup_inventory() {
  file="$OUTPUT_DIR/backup-inventory.txt"
  backup_dir="./server/static/backups"
  {
    printf '== backup inventory ==\n'
    printf 'Generated at: %s\n' "$(date 2>/dev/null || printf 'unknown')"
    printf 'Backup dir: %s\n' "$backup_dir"
    printf 'Restore drill: not executed by evidence collector\n'
    drill_file="$backup_dir/.restore-drills/latest.json"
    if [ -f "$drill_file" ]; then
      drill_status="$(json_string_field status "$drill_file")"
      drill_checked_at="$(json_string_field checkedAt "$drill_file")"
      drill_created="$(json_string_field createdBackupId "$drill_file")"
      drill_imported="$(json_string_field importedBackupId "$drill_file")"
      drill_restored="$(json_string_field restoredFromBackupId "$drill_file")"
      printf 'Restore drill evidence: status=%s checkedAt=%s createdBackupId=%s importedBackupId=%s restoredFromBackupId=%s\n' \
        "${drill_status:-unknown}" \
        "${drill_checked_at:-unknown}" \
        "${drill_created:-unknown}" \
        "${drill_imported:-unknown}" \
        "${drill_restored:-unknown}"
    else
      printf 'Restore drill evidence: missing\n'
    fi

    if [ ! -d "$backup_dir" ]; then
      printf '\n== backup directory summary ==\n'
      printf 'directoryExists=no\n'
      printf 'reason=backup directory is missing\n'
      printf '\n== recent backup records ==\n'
      printf 'none\n'
      return
    fi

    printf '\n== backup directory summary ==\n'
    printf 'directoryExists=yes\n'
    if command_exists find; then
      printf 'topLevelFiles=%s\n' "$(find "$backup_dir" -maxdepth 1 -type f 2>/dev/null | wc -l | awk '{print $1}')"
      printf 'archives=%s\n' "$(find "$backup_dir" -maxdepth 1 -type f -name '*.tar.gz' 2>/dev/null | wc -l | awk '{print $1}')"
      printf 'metadata=%s\n' "$(find "$backup_dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | awk '{print $1}')"
      printf 'workDirs=%s\n' "$(find "$backup_dir/.work" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | awk '{print $1}')"
      printf 'safetySnapshots=%s\n' "$(find "$backup_dir/_safety_snapshots" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | awk '{print $1}')"
    else
      printf 'find=unavailable\n'
    fi

    printf '\n== recent backup records ==\n'
    record_list="$(list_backup_files "$backup_dir" '*.json')"
    if [ -n "$record_list" ]; then
      printf '%s\n' "$record_list" | while IFS= read -r meta; do
        [ -f "$meta" ] || continue
        id="$(basename "$meta" .json)"
        archive="$backup_dir/$id.tar.gz"
        name="$(json_string_field name "$meta")"
        scope="$(json_string_field scopeLabel "$meta")"
        if [ -z "$scope" ]; then
          scope="$(json_string_field scope "$meta")"
        fi
        created_at="$(json_string_field createdAt "$meta")"
        manifest_version="$(json_string_field manifestVersion "$meta")"
        verified_at="$(json_string_field verifiedAt "$meta")"
        archive_state="missing"
        archive_size="0"
        if [ -f "$archive" ]; then
          archive_state="present"
          archive_size="$(file_size "$archive" 2>/dev/null || printf '0')"
        fi
        printf 'record id=%s archive=%s archiveSize=%s metadata=%s name="%s" scope="%s" createdAt=%s manifestVersion=%s archiveSha256=%s archiveSignature=%s encrypted=%s verifiedAt=%s\n' \
          "$id" \
          "$archive_state" \
          "$archive_size" \
          "$(basename "$meta")" \
          "${name:-unknown}" \
          "${scope:-unknown}" \
          "${created_at:-unknown}" \
          "${manifest_version:-missing}" \
          "$(json_value_present archiveSha256 "$meta")" \
          "$(json_value_present archiveSignature "$meta")" \
          "$(json_string_field encrypted "$meta")" \
          "${verified_at:-missing}"
      done
    else
      printf 'none\n'
    fi

    printf '\n== orphan backup archives ==\n'
    orphan_list="$(list_backup_files "$backup_dir" '*.tar.gz')"
    orphan_output="$(
      if [ -n "$orphan_list" ]; then
        printf '%s\n' "$orphan_list" | while IFS= read -r archive; do
          [ -f "$archive" ] || continue
          id="$(basename "$archive" .tar.gz)"
          [ ! -f "$backup_dir/$id.json" ] || continue
          printf 'archive=%s metadata=missing size=%s\n' "$(basename "$archive")" "$(file_size "$archive" 2>/dev/null || printf '0')"
        done
      fi
    )"
    if [ -n "$orphan_output" ]; then
      printf '%s\n' "$orphan_output"
    else
      printf 'none\n'
    fi

    printf '\n== backup work directories ==\n'
    if [ -d "$backup_dir/.work" ]; then
      find "$backup_dir/.work" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sed -n '1,10p' || printf 'unavailable\n'
    else
      printf 'none\n'
    fi
  } 2>&1 | redact_sensitive_text >"$file" || true
}

hash_file() {
  file="$1"
  if command_exists sha256sum; then
    sha256sum "$file" | awk '{print $1}'
    return $?
  fi
  if command_exists shasum; then
    shasum -a 256 "$file" | awk '{print $1}'
    return $?
  fi
  return 127
}

file_size() {
  wc -c < "$1" | awk '{print $1}'
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r/\\r/g'
}

redact_sensitive_text() {
  sed -E \
    -e 's#(postgresql?://[^[:space:]/:@]+:)[^@[:space:]/]+(@)#\1***\2#g' \
    -e 's#(redis://[^[:space:]/:@]*:)[^@[:space:]/]+(@)#\1***\2#g' \
    -e 's#((DB_PASSWORD|REDIS_PASSWORD|JWT_SECRET|ADMIN_PASS|BACKUP_SIGNING_SECRET|BACKUP_ENCRYPTION_SECRET|DATABASE_URL|REDIS_URL|REDISCLI_AUTH|SMTP_PASS|MINIO_SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN)[[:space:]]*[:=][[:space:]]*)[^[:space:]]+#\1[redacted]#g' \
    -e 's#(Authorization[[:space:]]*:[[:space:]]*(Bearer|Basic)[[:space:]]+)[A-Za-z0-9._~+/-]+=*#\1[redacted]#g'
}

env_value() {
  key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d '=' -f 2- | sed "s/^['\"]//;s/['\"]$//" || true
}

package_field() {
  file="$1"
  key="$2"
  if [ ! -f "$file" ]; then
    printf 'unavailable'
    return
  fi
  value="$(sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | sed -n '1p')"
  printf '%s' "${value:-unavailable}"
}

assert_safe_output_dir() {
  normalized="$(printf '%s' "$1" | sed 's#\\#/#g')"
  case "$normalized" in
    ""|"."|"/")
      echo "不安全的输出目录: $1" >&2
      echo "请使用专用证据目录，例如 deploy-evidence-YYYYMMDD-HHMMSS。" >&2
      exit 2
      ;;
    -*|*/../*|../*|*/..|..|*/.env|.env|.env/*|*/-*|*/.env/*)
      echo "不安全的输出目录: $1" >&2
      echo "目录不能包含 ..、.env 或以 - 开头的路径段。" >&2
      exit 2
      ;;
  esac
}

write_manifest() {
  manifest_file="$OUTPUT_DIR/manifest.json"
  manifest_tmp="$OUTPUT_DIR/manifest.json.tmp"
  evidence_files="deploy-health-report.json deploy-health-report.txt compose-ps.txt compose-services.txt api-logs-tail.txt web-logs-tail.txt docker-ps.txt docker-system-df.txt host-resources.txt network-listeners.txt backup-inventory.txt deployment-provenance.txt README.txt"

  if ! command_exists sha256sum && ! command_exists shasum; then
    echo "无法生成证据清单：未找到 sha256sum 或 shasum。" >&2
    exit 2
  fi

  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "generatedAt": "%s",\n' "$(json_escape "$(date 2>/dev/null || printf 'unknown')")"
    printf '  "bundleId": "%s",\n' "$(json_escape "$BUNDLE_ID")"
    printf '  "hashAlgorithm": "sha256",\n'
    printf '  "files": [\n'
    first=1
    for name in $evidence_files; do
      path="$OUTPUT_DIR/$name"
      if [ ! -s "$path" ]; then
        echo "证据文件缺失或为空，无法生成清单: $name" >&2
        exit 2
      fi
      digest="$(hash_file "$path" || true)"
      if [ -z "$digest" ]; then
        echo "无法计算证据文件哈希: $name" >&2
        exit 2
      fi
      size="$(file_size "$path")"
      if [ "$first" = "1" ]; then
        first=0
      else
        printf ',\n'
      fi
      printf '    {"path": "%s", "size": %s, "sha256": "%s"}' "$(json_escape "$name")" "$size" "$(json_escape "$digest")"
    done
    printf '\n  ]\n'
    printf '}\n'
  } > "$manifest_tmp"
  mv "$manifest_tmp" "$manifest_file"
}

write_provenance() {
  file="$OUTPUT_DIR/deployment-provenance.txt"
  {
    printf '3DPartHub deployment provenance\n\n'
    printf 'Generated at: %s\n' "$(date 2>/dev/null || printf 'unknown')"
    printf 'Evidence bundle ID: %s\n' "$BUNDLE_ID"
    printf 'Directory: %s\n' "$(pwd)"
    printf 'Compose file: %s\n' "$COMPOSE_FILE"
    printf 'Env file: %s (not included)\n' "$ENV_FILE"
    printf 'IMAGE_TAG: %s\n' "$(env_value IMAGE_TAG || true)"
    printf 'Package: %s\n' "$(package_field package.json name)"
    printf 'Client package: %s@%s\n' "$(package_field client/package.json name)" "$(package_field client/package.json version)"
    printf 'Server package: %s@%s\n' "$(package_field server/package.json name)" "$(package_field server/package.json version)"
    if command_exists git && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      printf 'Git commit: %s\n' "$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
      printf 'Git branch: %s\n' "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
      if git diff --quiet --ignore-submodules -- 2>/dev/null; then
        printf 'Git dirty: false\n'
      else
        printf 'Git dirty: true\n'
      fi
    else
      printf 'Git commit: unavailable\n'
      printf 'Git branch: unavailable\n'
      printf 'Git dirty: unavailable\n'
    fi
    printf '\nContainers:\n'
    if command_exists docker; then
      for container in 3dparthub-api 3dparthub-web 3dparthub-postgres 3dparthub-redis; do
        if docker container inspect "$container" >/dev/null 2>&1; then
          docker inspect --format '{{.Name}} image={{.Config.Image}} imageId={{.Image}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restartPolicy={{.HostConfig.RestartPolicy.Name}} restartCount={{.RestartCount}} oom={{.State.OOMKilled}}' "$container" 2>/dev/null || true
        else
          printf '%s missing\n' "$container"
        fi
      done
    else
      printf 'docker command not available\n'
    fi
  } >"$file" 2>&1 || true
}

SCRIPT_DIR="$(script_dir)"
HEALTH_SCRIPT="$SCRIPT_DIR/deploy-health-check.sh"
if [ ! -f "$HEALTH_SCRIPT" ]; then
  HEALTH_SCRIPT="./deploy-health-check.sh"
fi
if [ ! -f "$HEALTH_SCRIPT" ]; then
  if command_exists curl; then
    echo "未找到 deploy-health-check.sh，正在下载..."
    curl -fsSL -o deploy-health-check.sh "$DEPLOY_CHECK_URL" || {
      echo "无法下载 deploy-health-check.sh" >&2
      exit 2
    }
    HEALTH_SCRIPT="./deploy-health-check.sh"
  else
    echo "未找到 deploy-health-check.sh，且当前系统没有 curl。" >&2
    exit 2
  fi
fi

if [ -z "$OUTPUT_DIR" ]; then
  OUTPUT_DIR="deploy-evidence-$(timestamp)"
fi
while [ "$OUTPUT_DIR" != "/" ] && [ "${OUTPUT_DIR%/}" != "$OUTPUT_DIR" ]; do
  OUTPUT_DIR="${OUTPUT_DIR%/}"
done
assert_safe_output_dir "$OUTPUT_DIR"
if [ -d "$OUTPUT_DIR" ]; then
  if [ -L "$OUTPUT_DIR" ]; then
    echo "输出目录不能是符号链接: $OUTPUT_DIR" >&2
    exit 2
  fi
  existing_entry="$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | sed -n '1p')"
  if [ -n "$existing_entry" ]; then
    echo "输出目录已存在且不为空: $OUTPUT_DIR" >&2
    echo "请换一个 --output-dir，或先手动确认并清理旧证据目录，避免新旧报告混在一起。" >&2
    exit 2
  fi
fi
mkdir -p "$OUTPUT_DIR" || {
  echo "无法创建输出目录: $OUTPUT_DIR" >&2
  exit 2
}
if [ -z "$BUNDLE_ID" ]; then
  BUNDLE_ID="deploy-evidence-$(timestamp)"
fi

REPORT_FILE="$OUTPUT_DIR/deploy-health-report.txt"
JSON_FILE="$OUTPUT_DIR/deploy-health-report.json"

set -- --compose-file "$COMPOSE_FILE" --env-file "$ENV_FILE" --report "$REPORT_FILE" --json "$JSON_FILE" --show-logs
if [ -n "$PORT_OVERRIDE" ]; then
  set -- "$@" --port "$PORT_OVERRIDE"
fi
if [ -n "$HEALTH_URL" ]; then
  set -- "$@" --url "$HEALTH_URL"
fi
if [ "$STRICT" = "1" ]; then
  set -- "$@" --strict
fi

echo "正在生成部署健康报告..."
EVIDENCE_BUNDLE_ID="$BUNDLE_ID" sh "$HEALTH_SCRIPT" "$@"
health_status=$?

write_command_output "compose ps" "$OUTPUT_DIR/compose-ps.txt" compose_cmd ps
write_command_output "compose services" "$OUTPUT_DIR/compose-services.txt" compose_cmd config --services
write_command_output "api logs tail" "$OUTPUT_DIR/api-logs-tail.txt" compose_cmd logs --tail=160 api
write_command_output "web logs tail" "$OUTPUT_DIR/web-logs-tail.txt" compose_cmd logs --tail=160 web
if command_exists docker; then
  write_command_output "docker ps" "$OUTPUT_DIR/docker-ps.txt" docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
  write_command_output "docker system df" "$OUTPUT_DIR/docker-system-df.txt" docker system df
else
  write_unavailable_output "docker ps" "$OUTPUT_DIR/docker-ps.txt" "docker command not available"
  write_unavailable_output "docker system df" "$OUTPUT_DIR/docker-system-df.txt" "docker command not available"
fi
write_host_resources
write_network_listeners
write_backup_inventory
write_provenance

cat >"$OUTPUT_DIR/README.txt" <<EOF
3DPartHub deployment evidence bundle

Generated at: $(date 2>/dev/null || printf 'unknown')
Evidence bundle ID: $BUNDLE_ID
Directory: $(pwd)
Compose file: $COMPOSE_FILE
Env file: $ENV_FILE (not included)
Health report: deploy-health-report.txt
Structured report: deploy-health-report.json
API logs: api-logs-tail.txt
Web logs: web-logs-tail.txt
Host resources: host-resources.txt
Network listeners: network-listeners.txt
Backup inventory: backup-inventory.txt
Provenance: deployment-provenance.txt

Copy the archive and matching SHA-256 sidecar together when an archive is present:
  deploy-evidence-YYYYMMDD-HHMMSS.tar.gz
  deploy-evidence-YYYYMMDD-HHMMSS.tar.gz.sha256

Recommended production acceptance after copying evidence back to the repository:
  npm run deploy:acceptance -- path/to/deploy-evidence.tar.gz
  npm run deploy:acceptance -- path/to/deploy-evidence

Report-only fallback requires both JSON and text reports and is weaker than full evidence:
  npm run deploy:acceptance -- deploy-health-report.json --require-text deploy-health-report.txt --allow-report-only

This bundle intentionally excludes .env. Review log excerpts before sharing outside your organization.
EOF

write_manifest

archive_path=""
archive_hash_path=""
if [ "$MAKE_ARCHIVE" = "1" ]; then
  archive_path="${OUTPUT_DIR}.tar.gz"
  if command_exists tar; then
    archive_dir="$(dirname "$OUTPUT_DIR")"
    archive_base="$(basename "$OUTPUT_DIR")"
    archive_target="$archive_path"
    case "$archive_target" in
      /*)
        ;;
      *)
        archive_target="$(pwd)/$archive_target"
        ;;
    esac
    (cd "$archive_dir" 2>/dev/null && tar -czf "$archive_target" "$archive_base") >/dev/null 2>&1 || {
      echo "证据包压缩失败: $archive_path" >&2
      archive_path=""
    }
    if [ -n "$archive_path" ]; then
      archive_digest="$(hash_file "$archive_target" || true)"
      if [ -n "$archive_digest" ]; then
        archive_hash_path="${archive_path}.sha256"
        printf '%s  %s\n' "$archive_digest" "$(basename "$archive_path")" >"$archive_hash_path" || {
          echo "证据包 SHA-256 摘要写入失败: $archive_hash_path" >&2
          archive_hash_path=""
        }
      else
        echo "无法计算证据包 SHA-256 摘要: $archive_path" >&2
      fi
    fi
  else
    echo "未找到 tar，跳过证据包压缩。"
  fi
fi

echo ""
echo "证据目录: $OUTPUT_DIR"
if [ -n "$archive_path" ]; then
  echo "证据包: $archive_path"
fi
if [ -n "$archive_hash_path" ]; then
  echo "证据包SHA256: $archive_hash_path"
fi
echo "健康报告: $REPORT_FILE"
echo "JSON 报告: $JSON_FILE"

exit "$health_status"
