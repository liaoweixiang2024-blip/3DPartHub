#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/deploy-health-check.sh"
REPORT_VERIFIER="$ROOT_DIR/scripts/verify-deploy-health-report.mjs"
EVIDENCE_COLLECTOR="$ROOT_DIR/scripts/collect-deploy-evidence.sh"
ACCEPTANCE_VERIFIER="$ROOT_DIR/scripts/verify-production-deploy-evidence.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
NO_DOCKER_BIN="$TMP_DIR/no-docker-bin"
WORK_DIR="$TMP_DIR/work"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$FAKE_BIN" "$NO_DOCKER_BIN" "$WORK_DIR/server/static/backups" "$WORK_DIR/.fake-docker-root"

cat > "$FAKE_BIN/docker" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-}" = "--version" ]; then
  echo "Docker version 25.0.0, build test"
  exit 0
fi

if [ "${1:-}" = "info" ]; then
  if [ "${FAKE_DOCKER_DOWN:-0}" = "1" ]; then
    exit 1
  fi
  if [ "${2:-}" = "--format" ]; then
    echo "${FAKE_DOCKER_ROOT_DIR:-$PWD/.fake-docker-root}"
    exit 0
  fi
  echo "Server Version: test"
  echo "Docker Root Dir: ${FAKE_DOCKER_ROOT_DIR:-$PWD/.fake-docker-root}"
  exit 0
fi

if [ "${1:-}" = "compose" ]; then
  shift
  if [ "${FAKE_DOCKER_COMPOSE_PLUGIN_MISSING:-0}" = "1" ]; then
    exit 1
  fi
  if [ "${1:-}" = "version" ]; then
    echo "Docker Compose version v2.29.0"
    exit 0
  fi
  compose_env_file=""
  while [ "$#" -gt 0 ]; do
    case "${1:-}" in
      --env-file)
        compose_env_file="${2:-}"
        shift 2
        ;;
      -f)
        shift 2
        ;;
      *)
        break
        ;;
    esac
  done
  if [ "${REQUIRE_COMPOSE_ENV_FILE:-}" != "" ] && [ "$compose_env_file" != "$REQUIRE_COMPOSE_ENV_FILE" ]; then
    echo "expected compose --env-file $REQUIRE_COMPOSE_ENV_FILE, got ${compose_env_file:-<none>}" >&2
    exit 1
  fi
  case "${1:-}" in
    config)
      if [ "${2:-}" = "--services" ]; then
        printf '%s\n' api web postgres redis
      elif [ "${2:-}" = "--quiet" ]; then
        :
      else
        printf '%s\n' 'services:'
        printf '%s\n' '  api:'
        printf '%s\n' '    image: ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest'
        printf '%s\n' '    mem_limit: 900M'
        printf '%s\n' '    cpus: "1.2"'
        printf '%s\n' '    environment:'
        printf '%s\n' '      DATABASE_URL: postgresql://modeluser:test-db-password-1234567890@postgres:5432/3dparthub'
        printf '%s\n' '      REDIS_URL: redis://:test-redis-password-1234567890@redis:6379'
        printf '%s\n' '      JWT_SECRET: test-jwt-secret-1234567890-abcdef'
        printf '%s\n' '      BACKUP_SIGNING_SECRET: test-backup-signing-secret-1234567890'
        printf '%s\n' '      BACKUP_ENCRYPTION_SECRET: test-backup-encryption-secret-1234567890'
        if [ "${FAKE_COMPOSE_API_ENV_MISSING:-0}" != "1" ]; then
          printf '%s\n' '      ALLOWED_ORIGINS: https://model.example.com'
        fi
        if [ "${FAKE_COMPOSE_PRIVATE_PORT_EXPOSED:-0}" = "1" ]; then
          printf '%s\n' '    ports:'
          printf '%s\n' '      - mode: ingress'
          printf '%s\n' '        target: 8000'
          printf '%s\n' '        published: "8000"'
          printf '%s\n' '        protocol: tcp'
        fi
        if [ "${FAKE_COMPOSE_MISSING_LOGGING:-0}" != "1" ]; then
          printf '%s\n' '    logging:'
          printf '%s\n' '      driver: json-file'
          printf '%s\n' '      options:'
          printf '%s\n' '        max-size: 50m'
          printf '%s\n' '        max-file: "5"'
        fi
        if [ "${FAKE_COMPOSE_MISSING_API_HEALTHCHECK:-0}" != "1" ]; then
          printf '%s\n' '    healthcheck:'
          printf '%s\n' '      test: ["CMD-SHELL", "curl -fsS http://localhost:8000/api/health/ready >/dev/null || exit 1"]'
        fi
        printf '%s\n' '    restart: unless-stopped'
        if [ "${FAKE_COMPOSE_API_STOP_GRACE_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    stop_grace_period: 5m0s'
        fi
        printf '%s\n' '    volumes:'
        printf '%s\n' '      - uploads-data:/app/uploads'
        printf '%s\n' '      - static-data:/app/static'
        if [ "${FAKE_COMPOSE_MISSING_BACKUP_MOUNT:-0}" != "1" ]; then
          printf '%s\n' '      - ./server/static/backups:/app/static/backups'
        fi
        if [ "${FAKE_COMPOSE_INTERNAL_NETWORK_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    networks:'
          printf '%s\n' '      internal: null'
        fi
        printf '%s\n' '  web:'
        if [ "${FAKE_COMPOSE_IMAGE_MISMATCH:-0}" = "1" ]; then
          printf '%s\n' '    image: ghcr.io/example/wrong-web:v3.1.0'
        else
          printf '%s\n' '    image: ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest'
        fi
        if [ "${FAKE_COMPOSE_RESOURCE_LIMITS_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    mem_limit: 128M'
          printf '%s\n' '    cpus: "0.3"'
        fi
        if [ "${FAKE_COMPOSE_MISSING_LOGGING:-0}" != "1" ]; then
          printf '%s\n' '    logging:'
          printf '%s\n' '      driver: json-file'
          printf '%s\n' '      options:'
          printf '%s\n' '        max-size: 50m'
          printf '%s\n' '        max-file: "5"'
        fi
        printf '%s\n' '    healthcheck:'
        printf '%s\n' '      test: ["CMD-SHELL", "wget -qO- http://localhost/healthz >/dev/null 2>&1 || exit 1"]'
        if [ "${FAKE_COMPOSE_MISSING_WEB_RESTART:-0}" != "1" ]; then
          printf '%s\n' '    restart: unless-stopped'
        fi
        if [ "${FAKE_COMPOSE_WEB_PORT_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    ports:'
          printf '%s\n' '      - mode: ingress'
          printf '%s\n' '        target: 80'
          if [ "${FAKE_COMPOSE_WEB_PORT_MISMATCH:-0}" = "1" ]; then
            printf '%s\n' '        published: "3799"'
          else
            printf '%s\n' '        published: "3780"'
          fi
          printf '%s\n' '        protocol: tcp'
        fi
        printf '%s\n' '    volumes:'
        printf '%s\n' '      - static-data:/app/static:ro'
        printf '%s\n' '      - uploads-data:/app/uploads:ro'
        if [ "${FAKE_COMPOSE_INTERNAL_NETWORK_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    networks:'
          printf '%s\n' '      internal: null'
        fi
        printf '%s\n' '  postgres:'
        printf '%s\n' '    image: postgres'
        printf '%s\n' '    mem_limit: 384M'
        printf '%s\n' '    cpus: "0.7"'
        if [ "${FAKE_COMPOSE_MISSING_LOGGING:-0}" != "1" ]; then
          printf '%s\n' '    logging:'
          printf '%s\n' '      driver: json-file'
          printf '%s\n' '      options:'
          printf '%s\n' '        max-size: 50m'
          printf '%s\n' '        max-file: "5"'
        fi
        printf '%s\n' '    healthcheck:'
        printf '%s\n' '      test: ["CMD-SHELL", "pg_isready -U modeluser -d 3dparthub"]'
        printf '%s\n' '    restart: unless-stopped'
        printf '%s\n' '    volumes:'
        printf '%s\n' '      - pgdata:/var/lib/postgresql/data'
        if [ "${FAKE_COMPOSE_INTERNAL_NETWORK_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    networks:'
          printf '%s\n' '      internal: null'
        fi
        printf '%s\n' '  redis:'
        printf '%s\n' '    image: redis'
        printf '%s\n' '    mem_limit: 128M'
        printf '%s\n' '    cpus: "0.3"'
        if [ "${FAKE_COMPOSE_MISSING_LOGGING:-0}" != "1" ]; then
          printf '%s\n' '    logging:'
          printf '%s\n' '      driver: json-file'
          printf '%s\n' '      options:'
          printf '%s\n' '        max-size: 50m'
          printf '%s\n' '        max-file: "5"'
        fi
        printf '%s\n' '    healthcheck:'
        if [ "${FAKE_REDIS_HEALTHCHECK_NO_AUTH:-0}" = "1" ]; then
          printf '%s\n' '      test: ["CMD", "redis-cli", "ping"]'
        else
          printf '%s\n' '      test: ["CMD", "sh", "-c", "REDISCLI_AUTH=test-redis-password-1234567890 redis-cli ping"]'
        fi
        printf '%s\n' '    restart: unless-stopped'
        printf '%s\n' '    volumes:'
        printf '%s\n' '      - redis-data:/data'
        if [ "${FAKE_COMPOSE_INTERNAL_NETWORK_MISSING:-0}" != "1" ]; then
          printf '%s\n' '    networks:'
          printf '%s\n' '      internal: null'
        fi
        if [ "${FAKE_COMPOSE_INTERNAL_NETWORK_MISSING:-0}" != "1" ]; then
          printf '%s\n' 'networks:'
          printf '%s\n' '  internal:'
        fi
      fi
      exit 0
      ;;
    ps)
      printf '%s\n' 'NAME                 STATUS'
      printf '%s\n' '3dparthub-api        running (healthy)'
      printf '%s\n' '3dparthub-web        running (healthy)'
      printf '%s\n' '3dparthub-postgres   running (healthy)'
      printf '%s\n' '3dparthub-redis      running (healthy)'
      exit 0
      ;;
    exec)
      service="${3:-}"
      if [ "${2:-}" != "-T" ]; then
        service="${2:-}"
      fi
      if [ "$service" = "api" ] && [ "${FAKE_RUNTIME_DIR_BAD:-0}" = "1" ]; then
        echo "not_writable:/app/static/backups"
        exit 3
      fi
      if [ "$service" = "api" ] && printf '%s' "$*" | grep -q 'dist/cluster.js'; then
        # 模拟 node 应用进程（dist/cluster.js）的运行用户：app_name|app_uid|pid1_uid
        if [ "${FAKE_API_PROCESS_ROOT:-0}" = "1" ]; then
          echo "root|0|0"
        else
          echo "node|1000|0"
        fi
        exit 0
      fi
      if [ "$service" = "api" ] && printf '%s' "$*" | grep -q 'deploy_health_data_volume_capacity'; then
        if [ "${FAKE_API_DATA_VOLUME_LOW:-0}" = "1" ]; then
          echo "fail:/app/uploads:disk_free_512MB_used_99%_mount_/app/uploads"
          echo "warn:/app/static:inode_free_40000_used_96%_mount_/app/static"
        else
          echo "ok:/app/uploads:disk_free_50000MB_used_2%_mount_/app/uploads"
          echo "ok:/app/uploads:inode_free_500000_used_1%_mount_/app/uploads"
          echo "ok:/app/static:disk_free_50000MB_used_2%_mount_/app/static"
          echo "ok:/app/static:inode_free_500000_used_1%_mount_/app/static"
        fi
        exit 0
      fi
      if [ "$service" = "api" ] && printf '%s' "$*" | grep -q 'migrate status'; then
        if [ "${FAKE_PRISMA_MIGRATION_PENDING:-0}" = "1" ]; then
          echo "Following migration(s) have not yet been applied:"
          echo "202605260001_enterprise_check"
          exit 1
        fi
        echo "Database schema is up to date!"
        exit 0
      fi
      if [ "$service" = "redis" ]; then
        echo "PONG"
      fi
      exit 0
      ;;
    logs)
      service=""
      for arg in "$@"; do
        service="$arg"
      done
      if [ "$service" = "web" ]; then
        if [ "${FAKE_WEB_LOG_ERROR:-0}" = "1" ]; then
          echo "nginx: [emerg] open() /etc/nginx/conf.d/default.conf failed (2: No such file or directory)"
          exit 0
        fi
        echo "nginx started successfully"
        echo "GET /healthz 200"
        exit 0
      fi
      if [ "${FAKE_API_LOG_ERROR:-0}" = "1" ]; then
        echo "PrismaClientInitializationError: password authentication failed"
        exit 0
      fi
      echo "API started successfully"
      echo "模型日志正常：中文"
      if [ "${FAKE_API_LOG_SECRET:-0}" = "1" ]; then
        echo "DATABASE_URL=postgresql://modeluser:super-secret-db@postgres:5432/3dparthub"
        echo "REDIS_URL=redis://:super-secret-redis@redis:6379"
        echo "REDISCLI_AUTH=super-secret-redis"
        echo "Authorization: Bearer super-secret-token"
      fi
      if [ "${FAKE_LARGE_LOG:-0}" = "1" ]; then
        i=0
        payload="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        while [ "$i" -lt 7000 ]; do
          printf 'large-log-%04d %s %s %s\n' "$i" "$payload" "$payload" "$payload"
          i=$((i + 1))
        done
      fi
      echo "No pending migrations to apply."
      exit 0
      ;;
  esac
fi

if [ "${1:-}" = "ps" ]; then
  printf '%s\n' 'NAMES                STATUS              IMAGE                       PORTS'
  printf '%s\n' '3dparthub-api        Up 2 minutes         ghcr.io/test/api:latest'
  printf '%s\n' '3dparthub-web        Up 2 minutes         ghcr.io/test/web:latest     0.0.0.0:3780->80/tcp'
  printf '%s\n' '3dparthub-postgres   Up 2 minutes         postgres:16-alpine'
  printf '%s\n' '3dparthub-redis      Up 2 minutes         redis:7-alpine'
  exit 0
fi

if [ "${1:-}" = "container" ] && [ "${2:-}" = "inspect" ]; then
  if [ "${FAKE_DOCKER_DOWN:-0}" = "1" ]; then
    exit 1
  fi
  exit 0
fi

  if [ "${1:-}" = "inspect" ]; then
  if [ "${FAKE_DOCKER_DOWN:-0}" = "1" ]; then
    exit 1
  fi
  format="${3:-}"
  name="${4:-}"
  if printf '%s' "$format" | grep -q 'imageId='; then
    case "$name" in
      3dparthub-api)
        image="ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest"
        ;;
      3dparthub-web)
        image="ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest"
        ;;
      3dparthub-postgres)
        image="postgres:16-alpine"
        ;;
      3dparthub-redis)
        image="redis:7-alpine"
        ;;
      *)
        image="unknown"
        ;;
    esac
    health="healthy"
    oom="false"
    restart_count="0"
    if [ "${FAKE_API_NO_HEALTH:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      health="none"
    fi
    if [ "${FAKE_API_RESTARTED:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      oom="true"
      restart_count="7"
    fi
    if [ "${FAKE_API_OLD_IMAGE:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      image="ghcr.io/liaoweixiang2024-blip/${name}:v3.1.0"
    fi
    if [ "${FAKE_RUNTIME_IMAGE_SOURCE_MISMATCH:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      image="ghcr.io/example/wrong-api:latest"
    fi
    echo "/${name} image=${image} imageId=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa status=running health=${health} restartPolicy=unless-stopped restartCount=${restart_count} oom=${oom}"
  elif printf '%s' "$format" | grep -q 'HostConfig.RestartPolicy'; then
    if [ "${FAKE_RUNTIME_RESTART_POLICY_MISSING:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "no"
    else
      echo "unless-stopped"
    fi
  elif printf '%s' "$format" | grep -q 'HostConfig.StopTimeout'; then
    if [ "${FAKE_RUNTIME_STOP_TIMEOUT_SHORT:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "10"
    elif [ "$name" = "3dparthub-api" ]; then
      echo "300"
    else
      echo "<nil>"
    fi
  elif printf '%s' "$format" | grep -q 'HostConfig.Memory'; then
    if [ "${FAKE_RUNTIME_RESOURCE_LIMITS_MISSING:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "0|0|0|0"
    elif [ "${FAKE_RUNTIME_RESOURCE_LIMITS_MISMATCH:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "2147483648|2000000000|0|0"
    else
      case "$name" in
        3dparthub-api)
          echo "943718400|1200000000|0|0"
          ;;
        3dparthub-web)
          echo "134217728|300000000|0|0"
          ;;
        3dparthub-postgres)
          echo "402653184|700000000|0|0"
          ;;
        3dparthub-redis)
          echo "134217728|300000000|0|0"
          ;;
        *)
          echo "0|0|0|0"
          ;;
      esac
    fi
  elif printf '%s' "$format" | grep -q 'HostConfig.LogConfig'; then
    if [ "${FAKE_RUNTIME_LOGGING_MISSING:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "json-file||"
    else
      echo "json-file|50m|5"
    fi
  elif printf '%s' "$format" | grep -q 'State.Health'; then
    oom="false"
    restart_count="0"
    if [ "${FAKE_API_RESTARTED:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      oom="true"
      restart_count="7"
    fi
    if [ "${FAKE_API_UNHEALTHY:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "running|unhealthy|0|${oom}|${restart_count}"
    elif [ "${FAKE_API_NO_HEALTH:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "running|none|0|${oom}|${restart_count}"
    else
      echo "running|healthy|0|${oom}|${restart_count}"
    fi
  elif printf '%s' "$format" | grep -q 'Config.Image'; then
    if [ "${FAKE_API_OLD_IMAGE:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "ghcr.io/liaoweixiang2024-blip/${name}:v3.1.0"
    elif [ "${FAKE_RUNTIME_IMAGE_SOURCE_MISMATCH:-0}" = "1" ] && [ "$name" = "3dparthub-api" ]; then
      echo "ghcr.io/example/wrong-api:latest"
    else
      case "$name" in
        3dparthub-api)
          echo "ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest"
          ;;
        3dparthub-web)
          echo "ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest"
          ;;
        3dparthub-postgres)
          echo "postgres:16-alpine"
          ;;
        3dparthub-redis)
          echo "redis:7-alpine"
          ;;
        *)
          echo "unknown"
          ;;
      esac
    fi
  elif printf '%s' "$format" | grep -q 'Config.Env'; then
    db_password="test-db-password-1234567890"
    redis_password="test-redis-password-1234567890"
    jwt_secret="test-jwt-secret-1234567890-abcdef"
    backup_signing_secret="test-backup-signing-secret-1234567890"
    backup_encryption_secret="test-backup-encryption-secret-1234567890"
    allowed_origins="https://model.example.com"
    if [ "${FAKE_RUNTIME_ENV_MISMATCH:-0}" = "1" ]; then
      db_password="old-db-password"
      redis_password="old-redis-password"
      jwt_secret="old-jwt-secret"
      backup_signing_secret="old-backup-signing-secret"
      backup_encryption_secret="old-backup-encryption-secret"
      allowed_origins="https://old.example.com"
    fi
    case "$name" in
      3dparthub-api)
        printf '%s\n' "DATABASE_URL=postgresql://modeluser:${db_password}@postgres:5432/3dparthub"
        printf '%s\n' "REDIS_URL=redis://:${redis_password}@redis:6379"
        printf '%s\n' "JWT_SECRET=${jwt_secret}"
        printf '%s\n' "BACKUP_SIGNING_SECRET=${backup_signing_secret}"
        printf '%s\n' "BACKUP_ENCRYPTION_SECRET=${backup_encryption_secret}"
        printf '%s\n' "ALLOWED_ORIGINS=${allowed_origins}"
        ;;
      3dparthub-postgres)
        printf '%s\n' "POSTGRES_PASSWORD=${db_password}"
        ;;
    esac
  elif printf '%s' "$format" | grep -q 'Config.Cmd'; then
    redis_password="test-redis-password-1234567890"
    if [ "${FAKE_RUNTIME_ENV_MISMATCH:-0}" = "1" ]; then
      redis_password="old-redis-password"
    fi
    if [ "$name" = "3dparthub-redis" ]; then
      printf '%s\n' 'redis-server'
      printf '%s\n' '--requirepass'
      printf '%s\n' "$redis_password"
    fi
  elif printf '%s' "$format" | grep -q 'NetworkSettings.Ports'; then
    if [ "$name" = "3dparthub-web" ]; then
      if [ "${FAKE_WEB_PORT_MISSING:-0}" = "1" ]; then
        :
      elif [ "${FAKE_WEB_PORT_MISMATCH:-0}" = "1" ]; then
        printf '%s\n' '80/tcp=0.0.0.0:3799'
      else
        printf '%s\n' '80/tcp=0.0.0.0:3780'
      fi
    elif [ "$name" = "3dparthub-api" ] && [ "${FAKE_RUNTIME_PRIVATE_PORT_EXPOSED:-0}" = "1" ]; then
      printf '%s\n' '8000/tcp=0.0.0.0:8000'
    fi
  elif printf '%s' "$format" | grep -q 'Mounts'; then
    case "$name" in
      3dparthub-api)
        printf '%s\n' 'volume|3dparthub_uploads-data|/var/lib/docker/volumes/3dparthub_uploads-data/_data|/app/uploads|true'
        printf '%s\n' 'volume|3dparthub_static-data|/var/lib/docker/volumes/3dparthub_static-data/_data|/app/static|true'
        if [ "${FAKE_RUNTIME_MISSING_BACKUP_MOUNT:-0}" != "1" ]; then
          printf '%s\n' 'bind||/opt/3dparthub/server/static/backups|/app/static/backups|true'
        fi
        ;;
      3dparthub-web)
        printf '%s\n' 'volume|3dparthub_static-data|/var/lib/docker/volumes/3dparthub_static-data/_data|/app/static|false'
        printf '%s\n' 'volume|3dparthub_uploads-data|/var/lib/docker/volumes/3dparthub_uploads-data/_data|/app/uploads|false'
        ;;
      3dparthub-postgres)
        printf '%s\n' 'volume|3dparthub_pgdata|/var/lib/docker/volumes/3dparthub_pgdata/_data|/var/lib/postgresql/data|true'
        ;;
      3dparthub-redis)
        printf '%s\n' 'volume|3dparthub_redis-data|/var/lib/docker/volumes/3dparthub_redis-data/_data|/data|true'
        ;;
    esac
  else
    echo "running"
  fi
  exit 0
fi

if [ "${1:-}" = "system" ] && [ "${2:-}" = "df" ]; then
  echo "TYPE TOTAL ACTIVE SIZE RECLAIMABLE"
  echo "Images 4 4 1GB 0B"
  exit 0
fi

echo "unexpected docker args: $*" >&2
exit 1
EOF

cat > "$FAKE_BIN/docker-compose" <<'EOF'
#!/bin/sh
set -eu

if [ "${1:-}" = "version" ]; then
  echo "Docker Compose version v2.29.0-standalone"
  exit 0
fi

FAKE_DOCKER_COMPOSE_PLUGIN_MISSING=0 exec docker compose "$@"
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/bin/sh
set -eu
url=""
headers=0
status_only=0
expect_write_arg=0
for arg in "$@"; do
  if [ "$expect_write_arg" = "1" ]; then
    expect_write_arg=0
    continue
  fi
  if [ "$arg" = "-D" ]; then
    headers=1
  fi
  if [ "$arg" = "-w" ]; then
    status_only=1
    expect_write_arg=1
    continue
  fi
  url="$arg"
done

if [ "$status_only" = "1" ]; then
  case "$url" in
    */api/health/deep)
      if [ "${FAKE_DEEP_HEALTH_PUBLIC:-0}" = "1" ]; then
        printf '200'
      else
        printf '401'
      fi
      exit 0
      ;;
    */static/backups/*|*/static/originals/*|*/static/drawings/*|*/static/ticket-attachments/*|*/static/inquiry-attachments/*|*/static/html-previews/*|*/static/batch/*|*/static/_backup_db/*|*/static/_safety_snapshots/*|*/static/.restore_deploy_health_probe/*|*/uploads/*|*/_protected_static/*|*/_protected_uploads/*)
      if [ "${FAKE_SENSITIVE_STATIC_EXPOSED:-0}" = "1" ]; then
        printf '200'
      else
        printf '404'
      fi
      exit 0
      ;;
    */assets/*)
      if [ "${FAKE_WEB_ASSET_FAIL:-0}" = "1" ]; then
        printf '404'
      else
        printf '200'
      fi
      exit 0
      ;;
    *)
      printf '200'
      exit 0
      ;;
  esac
fi

if [ "$headers" = "1" ]; then
  echo "HTTP/1.1 200 OK"
  if [ "${FAKE_SECURITY_HEADERS_MISSING:-0}" = "1" ]; then
    echo "X-Content-Type-Options: nosniff"
    echo
    exit 0
  fi
  echo "X-Content-Type-Options: nosniff"
  echo "X-Frame-Options: SAMEORIGIN"
  echo "Referrer-Policy: strict-origin-when-cross-origin"
  case "$url" in
    */)
      echo "Content-Security-Policy: default-src 'self'; frame-ancestors 'self'"
      ;;
  esac
  echo
  exit 0
fi

case "$url" in
  */api/health/ready)
    echo '{"status":"ready"}'
    ;;
  */api/health/live)
    if [ "${FAKE_LIVE_FAIL:-0}" = "1" ]; then
      exit 22
    fi
    echo '{"status":"alive","uptime_seconds":120,"memory":{"rss_mb":128}}'
    ;;
  */api/health)
    if [ "${FAKE_HEALTH_FAIL:-0}" = "1" ]; then
      exit 22
    fi
    echo '{"status":"ok"}'
    ;;
  */api/settings/version)
    if [ "${FAKE_VERSION_FAIL:-0}" = "1" ]; then
      exit 22
    fi
    echo '{"current":"v3.2.3"}'
    ;;
  */healthz)
    echo "ok"
    ;;
  */assets/*)
    if [ "${FAKE_WEB_ASSET_FAIL:-0}" = "1" ]; then
      exit 22
    fi
    echo 'console.log("ok")'
    ;;
  */)
    if [ "${FAKE_WEB_HOME_FAIL:-0}" = "1" ]; then
      echo "maintenance"
      exit 0
    fi
    echo '<!doctype html><html><body><div id="root"></div><script src="/assets/index.js"></script></body></html>'
    ;;
  *)
    echo "unexpected curl url: $url" >&2
    exit 22
    ;;
esac
EOF

cat > "$FAKE_BIN/ss" <<'EOF'
#!/bin/sh
set -eu
if [ "${FAKE_PORT_NO_LISTENER:-0}" = "1" ]; then
  exit 0
fi
if [ "${FAKE_PORT_NGINX:-0}" = "1" ]; then
  echo 'LISTEN 0 511 0.0.0.0:3780 0.0.0.0:* users:(("nginx",pid=621,fd=89))'
  exit 0
fi
echo 'LISTEN 0 4096 0.0.0.0:3780 0.0.0.0:* users:(("docker-proxy",pid=100,fd=4))'
EOF

cat > "$FAKE_BIN/df" <<'EOF'
#!/bin/sh
set -eu
mode="${1:-}"
target="${2:-.}"
if [ "$mode" = "-Pi" ] || [ "$mode" = "-ih" ]; then
  echo 'Filesystem Inodes IUsed IFree IUse% Mounted on'
case "$target" in
    */.fake-docker-root|*/var/lib/docker|/var/lib/docker)
      if [ "${FAKE_DOCKER_INODE_LOW:-0}" = "1" ]; then
        echo '/dev/docker 1000000 960000 40000 96% /var/lib/docker'
      else
        echo '/dev/docker 1000000 1000 500000 1% /var/lib/docker'
      fi
      ;;
    *server/static/backups*)
      if [ "${FAKE_BACKUP_INODE_LOW:-0}" = "1" ]; then
        echo '/dev/backup 1000000 960000 40000 96% /backup'
      else
        echo '/dev/backup 1000000 1000 500000 1% /backup'
      fi
      ;;
    *)
      echo '/dev/mock 1000000 1000 500000 1% /mock'
      ;;
  esac
  exit 0
fi
echo 'Filesystem 1048576-blocks Used Available Capacity Mounted on'
case "$target" in
  */.fake-docker-root|*/var/lib/docker|/var/lib/docker)
    if [ "${FAKE_DOCKER_DISK_LOW:-0}" = "1" ]; then
      echo '/dev/docker 100000 99500 512 99% /var/lib/docker'
    else
      echo '/dev/docker 100000 1000 50000 2% /var/lib/docker'
    fi
    ;;
  *server/static/backups*)
    if [ "${FAKE_BACKUP_DISK_LOW:-0}" = "1" ]; then
      echo '/dev/backup 100000 96000 4096 96% /backup'
    else
      echo '/dev/backup 100000 1000 50000 2% /backup'
    fi
    ;;
  *)
    echo '/dev/mock 100000 1000 50000 2% /mock'
    ;;
esac
EOF

cat > "$FAKE_BIN/free" <<'EOF'
#!/bin/sh
set -eu
echo '              total        used        free      shared  buff/cache   available'
echo 'Mem:           2048         300        1000           0         748        1500'
echo 'Swap:          1024           0        1024'
EOF

chmod +x "$FAKE_BIN/docker" "$FAKE_BIN/docker-compose" "$FAKE_BIN/curl" "$FAKE_BIN/ss" "$FAKE_BIN/df" "$FAKE_BIN/free"
cp "$FAKE_BIN/curl" "$FAKE_BIN/ss" "$FAKE_BIN/df" "$FAKE_BIN/free" "$NO_DOCKER_BIN/"

cat > "$WORK_DIR/.env" <<'EOF'
PORT=3780
IMAGE_TAG=latest
DB_PASSWORD=test-db-password-1234567890
REDIS_PASSWORD=test-redis-password-1234567890
JWT_SECRET=test-jwt-secret-1234567890-abcdef
BACKUP_SIGNING_SECRET=test-backup-signing-secret-1234567890
BACKUP_ENCRYPTION_SECRET=test-backup-encryption-secret-1234567890
RESOURCE_PROFILE=2G
API_MEMORY_LIMIT=900M
API_MEMORY_RESERVATION=256M
API_CPU_LIMIT=1.2
API_WORKERS=1
API_SHM_SIZE=256M
CONVERSION_WORKER_CONCURRENCY=1
POSTGRES_MEMORY_LIMIT=384M
POSTGRES_CPU_LIMIT=0.7
REDIS_MEMORY_LIMIT=128M
REDIS_CPU_LIMIT=0.3
REDIS_MAXMEMORY=96mb
WEB_MEMORY_LIMIT=128M
WEB_CPU_LIMIT=0.3
DB_CONNECTION_LIMIT=3
ADMIN_PASS=test-admin-password-1234567890
ALLOWED_ORIGINS=https://model.example.com
EOF
chmod 600 "$WORK_DIR/.env"

write_restore_drill_fixture() {
  mkdir -p "$WORK_DIR/server/static/backups/.restore-drills"
  checked_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '2026-05-26T12:02:00Z')"
  cat > "$WORK_DIR/server/static/backups/.restore-drills/latest.json" <<EOF
{
  "schemaVersion": 1,
  "tool": "3DPartHub backup restore drill",
  "status": "passed",
  "checkedAt": "${checked_at}",
  "createdBackupId": "backup_20260526_120000",
  "importedBackupId": "backup_20260526_120000_imported",
  "restoredFromBackupId": "backup_20260526_120000_imported"
}
EOF
}

write_restore_drill_fixture

cat > "$WORK_DIR/docker-compose.yml" <<'EOF'
services:
  api:
    image: test-api
  web:
    image: test-web
  postgres:
    image: postgres
  redis:
    image: redis
EOF

run_case() {
  name="$1"
  shift
  printf '==> %s\n' "$name"
  "$@"
}

assert_contains() {
  haystack="$1"
  needle="$2"
  if ! printf '%s' "$haystack" | grep -F -q -- "$needle"; then
    echo "Expected output to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  haystack="$1"
  needle="$2"
  if printf '%s' "$haystack" | grep -F -q -- "$needle"; then
    echo "Expected output not to contain: $needle" >&2
    echo "$haystack" >&2
    exit 1
  fi
}

assert_json_report() {
  file="$1"
  expected_result="$2"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const expected = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.result !== expected) {
  throw new Error(`Expected result ${expected}, got ${data.result}`);
}
if (data.schemaVersion !== 1) {
  throw new Error(`Expected schemaVersion 1, got ${data.schemaVersion}`);
}
if (!data.summary || typeof data.summary.passes !== "number" || typeof data.summary.warnings !== "number" || typeof data.summary.failures !== "number") {
  throw new Error("Invalid summary");
}
if (!data.context || typeof data.context.healthUrl !== "string" || !data.context.healthUrl.includes("/api/health")) {
  throw new Error("Invalid healthUrl context");
}
if (!Array.isArray(data.checks) || data.checks.length === 0) {
  throw new Error("Missing checks");
}
if (!data.checks.every((check) => ["pass", "warn", "fail"].includes(check.status) && typeof check.message === "string" && check.message.length > 0)) {
  throw new Error("Invalid check entries");
}
const serialized = JSON.stringify(data);
if (serialized.includes("test-db-password-1234567890") || serialized.includes("test-redis-password-1234567890")) {
  throw new Error("JSON report leaked secrets");
}
' "$file" "$expected_result"
}

assert_acceptance_json_summary() {
  file="$1"
  expected_completion="$2"
  expected_manifest_verified="$3"
  expected_final_ready="$4"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const expectedCompletion = process.argv[2];
const expectedManifestVerified = process.argv[3] === "true";
const expectedFinalReady = process.argv[4] === "true";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.schemaVersion !== 1) {
  throw new Error(`Expected schemaVersion 1, got ${data.schemaVersion}`);
}
if (data.tool !== "3DPartHub 生产部署健康验收摘要") {
  throw new Error(`Unexpected tool: ${data.tool}`);
}
if (!data.result || data.result.completion !== expectedCompletion) {
  throw new Error(`Expected completion ${expectedCompletion}, got ${data.result && data.result.completion}`);
}
if (!data.source || data.source.manifestVerified !== expectedManifestVerified) {
  throw new Error("Unexpected source.manifestVerified");
}
if (expectedManifestVerified && typeof data.source.bundleId !== "string") {
  throw new Error("Expected source.bundleId for complete evidence");
}
if (!expectedManifestVerified && data.source.bundleId !== null) {
  throw new Error("Expected null source.bundleId for report-only evidence");
}
if (!data.productionEvidence || data.productionEvidence.finalConclusionReady !== expectedFinalReady) {
  throw new Error("Unexpected productionEvidence.finalConclusionReady");
}
if (data.productionEvidence.requiredForFinalConclusion !== true) {
  throw new Error("Expected production evidence to be required for final conclusion");
}
if (data.productionEvidence.backupInventoryRequired !== true) {
  throw new Error("Expected backup inventory to be required for final conclusion");
}
if (data.productionEvidence.backupInventoryReady !== (expectedManifestVerified && expectedFinalReady)) {
  throw new Error("Unexpected productionEvidence.backupInventoryReady");
}
if (!Array.isArray(data.productionEvidence.finalConclusionBlockers)) {
  throw new Error("Expected final conclusion blockers array");
}
if (expectedFinalReady && data.productionEvidence.finalConclusionBlockers.length !== 0) {
  throw new Error("Expected no final conclusion blockers");
}
if (!expectedFinalReady && data.productionEvidence.finalConclusionBlockers.length === 0) {
  throw new Error("Expected final conclusion blockers");
}
if (data.productionEvidence.completeEvidenceProvided !== expectedManifestVerified) {
  throw new Error("Unexpected productionEvidence.completeEvidenceProvided");
}
if (data.productionEvidence.reportOnlyFallback !== !expectedManifestVerified) {
  throw new Error("Unexpected productionEvidence.reportOnlyFallback");
}
  if (!data.backupInventory || data.backupInventory.verified !== expectedManifestVerified) {
    throw new Error("Unexpected backupInventory.verified");
  }
  if (expectedManifestVerified) {
  if (data.backupInventory.directoryExists !== true) {
    throw new Error("Expected backup directory existence summary");
  }
  if (data.backupInventory.workDirCount !== 0) {
    throw new Error("Expected no backup temporary work directories");
  }
  if (data.backupInventory.riskLevel !== "low") {
    throw new Error(`Expected low backup inventory risk, got ${data.backupInventory.riskLevel}`);
  }
  if (data.backupInventory.recordCount !== 1 || data.backupInventory.archivePresentCount !== 1) {
    throw new Error("Expected backup inventory record and archive counts");
  }
  if (data.backupInventory.manifestVersionCount !== 1 || data.backupInventory.archiveSha256Count !== 1 || data.backupInventory.archiveSignatureCount !== 1) {
    throw new Error("Expected backup inventory manifest/hash/signature counts");
  }
  if (data.backupInventory.orphanArchiveCount !== 1 || data.backupInventory.restoreDrillExecuted !== true) {
    throw new Error("Expected backup inventory orphan count and restore drill flag");
  }
  if (data.backupInventory.restoreDrillStatus !== "passed" || !String(data.backupInventory.restoreDrillRestoredFromBackupId || "").includes("backup_20260526_120000_imported")) {
    throw new Error("Expected passed restore drill evidence");
  }
  if (data.backupInventory.restoreDrillTimestampValid !== true) {
    throw new Error("Expected restore drill timestamp to be valid");
  }
  if (!Array.isArray(data.backupInventory.nextActions) || !data.backupInventory.nextActions.some((action) => action.includes("孤儿备份归档"))) {
    throw new Error("Expected backup inventory orphan next action");
  }
  if (data.backupInventory.nextActions.some((action) => action.includes("临时工作目录"))) {
    throw new Error("Expected final-ready backup inventory to have no temporary work directory action");
  }
} else if (data.backupInventory.riskLevel !== "unknown") {
  throw new Error(`Expected unknown backup inventory risk for report-only evidence, got ${data.backupInventory.riskLevel}`);
}
if (!data.evidenceIntegrity || data.evidenceIntegrity.hashesVerified !== expectedManifestVerified) {
  throw new Error("Unexpected evidenceIntegrity.hashesVerified");
}
if (data.evidenceIntegrity.provenanceVerified !== expectedManifestVerified) {
  throw new Error("Unexpected evidenceIntegrity.provenanceVerified");
}
if (expectedManifestVerified && data.source.kind === "evidence-archive" && data.evidenceIntegrity.archiveSha256Verified !== true) {
  throw new Error("Expected archive SHA-256 sidecar to be verified");
}
if (expectedManifestVerified && data.source.kind === "evidence-archive") {
  const archiveSha256 = data.evidenceIntegrity.archiveSha256;
  if (!archiveSha256 || archiveSha256.present !== true || archiveSha256.verified !== true) {
    throw new Error("Expected archive SHA-256 evidence details");
  }
  if (!/^[a-f0-9]{64}$/.test(archiveSha256.actual || "") || archiveSha256.actual !== archiveSha256.expected) {
    throw new Error("Expected matching archive SHA-256 digest details");
  }
  if (typeof archiveSha256.sidecar !== "string" || !archiveSha256.sidecar.endsWith(".sha256")) {
    throw new Error("Expected archive SHA-256 sidecar path");
  }
  if (archiveSha256.referencesArchive !== true || typeof archiveSha256.archive !== "string" || !archiveSha256.sidecar.endsWith(`${archiveSha256.archive}.sha256`)) {
    throw new Error("Expected archive SHA-256 sidecar to reference archive name");
  }
}
if (!Array.isArray(data.requiredChecks) || !data.requiredChecks.some((check) => check.name.includes("API 容器运行目录可写") && check.status === "pass")) {
  throw new Error("Missing runtime directory required check");
}
if (!data.narrative || !Array.isArray(data.narrative.remainingRisks) || data.narrative.remainingRisks.length === 0) {
  throw new Error("Missing remaining risks");
}
const serialized = JSON.stringify(data);
if (serialized.includes("test-db-password-1234567890") || serialized.includes("test-redis-password-1234567890") || serialized.includes("test-backup-signing-secret-1234567890") || serialized.includes("test-backup-encryption-secret-1234567890")) {
  throw new Error("Acceptance JSON leaked secrets");
}
' "$file" "$expected_completion" "$expected_manifest_verified" "$expected_final_ready"
}

run_healthy_case() {
  report="$WORK_DIR/deploy-health-report.txt"
  json_report="$WORK_DIR/deploy-health-report.json"
  rm -f "$report" "$json_report"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --report "$report" --json "$json_report" 2>&1)"
  assert_contains "$output" "部署自检通过"
  assert_contains "$output" "报告文件"
  assert_contains "$output" "JSON报告"
  assert_contains "$output" "环境文件权限安全"
  assert_contains "$output" "数据库密码 DB_PASSWORD 已设置"
  assert_contains "$output" "Redis 密码 REDIS_PASSWORD 已设置"
  assert_contains "$output" "JWT_SECRET 已设置"
  assert_contains "$output" "ADMIN_PASS 已设置"
  assert_contains "$output" "ALLOWED_ORIGINS 已设置为生产来源"
  assert_contains "$output" "运行镜像标签与 IMAGE_TAG 一致"
  assert_contains "$output" "运行镜像来源正常"
  assert_contains "$output" "Compose 服务键未重复"
  assert_contains "$output" "Compose 持久化挂载正常"
  assert_contains "$output" "Compose API 关键环境已声明"
  assert_contains "$output" "Compose 镜像来源正常"
  assert_contains "$output" "Compose Web 端口映射正常"
  assert_contains "$output" "Compose 端口暴露正常"
  assert_contains "$output" "Compose 日志轮转已配置"
  assert_contains "$output" "Compose 资源限制已声明"
  assert_contains "$output" "Compose API 停止宽限期正常"
  assert_contains "$output" "Compose 内部网络正常"
  assert_contains "$output" "容器挂载正常"
  assert_contains "$output" "容器日志轮转正常"
  assert_contains "$output" "容器重启策略正常"
  assert_contains "$output" "运行 API 停止宽限期正常"
  assert_contains "$output" "容器资源限制正常"
  assert_contains "$output" "容器环境与 .env 一致"
  assert_contains "$output" "容器启动参数与 .env 一致"
  assert_contains "$output" "API 应用进程"
  assert_contains "$output" "宿主机备份目录可写"
  assert_contains "$output" "备份恢复演练证据正常"
  assert_contains "$output" "部署目录 inode 正常"
  assert_contains "$output" "Docker 数据目录磁盘空间正常"
  assert_contains "$output" "Docker 数据目录 inode 正常"
  assert_contains "$output" "备份目录 inode 正常"
  assert_contains "$output" "API 数据卷容量正常"
  assert_contains "$output" "资源配置适配当前内存档位"
  assert_contains "$output" "PostgreSQL 当前密码可登录"
  assert_contains "$output" "数据库迁移状态正常"
  assert_contains "$output" "Redis 密码可用"
  assert_contains "$output" "宿主机端口 3780 已有监听"
  assert_contains "$output" "Web 容器端口映射正常"
  assert_contains "$output" "运行容器端口暴露正常"
  assert_contains "$output" "存活接口正常"
  assert_contains "$output" "管理健康接口访问控制正常"
  assert_contains "$output" "运行版本可读取"
  assert_contains "$output" "Web 首页入口正常"
  assert_contains "$output" "API 安全响应头正常"
  assert_contains "$output" "Web 首页安全响应头正常"
  assert_contains "$output" "Web 敏感路径未暴露"
  assert_contains "$output" "Web 前端静态资源正常"
  assert_contains "$output" "Web 最近日志未发现常见错误"
  if [ ! -s "$report" ]; then
    echo "Expected deploy health report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  report_body="$(cat "$report")"
  assert_contains "$report_body" "生成时间:"
  assert_contains "$report_body" "主机:"
  assert_contains "$report_body" "系统:"
  assert_contains "$report_body" "image=ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest"
  assert_contains "$report_body" "部署自检通过"
  assert_contains "$report_body" "通过:"
  if [ ! -s "$json_report" ]; then
    echo "Expected deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  json_body="$(cat "$json_report")"
  assert_contains "$json_body" '"result": "passed"'
  assert_contains "$json_body" '"passes"'
  assert_contains "$json_body" '"checks"'
  assert_contains "$json_body" '"healthUrl"'
  assert_not_contains "$json_body" "test-db-password-1234567890"
  assert_not_contains "$json_body" "test-redis-password-1234567890"
  assert_not_contains "$json_body" "test-backup-signing-secret-1234567890"
  assert_not_contains "$json_body" "test-backup-encryption-secret-1234567890"
  assert_json_report "$json_report" "passed"
  node "$REPORT_VERIFIER" "$json_report" --require-text "$report" >/dev/null
  node "$REPORT_VERIFIER" "$json_report" --require-text "$report" --max-age-hours 24 >/dev/null
  stale_json_report="$WORK_DIR/deploy-health-stale-report.json"
  cp "$json_report" "$stale_json_report"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data.generatedAt = "2000-01-01 00:00:00 +0000";
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$stale_json_report"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$stale_json_report" --require-text "$report" --max-age-hours 1 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected stale deploy health report to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "older than 1 hours"

  missing_security_config_json="$WORK_DIR/deploy-health-missing-security-config-report.json"
  cp "$json_report" "$missing_security_config_json"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const before = data.checks.length;
data.checks = data.checks.filter((item) => !(item.status === "pass" && item.message.startsWith("ALLOWED_ORIGINS")));
if (data.checks.length !== before - 1) throw new Error("Missing ALLOWED_ORIGINS pass to remove");
data.summary.passes -= 1;
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$missing_security_config_json"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$missing_security_config_json" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected deploy health report without ALLOWED_ORIGINS pass to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Missing required passing check: ALLOWED_ORIGINS"

  duplicate_required_json="$WORK_DIR/deploy-health-duplicate-required-report.json"
  cp "$json_report" "$duplicate_required_json"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const check = data.checks.find((item) => item.status === "pass" && item.message.includes("API 容器运行目录可写"));
if (!check) throw new Error("Missing source required check");
data.checks.push({ ...check });
data.summary.passes += 1;
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$duplicate_required_json"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$duplicate_required_json" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected duplicate required check report to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Duplicate required passing check"

  bundled_required_json="$WORK_DIR/deploy-health-bundled-required-report.json"
  cp "$json_report" "$bundled_required_json"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const firstIndex = data.checks.findIndex((item) => item.status === "pass" && item.message.includes("API 容器运行目录可写"));
const secondIndex = data.checks.findIndex((item) => item.status === "pass" && item.message.includes("API 最近日志未发现常见启动错误"));
if (firstIndex < 0 || secondIndex < 0) throw new Error("Missing required checks to bundle");
data.checks[firstIndex].message = `${data.checks[firstIndex].message} ${data.checks[secondIndex].message}`;
data.checks.splice(secondIndex, 1);
data.summary.passes -= 1;
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$bundled_required_json"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$bundled_required_json" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected bundled required check report to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Missing required passing check: API 最近日志未发现常见启动错误"

  non_prefix_required_json="$WORK_DIR/deploy-health-non-prefix-required-report.json"
  cp "$json_report" "$non_prefix_required_json"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const check = data.checks.find((item) => item.status === "pass" && item.message.includes("Docker daemon 可访问"));
if (!check) throw new Error("Missing required check to rewrite");
check.message = `伪造前缀 ${check.message}`;
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$non_prefix_required_json"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$non_prefix_required_json" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected non-prefix required check report to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Missing required passing check: Docker daemon 可访问"

  mismatched_text_report="$WORK_DIR/deploy-health-mismatched-text-report.txt"
  sed 's/环境文件: .env/环境文件: stale.env/' "$report" > "$mismatched_text_report"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" --require-text "$mismatched_text_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected mismatched text report to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Plain-text report env file does not match JSON report"
}

run_show_logs_report_case() {
  report="$WORK_DIR/deploy-health-show-logs-report.txt"
  rm -f "$report"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --show-logs --report "$report" 2>&1)"
  assert_contains "$output" "API 最近日志:"
  assert_contains "$output" "Web 最近日志:"
  assert_contains "$output" "API started successfully"
  assert_contains "$output" "nginx started successfully"
  report_body="$(cat "$report")"
  assert_contains "$report_body" "API 最近日志:"
  assert_contains "$report_body" "Web 最近日志:"
  assert_contains "$report_body" "No pending migrations to apply."
  assert_contains "$report_body" "GET /healthz 200"
}

run_custom_env_file_case() {
  custom_env="$WORK_DIR/custom.env"
  cp "$WORK_DIR/.env" "$custom_env"
  report="$WORK_DIR/deploy-health-custom-env-report.txt"
  rm -f "$report"
  output="$(cd "$WORK_DIR" && REQUIRE_COMPOSE_ENV_FILE=custom.env PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --env-file custom.env --report "$report" 2>&1)"
  assert_contains "$output" "部署自检通过"
  assert_contains "$output" "环境文件: custom.env"
}

run_standalone_compose_case() {
  json_report="$WORK_DIR/deploy-health-standalone-compose-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_DOCKER_COMPOSE_PLUGIN_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "Docker Compose version v2.29.0-standalone"
  assert_contains "$output" "部署自检通过"
  assert_json_report "$json_report" "passed"
  node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.context.composeKind !== "standalone") {
  throw new Error(`Expected standalone composeKind, got ${data.context.composeKind}`);
}
' "$json_report"
}

run_health_failure_case() {
  json_report="$WORK_DIR/deploy-health-failure-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_HEALTH_FAIL=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected health failure case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "健康接口失败"
  if [ ! -s "$json_report" ]; then
    echo "Expected failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$(cat "$json_report")" '"result": "failed"'
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected failed report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "健康接口失败"
}

run_live_failure_case() {
  json_report="$WORK_DIR/deploy-health-live-failure-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_LIVE_FAIL=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected live failure case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "存活接口失败"
  if [ ! -s "$json_report" ]; then
    echo "Expected live failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected live failed report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "存活接口失败"
}

run_web_home_failure_case() {
  json_report="$WORK_DIR/deploy-health-web-home-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_WEB_HOME_FAIL=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected web home failure case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Web 首页入口失败"
  if [ ! -s "$json_report" ]; then
    echo "Expected web-home failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected web-home failed report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Web 首页入口失败"
}

run_web_asset_failure_case() {
  json_report="$WORK_DIR/deploy-health-web-asset-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_WEB_ASSET_FAIL=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected web asset failure case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Web 前端静态资源失败"
  if [ ! -s "$json_report" ]; then
    echo "Expected web-asset failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected web-asset failed report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Web 前端静态资源失败"
}

run_runtime_version_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-version-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_VERSION_FAIL=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-version case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "运行版本接口异常"
  assert_contains "$output" "/api/settings/version"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-version failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-version report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "运行版本接口异常"
}

run_admin_health_access_failure_case() {
  json_report="$WORK_DIR/deploy-health-admin-health-access-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_DEEP_HEALTH_PUBLIC=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected admin-health-access case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "管理健康接口未受保护"
  assert_contains "$output" "/api/health/deep"
  if [ ! -s "$json_report" ]; then
    echo "Expected admin-health-access failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected admin-health-access report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "管理健康接口未受保护"
}

run_sensitive_web_path_exposure_failure_case() {
  json_report="$WORK_DIR/deploy-health-sensitive-web-path-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_SENSITIVE_STATIC_EXPOSED=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected sensitive-web-path case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Web 敏感路径暴露异常"
  assert_contains "$output" "/static/backups/"
  assert_contains "$output" "/static/originals/"
  assert_contains "$output" "/static/drawings/"
  assert_contains "$output" "/uploads/"
  assert_contains "$output" "/_protected_static/"
  assert_contains "$output" "/_protected_uploads/"
  if [ ! -s "$json_report" ]; then
    echo "Expected sensitive-web-path failed deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected sensitive-web-path report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Web 敏感路径暴露异常"
}

run_security_headers_warning_case() {
  json_report="$WORK_DIR/deploy-health-security-headers-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_SECURITY_HEADERS_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    echo "Expected security header warning case to return zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 安全响应头缺失或异常"
  assert_contains "$output" "Web 首页安全响应头缺失或异常"
  assert_contains "$output" "Content-Security-Policy"
  assert_contains "$output" "部署可用，但建议处理警告项"
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected security-header warning report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "API 安全响应头缺失或异常"
}

run_warning_detail_case() {
  json_report="$WORK_DIR/deploy-health-warning-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected warning deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected warning report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "已按参数跳过 API 日志扫描"
  assert_contains "$verify_output" "已按参数跳过 Web 日志扫描"
}

run_env_permission_warning_case() {
  json_report="$WORK_DIR/deploy-health-env-permission-report.json"
  rm -f "$json_report"
  chmod 644 "$WORK_DIR/.env"
  set +e
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  chmod 600 "$WORK_DIR/.env"
  if [ "$status" -ne 0 ]; then
    echo "Expected env-permission warning case to return zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "环境文件权限过宽"
  assert_contains "$output" "chmod 600"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected env-permission deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected env-permission report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "环境文件权限过宽"
}

run_port_listener_warning_case() {
  nginx_json_report="$WORK_DIR/deploy-health-port-nginx-report.json"
  rm -f "$nginx_json_report"
  output="$(cd "$WORK_DIR" && FAKE_PORT_NGINX=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$nginx_json_report" 2>&1)"
  assert_contains "$output" "端口 3780 当前有 nginx 监听"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$nginx_json_report" ]; then
    echo "Expected nginx-port deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$nginx_json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$nginx_json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected nginx-port report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "端口 3780 当前有 nginx 监听"

  no_listener_json_report="$WORK_DIR/deploy-health-port-missing-report.json"
  rm -f "$no_listener_json_report"
  output="$(cd "$WORK_DIR" && FAKE_PORT_NO_LISTENER=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$no_listener_json_report" 2>&1)"
  assert_contains "$output" "宿主机端口 3780 未检测到监听"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$no_listener_json_report" ]; then
    echo "Expected missing-port deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$no_listener_json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$no_listener_json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected missing-port report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "宿主机端口 3780 未检测到监听"
}

run_evidence_collector_case() {
  evidence_dir="$WORK_DIR/evidence"
  evidence_archive="$evidence_dir.tar.gz"
  rm -rf "$evidence_dir" "$evidence_archive"
  mkdir -p "$WORK_DIR/server/static/backups/_safety_snapshots"
  printf '%s\n' 'fake archive bytes' > "$WORK_DIR/server/static/backups/backup_20260526_120000.tar.gz"
  cat > "$WORK_DIR/server/static/backups/backup_20260526_120000.json" <<'EOF'
{
  "id": "backup_20260526_120000",
  "filename": "backup_20260526_120000.tar.gz",
  "name": "DB_PASSWORD=super-secret",
  "scope": "full",
  "scopeLabel": "整站备份",
  "createdAt": "2026-05-26T12:00:00.000Z",
  "fileSize": 18,
  "fileSizeText": "18 B",
  "modelCount": 1,
  "thumbnailCount": 1,
  "dbSize": "1 KB",
  "archiveSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "archiveSignature": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "encrypted": "true",
  "manifestVersion": "3.0",
  "verifiedAt": "2026-05-26T12:01:00.000Z"
}
EOF
  mkdir -p "$WORK_DIR/server/static/backups/.restore-drills"
  checked_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '2026-06-01T00:00:00Z')"
  cat > "$WORK_DIR/server/static/backups/.restore-drills/latest.json" <<EOF
{
  "schemaVersion": 1,
  "tool": "3DPartHub backup restore drill",
  "status": "passed",
  "checkedAt": "${checked_at}",
  "createdBackupId": "backup_20260526_120000",
  "importedBackupId": "backup_20260526_120000_imported",
  "restoredFromBackupId": "backup_20260526_120000_imported"
}
EOF
  printf '%s\n' 'orphan archive bytes' > "$WORK_DIR/server/static/backups/orphan_20260526_120000.tar.gz"
  output="$(cd "$WORK_DIR" && FAKE_API_LOG_SECRET=1 PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$evidence_dir" 2>&1)"
  assert_contains "$output" "证据目录"
  assert_contains "$output" "证据包"
  assert_contains "$output" "证据包SHA256"
  assert_contains "$output" "JSON 报告"
  for file in deploy-health-report.txt deploy-health-report.json compose-ps.txt compose-services.txt api-logs-tail.txt web-logs-tail.txt docker-ps.txt docker-system-df.txt host-resources.txt network-listeners.txt backup-inventory.txt deployment-provenance.txt README.txt manifest.json; do
    if [ ! -s "$evidence_dir/$file" ]; then
      echo "Expected evidence file to exist: $file" >&2
      echo "$output" >&2
      exit 1
    fi
  done
  if [ -e "$evidence_dir/.env" ]; then
    echo "Evidence directory must not include .env" >&2
    exit 1
  fi
  readme_body="$(cat "$evidence_dir/README.txt")"
  manifest_body="$(cat "$evidence_dir/manifest.json")"
  bundle_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!data.bundleId) throw new Error("missing bundleId"); console.log(data.bundleId);' "$evidence_dir/manifest.json")"
  report_bundle_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(data.context && data.context.evidenceBundleId || "");' "$evidence_dir/deploy-health-report.json")"
  if [ "$report_bundle_id" != "$bundle_id" ]; then
    echo "Expected health report evidenceBundleId to match manifest bundleId" >&2
    exit 1
  fi
  assert_contains "$manifest_body" "\"bundleId\""
  assert_contains "$readme_body" "Evidence bundle ID: $bundle_id"
  health_report_body="$(cat "$evidence_dir/deploy-health-report.txt")"
  api_logs_body="$(cat "$evidence_dir/api-logs-tail.txt")"
  web_logs_body="$(cat "$evidence_dir/web-logs-tail.txt")"
  host_resources_body="$(cat "$evidence_dir/host-resources.txt")"
  network_listeners_body="$(cat "$evidence_dir/network-listeners.txt")"
  backup_inventory_body="$(cat "$evidence_dir/backup-inventory.txt")"
  assert_contains "$health_report_body" "证据批次: $bundle_id"
  assert_contains "$health_report_body" "DATABASE_URL=[redacted]"
  assert_contains "$health_report_body" "REDIS_URL=[redacted]"
  assert_contains "$health_report_body" "REDISCLI_AUTH=[redacted]"
  assert_contains "$health_report_body" "Authorization: Bearer [redacted]"
  assert_contains "$api_logs_body" "DATABASE_URL=[redacted]"
  assert_contains "$api_logs_body" "REDIS_URL=[redacted]"
  assert_contains "$api_logs_body" "REDISCLI_AUTH=[redacted]"
  assert_contains "$api_logs_body" "Authorization: Bearer [redacted]"
  assert_contains "$web_logs_body" "== web logs tail =="
  assert_contains "$host_resources_body" "== host resources =="
  assert_contains "$host_resources_body" "== memory =="
  assert_contains "$host_resources_body" "== disk =="
  assert_contains "$host_resources_body" "== inodes =="
  assert_contains "$network_listeners_body" "== network listeners =="
  assert_contains "$network_listeners_body" "Port: 3780"
  assert_contains "$network_listeners_body" "docker-proxy"
  assert_contains "$backup_inventory_body" "== backup inventory =="
  assert_contains "$backup_inventory_body" "Backup dir: ./server/static/backups"
  assert_contains "$backup_inventory_body" "Restore drill: not executed by evidence collector"
  assert_contains "$backup_inventory_body" "Restore drill evidence: status=passed"
  assert_contains "$backup_inventory_body" "restoredFromBackupId=backup_20260526_120000_imported"
  assert_contains "$backup_inventory_body" "record id=backup_20260526_120000"
  assert_contains "$backup_inventory_body" "archive=present"
  assert_contains "$backup_inventory_body" "manifestVersion=3.0"
  assert_contains "$backup_inventory_body" "archiveSha256=present"
  assert_contains "$backup_inventory_body" "archiveSignature=present"
  assert_contains "$backup_inventory_body" "orphan_20260526_120000.tar.gz"
  assert_not_contains "$health_report_body" "super-secret"
  assert_not_contains "$api_logs_body" "super-secret"
  assert_not_contains "$web_logs_body" "super-secret"
  assert_not_contains "$host_resources_body" "super-secret"
  assert_not_contains "$network_listeners_body" "super-secret"
  assert_not_contains "$backup_inventory_body" "super-secret"
  assert_contains "$readme_body" "deploy-evidence-YYYYMMDD-HHMMSS.tar.gz.sha256"
  assert_contains "$readme_body" "npm run deploy:acceptance -- path/to/deploy-evidence.tar.gz"
  assert_contains "$readme_body" "npm run deploy:acceptance -- path/to/deploy-evidence"
  assert_contains "$readme_body" "API logs: api-logs-tail.txt"
  assert_contains "$readme_body" "Web logs: web-logs-tail.txt"
  assert_contains "$readme_body" "Host resources: host-resources.txt"
  assert_contains "$readme_body" "Network listeners: network-listeners.txt"
  assert_contains "$readme_body" "Backup inventory: backup-inventory.txt"
  assert_contains "$readme_body" "--require-text deploy-health-report.txt --allow-report-only"
  assert_contains "$readme_body" "intentionally excludes .env"
  if [ ! -s "$evidence_archive" ]; then
    echo "Expected evidence archive to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  if [ ! -s "$evidence_archive.sha256" ]; then
    echo "Expected evidence archive SHA-256 sidecar to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$(cat "$evidence_archive.sha256")" "$(basename "$evidence_archive")"
  if ! tar -tzf "$evidence_archive" | grep -q 'README.txt'; then
    echo "Expected evidence archive to include README.txt" >&2
    exit 1
  fi
  node "$REPORT_VERIFIER" "$evidence_dir/deploy-health-report.json" --require-text "$evidence_dir/deploy-health-report.txt" >/dev/null
  node "$REPORT_VERIFIER" "$evidence_dir" >/dev/null
  node "$REPORT_VERIFIER" "$evidence_archive" >/dev/null

  tampered_archive="$WORK_DIR/tampered-sidecar-evidence.tar.gz"
  cp "$evidence_archive" "$tampered_archive"
  printf '%s\n' '0000000000000000000000000000000000000000000000000000000000000000  tampered-sidecar-evidence.tar.gz' > "$tampered_archive.sha256"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$tampered_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected archive with mismatched SHA-256 sidecar to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "SHA-256 sidecar mismatch"

  wrong_name_sidecar_archive="$WORK_DIR/wrong-name-sidecar-evidence.tar.gz"
  cp "$evidence_archive" "$wrong_name_sidecar_archive"
  archive_digest="$(awk '{print $1; exit}' "$evidence_archive.sha256")"
  printf '%s  %s\n' "$archive_digest" "other-evidence.tar.gz" > "$wrong_name_sidecar_archive.sha256"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$wrong_name_sidecar_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected archive with wrong-name SHA-256 sidecar to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "does not reference archive name"
  summary_file="$WORK_DIR/deploy-acceptance-summary.md"
  summary_json="$WORK_DIR/deploy-acceptance-summary.json"
  rm -f "$summary_file" "$summary_json"
  summary_output="$(node "$REPORT_VERIFIER" "$evidence_archive" --summary "$summary_file" --summary-json "$summary_json" 2>&1)"
  assert_contains "$summary_output" "acceptance summary written"
  assert_contains "$summary_output" "acceptance summary JSON written"
  if [ ! -s "$summary_file" ]; then
    echo "Expected deploy acceptance summary to be written" >&2
    echo "$summary_output" >&2
    exit 1
  fi
  if [ ! -s "$summary_json" ]; then
    echo "Expected deploy acceptance JSON summary to be written" >&2
    echo "$summary_output" >&2
    exit 1
  fi
  summary_body="$(cat "$summary_file")"
  assert_contains "$summary_body" "3DPartHub 生产部署健康验收摘要"
  assert_contains "$summary_body" "证据批次: $bundle_id"
  assert_contains "$summary_body" "Docker 部署自检、健康报告和生产证据闭环验收通过"
  assert_contains "$summary_body" "生产证据闭环 | 可作为最终生产结论"
  assert_contains "$summary_body" "证据包完整性 | 已验证"
  assert_contains "$summary_body" "归档 SHA-256 | 已验证 .tar.gz.sha256"
  assert_contains "$summary_body" "归档 SHA-256 摘要"
  assert_contains "$summary_body" "版本/镜像追踪 | 已验证"
  assert_contains "$summary_body" "备份库存 | 1 条记录，1 个归档存在，1 条 manifest，1 条哈希，1 条签名，孤儿归档 1 个，恢复演练已记录"
  assert_contains "$summary_body" "备份库存风险 | 低"
  assert_contains "$summary_body" "备份库存闭环 | 已闭环"
  assert_contains "$summary_body" "备份恢复演练 | 已执行"
  assert_contains "$summary_body" "备份目录 | ./server/static/backups"
  assert_contains "$summary_body" "备份库存建议"
  assert_contains "$summary_body" "孤儿备份归档"
  assert_contains "$summary_body" ".env/额外文件/路径/符号链接 | 已拒绝危险内容"
  assert_contains "$summary_body" "剩余风险"
  assert_acceptance_json_summary "$summary_json" "passed" "true" "true"
  node "$REPORT_VERIFIER" "$evidence_archive" --require-final-conclusion >/dev/null
  set +e
  final_output="$(node "$REPORT_VERIFIER" "$evidence_dir/deploy-health-report.json" --require-text "$evidence_dir/deploy-health-report.txt" --require-final-conclusion 2>&1)"
  final_status=$?
  set -e
  if [ "$final_status" -eq 0 ]; then
    echo "Expected report-only verifier input to fail final production conclusion requirement" >&2
    echo "$final_output" >&2
    exit 1
  fi
  assert_contains "$final_output" "not ready for a final production conclusion"
  default_summary="$WORK_DIR/deploy-health-acceptance.md"
  default_summary_json="$WORK_DIR/deploy-health-acceptance.json"
  rm -f "$default_summary" "$default_summary_json"
  acceptance_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$evidence_archive" 2>&1)"
  assert_contains "$acceptance_output" "acceptance summary written"
  assert_contains "$acceptance_output" "acceptance summary JSON written"
  if [ ! -s "$default_summary" ]; then
    echo "Expected default deploy acceptance summary to be written" >&2
    echo "$acceptance_output" >&2
    exit 1
  fi
  if [ ! -s "$default_summary_json" ]; then
    echo "Expected default deploy acceptance JSON summary to be written" >&2
    echo "$acceptance_output" >&2
    exit 1
  fi
  assert_contains "$(cat "$default_summary")" "证据包完整性 | 已验证"
  assert_contains "$(cat "$default_summary")" "归档 SHA-256 | 已验证 .tar.gz.sha256"
  assert_acceptance_json_summary "$default_summary_json" "passed" "true" "true"
  missing_sidecar_archive="$WORK_DIR/missing-sidecar-evidence.tar.gz"
  rm -f "$missing_sidecar_archive" "$missing_sidecar_archive.sha256"
  cp "$evidence_archive" "$missing_sidecar_archive"
  set +e
  missing_sidecar_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$missing_sidecar_archive" --no-summary 2>&1)"
  missing_sidecar_status=$?
  set -e
  if [ "$missing_sidecar_status" -eq 0 ]; then
    echo "Expected deploy acceptance to reject archive without SHA-256 sidecar by default" >&2
    echo "$missing_sidecar_output" >&2
    exit 1
  fi
  assert_contains "$missing_sidecar_output" "默认要求同时回传证据包摘要"
  missing_sidecar_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$missing_sidecar_archive" --allow-missing-sidecar --no-summary 2>&1)"
  assert_contains "$missing_sidecar_output" "Deploy health report verified"
  provenance_body="$(cat "$evidence_dir/deployment-provenance.txt")"
  assert_contains "$provenance_body" "3DPartHub deployment provenance"
  assert_contains "$provenance_body" "Evidence bundle ID: $bundle_id"
  assert_contains "$provenance_body" "IMAGE_TAG"
  assert_contains "$provenance_body" "3dparthub-api"
  assert_contains "$provenance_body" "imageId=sha256"
  assert_not_contains "$provenance_body" "test-db-password-1234567890"
  assert_not_contains "$provenance_body" "test-redis-password-1234567890"
  for container in 3dparthub-api 3dparthub-web 3dparthub-postgres 3dparthub-redis; do
    assert_contains "$provenance_body" "$container"
    case "$container" in
      3dparthub-api)
        assert_contains "$provenance_body" "image=ghcr.io/liaoweixiang2024-blip/3dparthub-api:latest"
        ;;
      3dparthub-web)
        assert_contains "$provenance_body" "image=ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest"
        ;;
      3dparthub-postgres)
        assert_contains "$provenance_body" "image=postgres:16-alpine"
        ;;
      3dparthub-redis)
        assert_contains "$provenance_body" "image=redis:7-alpine"
        ;;
    esac
    assert_contains "$provenance_body" "imageId=sha256:"
    assert_contains "$provenance_body" "status=running"
    assert_contains "$provenance_body" "health=healthy"
    assert_contains "$provenance_body" "restartPolicy=unless-stopped"
    assert_contains "$provenance_body" "restartCount=0"
    assert_contains "$provenance_body" "oom=false"
  done
  set +e
  report_only_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$evidence_dir/deploy-health-report.json" --require-text "$evidence_dir/deploy-health-report.txt" --no-summary 2>&1)"
  report_only_status=$?
  set -e
  if [ "$report_only_status" -eq 0 ]; then
    echo "Expected deploy acceptance to reject report-only input by default" >&2
    echo "$report_only_output" >&2
    exit 1
  fi
  assert_contains "$report_only_output" "默认要求完整 deploy-evidence"
  set +e
  report_only_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$evidence_dir/deploy-health-report.json" --allow-report-only --no-summary 2>&1)"
  report_only_status=$?
  set -e
  if [ "$report_only_status" -eq 0 ]; then
    echo "Expected deploy acceptance to reject report-only input without text report" >&2
    echo "$report_only_output" >&2
    exit 1
  fi
  assert_contains "$report_only_output" "报告模式必须同时提供纯文本报告"
  report_only_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$evidence_dir/deploy-health-report.json" --require-text "$evidence_dir/deploy-health-report.txt" --allow-report-only --no-summary 2>&1)"
  assert_contains "$report_only_output" "Deploy health report verified"
  report_only_summary="$WORK_DIR/report-only-acceptance.md"
  report_only_summary_json="$WORK_DIR/report-only-acceptance.json"
  rm -f "$report_only_summary" "$report_only_summary_json"
  report_only_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$evidence_dir/deploy-health-report.json" --require-text "$evidence_dir/deploy-health-report.txt" --allow-report-only --summary "$report_only_summary" --summary-json "$report_only_summary_json" 2>&1)"
  assert_contains "$report_only_output" "acceptance summary written"
  assert_contains "$(cat "$report_only_summary")" "生产证据闭环 | 仍需完整生产证据"
  assert_acceptance_json_summary "$report_only_summary_json" "passed" "false" "false"

  for missing_backup_field in directoryExists workDirs; do
    missing_backup_field_dir="$WORK_DIR/missing-${missing_backup_field}-backup-field-evidence"
    missing_backup_field_summary="$WORK_DIR/missing-${missing_backup_field}-backup-field-acceptance.md"
    missing_backup_field_summary_json="$WORK_DIR/missing-${missing_backup_field}-backup-field-acceptance.json"
    rm -rf "$missing_backup_field_dir" "$missing_backup_field_summary" "$missing_backup_field_summary_json"
    cp -R "$evidence_dir" "$missing_backup_field_dir"
    case "$missing_backup_field" in
      directoryExists)
        expected_next_action="备份库存证据缺少 directoryExists 摘要"
        ;;
      workDirs)
        expected_next_action="备份库存证据缺少 workDirs 摘要"
        ;;
    esac
    node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const field = process.argv[2];
const file = path.join(dir, "backup-inventory.txt");
const manifestFile = path.join(dir, "manifest.json");
const body = fs.readFileSync(file, "utf8");
const nextBody = body
  .split(/\n/)
  .filter((line) => !line.startsWith(`${field}=`))
  .join("\n");
if (body === nextBody) throw new Error(`Missing test fixture field: ${field}`);
fs.writeFileSync(file, nextBody.endsWith("\n") ? nextBody : `${nextBody}\n`);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const updated = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "backup-inventory.txt");
item.size = updated.length;
item.sha256 = crypto.createHash("sha256").update(updated).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$missing_backup_field_dir" "$missing_backup_field"
    missing_backup_field_output="$(node "$REPORT_VERIFIER" "$missing_backup_field_dir" --summary "$missing_backup_field_summary" --summary-json "$missing_backup_field_summary_json" 2>&1)"
    assert_contains "$missing_backup_field_output" "acceptance summary written"
    assert_contains "$(cat "$missing_backup_field_summary")" "备份库存风险 | 中"
    assert_contains "$(cat "$missing_backup_field_summary")" "备份库存闭环 | 未闭环"
    assert_contains "$(cat "$missing_backup_field_summary")" "$expected_next_action"
    assert_contains "$(cat "$missing_backup_field_summary")" "备份库存风险未关闭"
    EXPECTED_NEXT_ACTION="$expected_next_action" node -e '
const fs = require("fs");
const file = process.argv[1];
const expected = process.env.EXPECTED_NEXT_ACTION || "";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.productionEvidence.finalConclusionReady !== false) {
  throw new Error("Expected final conclusion to be blocked by missing backup inventory field");
}
if (data.productionEvidence.backupInventoryReady !== false || data.productionEvidence.backupInventoryRiskLevel !== "medium") {
  throw new Error("Expected missing backup inventory field to raise medium risk");
}
if (data.backupInventory.riskLevel !== "medium") {
  throw new Error("Expected medium backup inventory risk");
}
if (!data.backupInventory.nextActions.some((item) => item.includes(expected))) {
  throw new Error(`Expected backup inventory next action: ${expected}`);
}
' "$missing_backup_field_summary_json"
    set +e
    missing_backup_field_final_output="$(node "$REPORT_VERIFIER" "$missing_backup_field_dir" --require-final-conclusion 2>&1)"
    missing_backup_field_final_status=$?
    set -e
    if [ "$missing_backup_field_final_status" -eq 0 ]; then
      echo "Expected verifier to reject final conclusion with missing backup inventory field: $missing_backup_field" >&2
      echo "$missing_backup_field_final_output" >&2
      exit 1
    fi
    assert_contains "$missing_backup_field_final_output" "not ready for a final production conclusion"
    assert_contains "$missing_backup_field_final_output" "备份库存风险未关闭"
  done

  work_dir_evidence="$WORK_DIR/work-dir-evidence"
  work_dir_archive="$work_dir_evidence.tar.gz"
  work_dir_summary="$WORK_DIR/work-dir-acceptance.md"
  work_dir_summary_json="$WORK_DIR/work-dir-acceptance.json"
  rm -rf "$WORK_DIR/server/static/backups/.work" "$work_dir_evidence" "$work_dir_archive" "$work_dir_archive.sha256" "$work_dir_summary" "$work_dir_summary_json"
  mkdir -p "$WORK_DIR/server/static/backups/.work/restore_test"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$work_dir_evidence" 2>&1)"
  assert_contains "$output" "证据包"
  work_dir_output="$(node "$REPORT_VERIFIER" "$work_dir_archive" --summary "$work_dir_summary" --summary-json "$work_dir_summary_json" 2>&1)"
  assert_contains "$work_dir_output" "acceptance summary written"
  assert_contains "$(cat "$work_dir_summary")" "备份库存风险 | 中"
  assert_contains "$(cat "$work_dir_summary")" "备份库存闭环 | 未闭环"
  assert_contains "$(cat "$work_dir_summary")" "临时工作目录"
  assert_contains "$(cat "$work_dir_summary")" "备份库存风险未关闭"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.productionEvidence.finalConclusionReady !== false) {
  throw new Error("Expected final conclusion to be blocked by backup work directory");
}
if (data.productionEvidence.backupInventoryReady !== false || data.productionEvidence.backupInventoryRiskLevel !== "medium") {
  throw new Error("Expected backup inventory readiness to be blocked by medium risk from work directory");
}
if (data.backupInventory.workDirCount !== 1 || data.backupInventory.riskLevel !== "medium") {
  throw new Error("Expected backup work directory to raise medium backup risk");
}
if (!data.backupInventory.nextActions.some((item) => item.includes("临时工作目录"))) {
  throw new Error("Expected backup work directory next action");
}
' "$work_dir_summary_json"
  set +e
  work_dir_final_output="$(node "$REPORT_VERIFIER" "$work_dir_archive" --require-final-conclusion 2>&1)"
  work_dir_final_status=$?
  set -e
  if [ "$work_dir_final_status" -eq 0 ]; then
    echo "Expected verifier to reject final conclusion with backup work directory" >&2
    echo "$work_dir_final_output" >&2
    exit 1
  fi
  assert_contains "$work_dir_final_output" "not ready for a final production conclusion"
  assert_contains "$work_dir_final_output" "备份库存风险未关闭"
  set +e
  work_dir_acceptance_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$work_dir_archive" --no-summary 2>&1)"
  work_dir_acceptance_status=$?
  set -e
  if [ "$work_dir_acceptance_status" -eq 0 ]; then
    echo "Expected production acceptance to reject final conclusion with backup work directory" >&2
    echo "$work_dir_acceptance_output" >&2
    exit 1
  fi
  assert_contains "$work_dir_acceptance_output" "备份库存风险未关闭"
  rm -rf "$WORK_DIR/server/static/backups/.work"

  no_restore_dir="$WORK_DIR/no-restore-evidence"
  no_restore_archive="$no_restore_dir.tar.gz"
  no_restore_summary="$WORK_DIR/no-restore-acceptance.md"
  no_restore_summary_json="$WORK_DIR/no-restore-acceptance.json"
  rm -rf "$WORK_DIR/server/static/backups/.restore-drills" "$no_restore_dir" "$no_restore_archive" "$no_restore_archive.sha256" "$no_restore_summary" "$no_restore_summary_json"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$no_restore_dir" 2>&1)"
  assert_contains "$output" "证据包"
  no_restore_output="$(node "$REPORT_VERIFIER" "$no_restore_archive" --allow-warnings --summary "$no_restore_summary" --summary-json "$no_restore_summary_json" 2>&1)"
  assert_contains "$no_restore_output" "acceptance summary written"
  assert_contains "$(cat "$no_restore_summary")" "生产证据闭环 | 仍需完整生产证据"
  assert_contains "$(cat "$no_restore_summary")" "备份库存风险 | 中"
  assert_contains "$(cat "$no_restore_summary")" "备份库存闭环 | 未闭环"
  assert_contains "$(cat "$no_restore_summary")" "备份恢复演练 | 未提供"
  assert_contains "$(cat "$no_restore_summary")" "生产闭环阻断项"
  assert_contains "$(cat "$no_restore_summary")" "备份库存风险未关闭"
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.productionEvidence.finalConclusionReady !== false) {
  throw new Error("Expected final conclusion to be blocked without restore drill evidence");
}
if (data.productionEvidence.backupInventoryReady !== false || data.productionEvidence.backupInventoryRiskLevel !== "medium") {
  throw new Error("Expected backup inventory readiness to be blocked by medium risk");
}
if (data.backupInventory.restoreDrillExecuted !== false || data.backupInventory.riskLevel !== "medium") {
  throw new Error("Expected missing restore drill to raise medium backup risk");
}
if (!data.productionEvidence.finalConclusionBlockers.some((item) => item.includes("备份库存风险未关闭"))) {
  throw new Error("Expected backup inventory blocker");
}
' "$no_restore_summary_json"
  set +e
  no_restore_final_output="$(node "$REPORT_VERIFIER" "$no_restore_archive" --allow-warnings --require-final-conclusion 2>&1)"
  no_restore_final_status=$?
  set -e
  if [ "$no_restore_final_status" -eq 0 ]; then
    echo "Expected verifier to reject final conclusion without restore drill evidence" >&2
    echo "$no_restore_final_output" >&2
    exit 1
  fi
  assert_contains "$no_restore_final_output" "not ready for a final production conclusion"
  assert_contains "$no_restore_final_output" "备份库存风险未关闭"
  set +e
  no_restore_acceptance_output="$(cd "$WORK_DIR" && sh "$ACCEPTANCE_VERIFIER" "$no_restore_archive" --no-summary 2>&1)"
  no_restore_acceptance_status=$?
  set -e
  if [ "$no_restore_acceptance_status" -eq 0 ]; then
    echo "Expected production acceptance to reject final conclusion without restore drill evidence" >&2
    echo "$no_restore_acceptance_output" >&2
    exit 1
  fi
  assert_contains "$no_restore_acceptance_output" "Deploy self-check has warnings"
  assert_contains "$no_restore_acceptance_output" "备份恢复演练证据缺失"
  write_restore_drill_fixture

  large_dir="$WORK_DIR/large-evidence"
  large_archive="$large_dir.tar.gz"
  rm -rf "$large_dir" "$large_archive"
  output="$(cd "$WORK_DIR" && FAKE_LARGE_LOG=1 PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$large_dir" 2>&1)"
  assert_contains "$output" "证据包"
  large_log_size="$(wc -c < "$large_dir/api-logs-tail.txt" | awk '{print $1}')"
  if [ "$large_log_size" -lt 1048576 ]; then
    echo "Expected large evidence log to exceed 1MB, got $large_log_size" >&2
    exit 1
  fi
  node "$REPORT_VERIFIER" "$large_archive" >/dev/null

  tampered_dir="$WORK_DIR/tampered-evidence"
  rm -rf "$tampered_dir"
  cp -R "$evidence_dir" "$tampered_dir"
  printf '%s\n' 'tampered after manifest generation' >> "$tampered_dir/api-logs-tail.txt"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$tampered_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected tampered evidence directory to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "mismatch"

  invalid_provenance_dir="$WORK_DIR/invalid-provenance-evidence"
  rm -rf "$invalid_provenance_dir"
  cp -R "$evidence_dir" "$invalid_provenance_dir"
  printf '%s\n' '3DPartHub deployment provenance' "Evidence bundle ID: $bundle_id" 'DB_PASSWORD=leaked' > "$invalid_provenance_dir/deployment-provenance.txt"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "deployment-provenance.txt");
const manifestFile = path.join(dir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const body = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "deployment-provenance.txt");
item.size = body.length;
item.sha256 = crypto.createHash("sha256").update(body).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$invalid_provenance_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$invalid_provenance_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected invalid provenance evidence directory to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "must not expose secret-like assignment"

  invalid_secret_logs_dir="$WORK_DIR/invalid-secret-logs-evidence"
  rm -rf "$invalid_secret_logs_dir"
  cp -R "$evidence_dir" "$invalid_secret_logs_dir"
  printf '%s\n' 'DATABASE_URL=postgresql://modeluser:leaked-password@postgres:5432/3dparthub' >> "$invalid_secret_logs_dir/api-logs-tail.txt"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "api-logs-tail.txt");
const manifestFile = path.join(dir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const body = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "api-logs-tail.txt");
item.size = body.length;
item.sha256 = crypto.createHash("sha256").update(body).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$invalid_secret_logs_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$invalid_secret_logs_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with secret-like API logs to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "api-logs-tail.txt must not expose secret-like assignment"

  invalid_image_tracking_dir="$WORK_DIR/invalid-image-tracking-evidence"
  rm -rf "$invalid_image_tracking_dir"
  cp -R "$evidence_dir" "$invalid_image_tracking_dir"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "deployment-provenance.txt");
const manifestFile = path.join(dir, "manifest.json");
const body = fs.readFileSync(file, "utf8").replace(/(3dparthub-api[^\n]*?) imageId=sha256:[a-f0-9]+/i, "$1 imageId=missing");
fs.writeFileSync(file, body);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const updated = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "deployment-provenance.txt");
item.size = updated.length;
item.sha256 = crypto.createHash("sha256").update(updated).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$invalid_image_tracking_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$invalid_image_tracking_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with invalid image tracking to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "missing valid imageId for 3dparthub-api"

  invalid_restart_tracking_dir="$WORK_DIR/invalid-restart-tracking-evidence"
  rm -rf "$invalid_restart_tracking_dir"
  cp -R "$evidence_dir" "$invalid_restart_tracking_dir"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "deployment-provenance.txt");
const manifestFile = path.join(dir, "manifest.json");
const body = fs.readFileSync(file, "utf8").replace(/(3dparthub-api[^\n]*?) restartCount=\d+/i, "$1 restartCount=missing");
fs.writeFileSync(file, body);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const updated = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "deployment-provenance.txt");
item.size = updated.length;
item.sha256 = crypto.createHash("sha256").update(updated).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$invalid_restart_tracking_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$invalid_restart_tracking_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with invalid restart tracking to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "missing restartCount for 3dparthub-api"

  invalid_support_dir="$WORK_DIR/invalid-support-evidence"
  rm -rf "$invalid_support_dir"
  cp -R "$evidence_dir" "$invalid_support_dir"
  grep -v '^redis$' "$invalid_support_dir/compose-services.txt" > "$invalid_support_dir/compose-services.txt.tmp"
  mv "$invalid_support_dir/compose-services.txt.tmp" "$invalid_support_dir/compose-services.txt"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "compose-services.txt");
const manifestFile = path.join(dir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const body = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "compose-services.txt");
item.size = body.length;
item.sha256 = crypto.createHash("sha256").update(body).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$invalid_support_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$invalid_support_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with incomplete compose services to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "compose-services.txt is missing line: redis"

  mismatched_bundle_dir="$WORK_DIR/mismatched-bundle-evidence"
  rm -rf "$mismatched_bundle_dir"
  cp -R "$evidence_dir" "$mismatched_bundle_dir"
  sed 's/^Evidence bundle ID: .*/Evidence bundle ID: mismatched-bundle/' "$mismatched_bundle_dir/README.txt" > "$mismatched_bundle_dir/README.txt.tmp"
  mv "$mismatched_bundle_dir/README.txt.tmp" "$mismatched_bundle_dir/README.txt"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "README.txt");
const manifestFile = path.join(dir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const body = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "README.txt");
item.size = body.length;
item.sha256 = crypto.createHash("sha256").update(body).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$mismatched_bundle_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$mismatched_bundle_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with mismatched bundle ID to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "README.txt is missing Evidence bundle ID: $bundle_id"

  mismatched_report_bundle_dir="$WORK_DIR/mismatched-report-bundle-evidence"
  rm -rf "$mismatched_report_bundle_dir"
  cp -R "$evidence_dir" "$mismatched_report_bundle_dir"
  node -e '
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const file = path.join(dir, "deploy-health-report.json");
const report = JSON.parse(fs.readFileSync(file, "utf8"));
report.context.evidenceBundleId = "mismatched-report-bundle";
fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
const manifestFile = path.join(dir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const body = fs.readFileSync(file);
const item = manifest.files.find((entry) => entry.path === "deploy-health-report.json");
item.size = body.length;
item.sha256 = crypto.createHash("sha256").update(body).digest("hex");
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
' "$mismatched_report_bundle_dir"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$mismatched_report_bundle_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with mismatched health report bundle ID to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Plain-text report evidence bundle ID does not match JSON report"

  set +e
  verify_output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$evidence_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence collector to reject a non-empty output directory" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "输出目录已存在且不为空"

  set +e
  verify_output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir ../unsafe-evidence 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence collector to reject a parent-directory output path" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "不安全的输出目录"

  set +e
  verify_output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir ./-bad-evidence 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence collector to reject an option-like output path segment" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "不安全的输出目录"

  symlink_output_target="$WORK_DIR/symlink-output-target"
  symlink_output="$WORK_DIR/symlink-output"
  rm -rf "$symlink_output_target" "$symlink_output"
  mkdir -p "$symlink_output_target"
  ln -s "$symlink_output_target" "$symlink_output"
  set +e
  verify_output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$symlink_output" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence collector to reject a symlink output directory" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "输出目录不能是符号链接"

  missing_dir="$WORK_DIR/missing-evidence"
  missing_archive="$WORK_DIR/missing-evidence.tar.gz"
  rm -rf "$missing_dir" "$missing_archive"
  mkdir -p "$missing_dir"
  for file in deploy-health-report.txt deploy-health-report.json compose-services.txt api-logs-tail.txt web-logs-tail.txt docker-ps.txt docker-system-df.txt host-resources.txt network-listeners.txt backup-inventory.txt deployment-provenance.txt README.txt; do
    cp "$evidence_dir/$file" "$missing_dir/$file"
  done
  (cd "$WORK_DIR" && tar -czf "$missing_archive" missing-evidence)
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$missing_dir" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory missing compose-ps.txt to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "missing compose-ps.txt"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$missing_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence archive missing compose-ps.txt to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "missing compose-ps.txt"

  bad_dir="$WORK_DIR/bad-evidence"
  bad_archive="$WORK_DIR/bad-evidence.tar.gz"
  rm -rf "$bad_dir" "$bad_archive"
  mkdir -p "$bad_dir"
  cp "$evidence_dir/deploy-health-report.json" "$bad_dir/deploy-health-report.json"
  cp "$evidence_dir/deploy-health-report.txt" "$bad_dir/deploy-health-report.txt"
  printf '%s\n' 'DB_PASSWORD=leaked' > "$bad_dir/.env"
  (cd "$WORK_DIR" && tar -czf "$bad_archive" bad-evidence)
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$bad_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence archive with .env to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "must not include .env"

  extra_file_dir_check="$WORK_DIR/extra-file-dir-evidence"
  rm -rf "$extra_file_dir_check"
  cp -R "$evidence_dir" "$extra_file_dir_check"
  printf '%s\n' 'operator note that should not be in evidence bundle' > "$extra_file_dir_check/debug-note.txt"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$extra_file_dir_check" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with extra file to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "unexpected evidence file"

  extra_file_archive_dir="$WORK_DIR/extra-file-archive-evidence"
  extra_file_archive="$WORK_DIR/extra-file-archive-evidence.tar.gz"
  rm -rf "$extra_file_archive_dir" "$extra_file_archive"
  cp -R "$evidence_dir" "$extra_file_archive_dir"
  printf '%s\n' 'operator note that should not be in evidence bundle' > "$extra_file_archive_dir/debug-note.txt"
  (cd "$WORK_DIR" && tar -czf "$extra_file_archive" extra-file-archive-evidence)
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$extra_file_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence archive with extra file to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "unexpected evidence file"

  symlink_dir_check="$WORK_DIR/symlink-dir-evidence"
  rm -rf "$symlink_dir_check"
  cp -R "$evidence_dir" "$symlink_dir_check"
  ln -s deploy-health-report.json "$symlink_dir_check/report-link"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$symlink_dir_check" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence directory with symlink to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "contains symlink"

  symlink_archive_dir="$WORK_DIR/symlink-archive-evidence"
  symlink_archive="$WORK_DIR/symlink-archive-evidence.tar.gz"
  rm -rf "$symlink_archive_dir" "$symlink_archive"
  cp -R "$evidence_dir" "$symlink_archive_dir"
  ln -s deploy-health-report.json "$symlink_archive_dir/report-link"
  (cd "$WORK_DIR" && tar -czf "$symlink_archive" symlink-archive-evidence)
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$symlink_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence archive with symlink to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "unsupported entry type"

  duplicate_dir="$WORK_DIR/duplicate-evidence"
  duplicate_archive="$WORK_DIR/duplicate-evidence.tar.gz"
  rm -rf "$duplicate_dir" "$duplicate_archive"
  mkdir -p "$duplicate_dir/extra"
  cp "$evidence_dir/deploy-health-report.json" "$duplicate_dir/deploy-health-report.json"
  cp "$evidence_dir/deploy-health-report.txt" "$duplicate_dir/deploy-health-report.txt"
  cp "$evidence_dir/deploy-health-report.json" "$duplicate_dir/extra/deploy-health-report.json"
  (cd "$WORK_DIR" && tar -czf "$duplicate_archive" duplicate-evidence)
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$duplicate_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected evidence archive with nested duplicate JSON reports to be rejected" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "nested evidence file"
}

run_evidence_collector_whitespace_backup_case() {
  backup_dir="$WORK_DIR/server/static/backups"
  saved_backup_dir="$WORK_DIR/server/static/backups.saved"
  evidence_dir="$WORK_DIR/space-backup-evidence"
  evidence_archive="$evidence_dir.tar.gz"
  rm -rf "$saved_backup_dir" "$evidence_dir" "$evidence_archive" "$evidence_archive.sha256"
  mv "$backup_dir" "$saved_backup_dir"
  mkdir -p "$backup_dir"
  write_restore_drill_fixture
  printf '%s\n' 'older archive bytes with spaces' > "$backup_dir/zzz older backup 20260526 121000.tar.gz"
  cat > "$backup_dir/zzz older backup 20260526 121000.json" <<'EOF'
{
  "id": "zzz older backup 20260526 121000",
  "filename": "zzz older backup 20260526 121000.tar.gz",
  "name": "较早的含空格文件名备份",
  "scope": "full",
  "scopeLabel": "整站备份",
  "createdAt": "2026-05-26T12:10:00.000Z",
  "fileSize": 31,
  "fileSizeText": "31 B",
  "modelCount": 1,
  "thumbnailCount": 1,
  "dbSize": "1 KB",
  "archiveSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "archiveSignature": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "encrypted": "true",
  "manifestVersion": "3.0",
  "verifiedAt": "2026-05-26T12:11:00.000Z"
}
EOF
  printf '%s\n' 'newer archive bytes with spaces' > "$backup_dir/aaa newer backup 20260526 121500.tar.gz"
  cat > "$backup_dir/aaa newer backup 20260526 121500.json" <<'EOF'
{
  "id": "aaa newer backup 20260526 121500",
  "filename": "aaa newer backup 20260526 121500.tar.gz",
  "name": "含空格文件名备份",
  "scope": "full",
  "scopeLabel": "整站备份",
  "createdAt": "2026-05-26T12:15:00.000Z",
  "fileSize": 31,
  "fileSizeText": "31 B",
  "modelCount": 1,
  "thumbnailCount": 1,
  "dbSize": "1 KB",
  "archiveSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "archiveSignature": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "encrypted": "true",
  "manifestVersion": "3.0",
  "verifiedAt": "2026-05-26T12:16:00.000Z"
}
EOF
  touch -t 202605261210 "$backup_dir/zzz older backup 20260526 121000.json" "$backup_dir/zzz older backup 20260526 121000.tar.gz"
  touch -t 202605261215 "$backup_dir/aaa newer backup 20260526 121500.json" "$backup_dir/aaa newer backup 20260526 121500.tar.gz"

  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$EVIDENCE_COLLECTOR" --output-dir "$evidence_dir" 2>&1)"
  assert_contains "$output" "证据包"
  backup_inventory_body="$(cat "$evidence_dir/backup-inventory.txt")"
  assert_contains "$backup_inventory_body" "record id=aaa newer backup 20260526 121500 archive=present"
  assert_contains "$backup_inventory_body" "record id=zzz older backup 20260526 121000 archive=present"
  assert_contains "$backup_inventory_body" "metadata=aaa newer backup 20260526 121500.json"
  assert_contains "$backup_inventory_body" "name=\"含空格文件名备份\""
  BACKUP_INVENTORY_BODY="$backup_inventory_body" node -e '
const body = process.env.BACKUP_INVENTORY_BODY || "";
const newer = body.indexOf("record id=aaa newer backup 20260526 121500");
const older = body.indexOf("record id=zzz older backup 20260526 121000");
if (newer < 0 || older < 0 || newer > older) {
  throw new Error("Expected backup inventory records to be sorted by mtime descending");
}
'
  node "$REPORT_VERIFIER" "$evidence_archive" >/dev/null

  rm -rf "$backup_dir"
  mv "$saved_backup_dir" "$backup_dir"
}

run_no_docker_evidence_case() {
  evidence_dir="$WORK_DIR/no-docker-evidence"
  evidence_archive="$evidence_dir.tar.gz"
  rm -rf "$evidence_dir" "$evidence_archive"
  set +e
  output="$(cd "$WORK_DIR" && DEPLOY_HEALTH_DISABLE_DOCKER=1 PATH="$NO_DOCKER_BIN:/usr/bin:/bin:/usr/sbin:/sbin" sh "$EVIDENCE_COLLECTOR" --output-dir "$evidence_dir" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected evidence collector without docker to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "未找到 docker 命令"
  for file in deploy-health-report.txt deploy-health-report.json compose-ps.txt compose-services.txt api-logs-tail.txt web-logs-tail.txt docker-ps.txt docker-system-df.txt host-resources.txt network-listeners.txt backup-inventory.txt deployment-provenance.txt README.txt manifest.json; do
    if [ ! -s "$evidence_dir/$file" ]; then
      echo "Expected no-docker evidence file to exist: $file" >&2
      echo "$output" >&2
      exit 1
    fi
  done
  assert_contains "$(cat "$evidence_dir/docker-ps.txt")" "docker command not available"
  if [ ! -s "$evidence_archive" ]; then
    echo "Expected no-docker evidence archive to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$evidence_archive" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected no-docker evidence archive to be rejected by health verifier" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Docker daemon"
}

run_docker_down_case() {
  set +e
  output="$(cd "$WORK_DIR" && FAKE_DOCKER_DOWN=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected docker-down case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Docker daemon 不可访问"
  assert_contains "$output" "跳过容器状态细查"
  assert_not_contains "$output" "3dparthub-api 不存在"
}

run_unhealthy_container_case() {
  set +e
  output="$(cd "$WORK_DIR" && FAKE_API_UNHEALTHY=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected unhealthy-container case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "3dparthub-api 健康检查未通过（unhealthy"
}

run_missing_healthcheck_case() {
  json_report="$WORK_DIR/deploy-health-missing-healthcheck-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_API_NO_HEALTH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "3dparthub-api 正在运行但未配置 healthcheck"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected missing-healthcheck deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected missing-healthcheck report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "未配置 healthcheck"
}

run_compose_policy_warning_case() {
  json_report="$WORK_DIR/deploy-health-compose-policy-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_MISSING_API_HEALTHCHECK=1 FAKE_COMPOSE_MISSING_WEB_RESTART=1 FAKE_COMPOSE_MISSING_LOGGING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "Compose 服务 api 未声明 healthcheck"
  assert_contains "$output" "Compose 服务 web 未设置 restart: unless-stopped"
  assert_contains "$output" "Compose 日志轮转未完整配置"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-policy deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-policy report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "未声明 healthcheck"
  assert_contains "$verify_output" "未设置 restart: unless-stopped"
  assert_contains "$verify_output" "日志轮转未完整配置"
}

run_redis_healthcheck_auth_failure_case() {
  json_report="$WORK_DIR/deploy-health-redis-healthcheck-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_REDIS_HEALTHCHECK_NO_AUTH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected redis-healthcheck-auth case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose Redis healthcheck 未使用认证 ping"
  if [ ! -s "$json_report" ]; then
    echo "Expected redis-healthcheck deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected redis-healthcheck report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose Redis healthcheck 未使用认证 ping"
}

run_prisma_migration_failure_case() {
  json_report="$WORK_DIR/deploy-health-prisma-migration-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_PRISMA_MIGRATION_PENDING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected prisma-migration case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "数据库迁移状态异常"
  assert_contains "$output" "not yet been applied"
  if [ ! -s "$json_report" ]; then
    echo "Expected prisma-migration deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected prisma-migration report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "数据库迁移状态异常"
}

run_resource_budget_failure_case() {
  json_report="$WORK_DIR/deploy-health-resource-budget-report.json"
  bad_env="$WORK_DIR/resource-overcommit.env"
  cp "$WORK_DIR/.env" "$bad_env"
  cat >> "$bad_env" <<'EOF'
API_MEMORY_LIMIT=2G
API_WORKERS=4
API_SHM_SIZE=2G
CONVERSION_WORKER_CONCURRENCY=3
POSTGRES_MEMORY_LIMIT=1G
REDIS_MEMORY_LIMIT=512M
REDIS_MAXMEMORY=1G
WEB_MEMORY_LIMIT=512M
DB_CONNECTION_LIMIT=30
EOF
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --env-file "$bad_env" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected resource-budget case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "资源配置超过当前内存档位"
  assert_contains "$output" "API_WORKERS=4"
  assert_contains "$output" "REDIS_MAXMEMORY=1024MB 大于 REDIS_MEMORY_LIMIT=512MB"
  if [ ! -s "$json_report" ]; then
    echo "Expected resource-budget deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected resource-budget report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "资源配置超过当前内存档位"
}

run_compose_volume_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-volume-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_MISSING_BACKUP_MOUNT=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-volume case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 持久化挂载缺失"
  assert_contains "$output" "api ./server/static/backups -> /app/static/backups"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-volume deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-volume report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 持久化挂载缺失"
}

run_compose_web_port_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-web-port-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_WEB_PORT_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-web-port case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose Web 端口映射缺失或异常"
  assert_contains "$output" "web.ports"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-web-port deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-web-port report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose Web 端口映射缺失或异常"
}

run_compose_private_port_exposure_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-private-port-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_PRIVATE_PORT_EXPOSED=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-private-port case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 端口暴露异常"
  assert_contains "$output" "api.ports"
  assert_contains "$output" "API/PostgreSQL/Redis"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-private-port deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-private-port report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 端口暴露异常"
}

run_compose_api_env_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-api-env-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_API_ENV_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-api-env case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose API 关键环境缺失"
  assert_contains "$output" "API CORS 允许来源"
  assert_contains "$output" "api.environment"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-api-env deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  assert_not_contains "$(cat "$json_report")" "test-db-password-1234567890"
  assert_not_contains "$(cat "$json_report")" "test-redis-password-1234567890"
  assert_not_contains "$(cat "$json_report")" "test-backup-signing-secret-1234567890"
  assert_not_contains "$(cat "$json_report")" "test-backup-encryption-secret-1234567890"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-api-env report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose API 关键环境缺失"
}

run_compose_image_source_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-image-source-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_IMAGE_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-image-source case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 镜像来源异常"
  assert_contains "$output" "web"
  assert_contains "$output" "IMAGE_TAG"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-image-source deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-image-source report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 镜像来源异常"
}

run_compose_duplicate_key_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-duplicate-key-report.json"
  duplicate_compose="$WORK_DIR/docker-compose-duplicate-key.yml"
  rm -f "$json_report" "$duplicate_compose"
  cat > "$duplicate_compose" <<'EOF'
services:
  web:
    image: ghcr.io/liaoweixiang2024-blip/3dparthub-web:latest
    restart: unless-stopped
    restart: always
EOF
  set +e
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --compose-file "$duplicate_compose" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-duplicate-key case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 服务键重复"
  assert_contains "$output" "web.restart"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-duplicate-key deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-duplicate-key report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 服务键重复"
}

run_compose_resource_controls_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-resource-controls-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_RESOURCE_LIMITS_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-resource-controls case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 资源限制缺失"
  assert_contains "$output" "web"
  assert_contains "$output" "mem_limit"
  assert_contains "$output" "cpus"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-resource-controls deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-resource-controls report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 资源限制缺失"
}

run_compose_api_stop_grace_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-api-stop-grace-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_API_STOP_GRACE_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-api-stop-grace case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose API 停止宽限期缺失或过短"
  assert_contains "$output" "stop_grace_period"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-api-stop-grace deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-api-stop-grace report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose API 停止宽限期缺失或过短"
}

run_compose_internal_network_failure_case() {
  json_report="$WORK_DIR/deploy-health-compose-internal-network-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_COMPOSE_INTERNAL_NETWORK_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected compose-internal-network case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Compose 内部网络缺失"
  assert_contains "$output" "networks.internal"
  if [ ! -s "$json_report" ]; then
    echo "Expected compose-internal-network deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected compose-internal-network report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Compose 内部网络缺失"
}

run_runtime_mount_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-mount-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_MISSING_BACKUP_MOUNT=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-mount case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "容器挂载缺失或读写状态异常"
  assert_contains "$output" "api ./server/static/backups -> /app/static/backups"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-mount deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-mount report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "容器挂载缺失或读写状态异常"
}

run_web_port_binding_failure_case() {
  json_report="$WORK_DIR/deploy-health-web-port-binding-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_WEB_PORT_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected web-port-binding case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Web 容器端口映射异常"
  assert_contains "$output" "3799"
  assert_contains "$output" "docker compose up -d --force-recreate web"
  if [ ! -s "$json_report" ]; then
    echo "Expected web-port-binding deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected web-port-binding report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Web 容器端口映射异常"
}

run_runtime_private_port_exposure_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-private-port-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_PRIVATE_PORT_EXPOSED=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-private-port case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "运行容器端口暴露异常"
  assert_contains "$output" "3dparthub-api"
  assert_contains "$output" "0.0.0.0:8000"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-private-port deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-private-port report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "运行容器端口暴露异常"
}

run_runtime_env_mismatch_case() {
  json_report="$WORK_DIR/deploy-health-runtime-env-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_ENV_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-env case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "容器环境与 .env 不一致"
  assert_contains "$output" "API DATABASE_URL 使用 DB_PASSWORD"
  assert_contains "$output" "PostgreSQL POSTGRES_PASSWORD 使用 DB_PASSWORD"
  assert_contains "$output" "API REDIS_URL 使用 REDIS_PASSWORD"
  assert_contains "$output" "API BACKUP_SIGNING_SECRET"
  assert_contains "$output" "API BACKUP_ENCRYPTION_SECRET"
  assert_contains "$output" "API CORS 允许来源"
  assert_contains "$output" "容器启动参数与 .env 不一致"
  assert_not_contains "$output" "old-db-password"
  assert_not_contains "$output" "test-db-password-1234567890"
  assert_not_contains "$output" "old-backup-signing-secret"
  assert_not_contains "$output" "test-backup-signing-secret-1234567890"
  assert_not_contains "$output" "old-backup-encryption-secret"
  assert_not_contains "$output" "test-backup-encryption-secret-1234567890"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-env deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  assert_not_contains "$(cat "$json_report")" "test-db-password-1234567890"
  assert_not_contains "$(cat "$json_report")" "old-db-password"
  assert_not_contains "$(cat "$json_report")" "test-backup-signing-secret-1234567890"
  assert_not_contains "$(cat "$json_report")" "old-backup-signing-secret"
  assert_not_contains "$(cat "$json_report")" "test-backup-encryption-secret-1234567890"
  assert_not_contains "$(cat "$json_report")" "old-backup-encryption-secret"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-env report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "容器环境与 .env 不一致"
}

run_api_process_root_failure_case() {
  json_report="$WORK_DIR/deploy-health-api-process-user-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_API_PROCESS_ROOT=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected api-process-root case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 应用进程以 root 运行"
  if [ ! -s "$json_report" ]; then
    echo "Expected api-process-root deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected api-process-root report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "API 应用进程以 root 运行"
}

run_restore_drill_missing_warning_case() {
  json_report="$WORK_DIR/deploy-health-restore-drill-missing-report.json"
  rm -f "$json_report"
  rm -rf "$WORK_DIR/server/static/backups/.restore-drills"
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  assert_contains "$output" "备份恢复演练证据缺失"
  assert_contains "$output" "docker compose exec api npm run backup:e2e"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected restore-drill-missing deploy health JSON report to be written" >&2
    echo "$output" >&2
    write_restore_drill_fixture
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  write_restore_drill_fixture
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected restore-drill-missing report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "备份恢复演练证据缺失"
}

run_backup_disk_warning_case() {
  json_report="$WORK_DIR/deploy-health-backup-disk-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_BACKUP_DISK_LOW=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  assert_contains "$output" "备份目录磁盘剩余不足 5GB"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected backup-disk deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected backup-disk report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "备份目录磁盘剩余不足 5GB"
}

run_backup_inode_warning_case() {
  json_report="$WORK_DIR/deploy-health-backup-inode-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_BACKUP_INODE_LOW=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  assert_contains "$output" "备份目录 inode 剩余偏低"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected backup-inode deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected backup-inode report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "备份目录 inode 剩余偏低"
}

run_docker_data_root_disk_failure_case() {
  json_report="$WORK_DIR/deploy-health-docker-root-disk-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_DOCKER_DISK_LOW=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected docker data root disk case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Docker 数据目录磁盘剩余不足"
  if [ ! -s "$json_report" ]; then
    echo "Expected docker-data-root-disk deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected docker-data-root-disk report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Docker 数据目录磁盘剩余不足"
}

run_api_data_volume_capacity_failure_case() {
  json_report="$WORK_DIR/deploy-health-api-data-volume-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_API_DATA_VOLUME_LOW=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected api-data-volume-capacity case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 数据卷容量不足"
  assert_contains "$output" "/app/uploads"
  if [ ! -s "$json_report" ]; then
    echo "Expected api-data-volume-capacity deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected api-data-volume-capacity report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "API 数据卷容量不足"
}

run_backup_dir_unwritable_case() {
  json_report="$WORK_DIR/deploy-health-backup-dir-unwritable-report.json"
  rm -f "$json_report"
  chmod 555 "$WORK_DIR/server/static/backups"
  set +e
  output="$(cd "$WORK_DIR" && PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs --json "$json_report" 2>&1)"
  status=$?
  set -e
  chmod 755 "$WORK_DIR/server/static/backups"
  if [ "$status" -eq 0 ]; then
    echo "Expected backup-dir-unwritable case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "宿主机备份目录不可写"
  assert_contains "$output" "无法创建探针文件"
  if [ ! -s "$json_report" ]; then
    echo "Expected backup-dir-unwritable deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected backup-dir-unwritable report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "宿主机备份目录不可写"
}

run_container_restart_warning_case() {
  json_report="$WORK_DIR/deploy-health-container-restart-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_API_RESTARTED=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "3dparthub-api 最近发生过 OOMKilled"
  assert_contains "$output" "3dparthub-api 重启次数较高"
  assert_contains "$output" "restartCount=7"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected container-restart deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected container-restart report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "OOMKilled"
  assert_contains "$verify_output" "重启次数较高"
}

run_image_tag_mismatch_warning_case() {
  json_report="$WORK_DIR/deploy-health-image-tag-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_API_OLD_IMAGE=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "运行镜像标签与 IMAGE_TAG 不一致"
  assert_contains "$output" "3dparthub-api=ghcr.io/liaoweixiang2024-blip/3dparthub-api:v3.1.0"
  assert_contains "$output" "docker compose pull"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected image-tag deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected image-tag report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "运行镜像标签与 IMAGE_TAG 不一致"
}

run_runtime_image_source_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-image-source-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_IMAGE_SOURCE_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-image-source case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "运行镜像来源异常"
  assert_contains "$output" "3dparthub-api=ghcr.io/example/wrong-api:latest"
  assert_contains "$output" "3DPartHub GHCR"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-image-source deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-image-source report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "运行镜像来源异常"
}

run_runtime_logging_warning_case() {
  json_report="$WORK_DIR/deploy-health-runtime-logging-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_LOGGING_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "容器日志轮转未完整生效"
  assert_contains "$output" "docker compose up -d --force-recreate"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-logging deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-logging report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "容器日志轮转未完整生效"
}

run_runtime_restart_policy_warning_case() {
  json_report="$WORK_DIR/deploy-health-runtime-restart-policy-report.json"
  rm -f "$json_report"
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_RESTART_POLICY_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  assert_contains "$output" "容器重启策略未完整生效"
  assert_contains "$output" "restart: unless-stopped"
  assert_contains "$output" "docker compose up -d --force-recreate"
  assert_contains "$output" "部署可用，但建议处理警告项"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-restart-policy deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "warning"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-restart-policy report verifier to return non-zero without --allow-warnings" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check has warnings"
  assert_contains "$verify_output" "容器重启策略未完整生效"
}

run_runtime_api_stop_timeout_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-api-stop-timeout-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_STOP_TIMEOUT_SHORT=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-api-stop-timeout case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 停止宽限期过短"
  assert_contains "$output" "StopTimeout=10s"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-api-stop-timeout deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-api-stop-timeout report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "API 停止宽限期过短"
}

run_runtime_resource_limits_failure_case() {
  json_report="$WORK_DIR/deploy-health-runtime-resource-limits-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_RESOURCE_LIMITS_MISSING=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-resource-limits case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "容器资源限制未完整生效"
  assert_contains "$output" "3dparthub-api"
  assert_contains "$output" "mem_limit/cpus"
  assert_contains "$output" "docker compose up -d --force-recreate"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-resource-limits deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-resource-limits report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "容器资源限制未完整生效"
}

run_runtime_resource_limits_mismatch_case() {
  json_report="$WORK_DIR/deploy-health-runtime-resource-limits-mismatch-report.json"
  rm -f "$json_report"
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_RESOURCE_LIMITS_MISMATCH=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$json_report" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-resource-limits-mismatch case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "容器资源限制未完整生效或与 .env 不一致"
  assert_contains "$output" "api=mismatch"
  assert_contains "$output" "docker compose up -d --force-recreate"
  if [ ! -s "$json_report" ]; then
    echo "Expected runtime-resource-limits-mismatch deploy health JSON report to be written" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_json_report "$json_report" "failed"
  set +e
  verify_output="$(node "$REPORT_VERIFIER" "$json_report" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected runtime-resource-limits-mismatch report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "容器资源限制未完整生效或与 .env 不一致"
}

run_api_log_error_case() {
  set +e
  output="$(cd "$WORK_DIR" && FAKE_API_LOG_ERROR=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected api-log-error case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 最近日志包含常见启动错误"
  assert_contains "$output" "password authentication failed"
}

run_web_log_error_case() {
  set +e
  output="$(cd "$WORK_DIR" && FAKE_WEB_LOG_ERROR=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected web-log-error case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "Web 最近日志包含常见入口错误"
  assert_contains "$output" "default.conf failed"
  set +e
  verify_output="$(cd "$WORK_DIR" && FAKE_WEB_LOG_ERROR=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --json "$WORK_DIR/deploy-health-web-log-error-report.json" 2>/dev/null; node "$REPORT_VERIFIER" "$WORK_DIR/deploy-health-web-log-error-report.json" 2>&1)"
  verify_status=$?
  set -e
  if [ "$verify_status" -eq 0 ]; then
    echo "Expected web-log-error report verifier to return non-zero" >&2
    echo "$verify_output" >&2
    exit 1
  fi
  assert_contains "$verify_output" "Deploy self-check failed"
  assert_contains "$verify_output" "Web 最近日志包含常见入口错误"
}

run_runtime_dir_failure_case() {
  set +e
  output="$(cd "$WORK_DIR" && FAKE_RUNTIME_DIR_BAD=1 PATH="$FAKE_BIN:$PATH" sh "$SCRIPT" --no-logs 2>&1)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "Expected runtime-dir failure case to return non-zero" >&2
    echo "$output" >&2
    exit 1
  fi
  assert_contains "$output" "API 容器运行目录不可写或缺失"
  assert_contains "$output" "not_writable:/app/static/backups"
}

run_case "healthy deployment report" run_healthy_case
run_case "show logs report" run_show_logs_report_case
run_case "custom env file compose report" run_custom_env_file_case
run_case "standalone docker-compose report" run_standalone_compose_case
run_case "health endpoint failure report" run_health_failure_case
run_case "live endpoint failure report" run_live_failure_case
run_case "web home failure report" run_web_home_failure_case
run_case "web asset failure report" run_web_asset_failure_case
run_case "runtime version failure report" run_runtime_version_failure_case
run_case "admin health access failure report" run_admin_health_access_failure_case
run_case "sensitive web path exposure failure report" run_sensitive_web_path_exposure_failure_case
run_case "security headers warning report" run_security_headers_warning_case
run_case "warning detail report" run_warning_detail_case
run_case "env permission warning report" run_env_permission_warning_case
run_case "port listener warning report" run_port_listener_warning_case
run_case "evidence collector report" run_evidence_collector_case
run_case "evidence collector whitespace backup report" run_evidence_collector_whitespace_backup_case
run_case "no docker evidence collector report" run_no_docker_evidence_case
run_case "docker daemon down report" run_docker_down_case
run_case "unhealthy container report" run_unhealthy_container_case
run_case "missing healthcheck warning report" run_missing_healthcheck_case
run_case "compose policy warning report" run_compose_policy_warning_case
run_case "redis healthcheck auth failure report" run_redis_healthcheck_auth_failure_case
run_case "prisma migration failure report" run_prisma_migration_failure_case
run_case "resource budget failure report" run_resource_budget_failure_case
run_case "compose volume failure report" run_compose_volume_failure_case
run_case "compose web port failure report" run_compose_web_port_failure_case
run_case "compose private port exposure failure report" run_compose_private_port_exposure_failure_case
run_case "compose api env failure report" run_compose_api_env_failure_case
run_case "compose image source failure report" run_compose_image_source_failure_case
run_case "compose duplicate key failure report" run_compose_duplicate_key_failure_case
run_case "compose resource controls failure report" run_compose_resource_controls_failure_case
run_case "compose api stop grace failure report" run_compose_api_stop_grace_failure_case
run_case "compose internal network failure report" run_compose_internal_network_failure_case
run_case "runtime mount failure report" run_runtime_mount_failure_case
run_case "web port binding failure report" run_web_port_binding_failure_case
run_case "runtime private port exposure failure report" run_runtime_private_port_exposure_failure_case
run_case "runtime env mismatch report" run_runtime_env_mismatch_case
run_case "api process root failure report" run_api_process_root_failure_case
run_case "restore drill missing warning report" run_restore_drill_missing_warning_case
run_case "backup disk warning report" run_backup_disk_warning_case
run_case "backup inode warning report" run_backup_inode_warning_case
run_case "docker data root disk failure report" run_docker_data_root_disk_failure_case
run_case "api data volume capacity failure report" run_api_data_volume_capacity_failure_case
run_case "backup dir unwritable report" run_backup_dir_unwritable_case
run_case "container restart warning report" run_container_restart_warning_case
run_case "image tag mismatch warning report" run_image_tag_mismatch_warning_case
run_case "runtime image source failure report" run_runtime_image_source_failure_case
run_case "runtime logging warning report" run_runtime_logging_warning_case
run_case "runtime restart policy warning report" run_runtime_restart_policy_warning_case
run_case "runtime api stop timeout failure report" run_runtime_api_stop_timeout_failure_case
run_case "runtime resource limits failure report" run_runtime_resource_limits_failure_case
run_case "runtime resource limits mismatch report" run_runtime_resource_limits_mismatch_case
run_case "api log error report" run_api_log_error_case
run_case "web log error report" run_web_log_error_case
run_case "runtime directory failure report" run_runtime_dir_failure_case

echo "deploy-health-check tests passed."
