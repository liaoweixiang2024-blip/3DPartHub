#!/bin/sh
set -eu

ENV_FILE=".env"
APPLY_RUNTIME_LIMITS=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      shift
      ENV_FILE="${1:-.env}"
      ;;
    --no-runtime|--no-apply)
      APPLY_RUNTIME_LIMITS=0
      ;;
    *)
      ENV_FILE="$1"
      ;;
  esac
  shift || true
done

detect_total_mb() {
  if command -v free >/dev/null 2>&1; then
    free -m | awk '/^Mem:/ {print $2; exit}'
    return
  fi
  if [ -r /proc/meminfo ]; then
    awk '/MemTotal:/ {printf "%d\n", $2 / 1024; exit}' /proc/meminfo
    return
  fi
  if command -v sysctl >/dev/null 2>&1; then
    bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
    if [ "$bytes" -gt 0 ] 2>/dev/null; then
      echo $((bytes / 1024 / 1024))
      return
    fi
  fi
  echo 4096
}

upsert_env() {
  key="$1"
  value="$2"
  touch "$ENV_FILE"
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
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

total_mb="$(detect_total_mb)"

if [ "$total_mb" -lt 6144 ]; then
  profile="4G"
  api_memory="2G"
  api_reservation="512M"
  api_cpu="1.5"
  api_workers="1"
  api_shm="512M"
  conversion_workers="1"
  postgres_memory="768M"
  postgres_cpu="1"
  redis_memory="256M"
  redis_cpu="0.5"
  redis_maxmemory="192mb"
  web_memory="256M"
  web_cpu="0.5"
  db_connections="5"
elif [ "$total_mb" -lt 12288 ]; then
  profile="8G"
  api_memory="4G"
  api_reservation="1G"
  api_cpu="2"
  api_workers="2"
  api_shm="1G"
  conversion_workers="1"
  postgres_memory="1G"
  postgres_cpu="1"
  redis_memory="512M"
  redis_cpu="0.5"
  redis_maxmemory="384mb"
  web_memory="512M"
  web_cpu="0.75"
  db_connections="10"
elif [ "$total_mb" -lt 24576 ]; then
  profile="16G"
  api_memory="8G"
  api_reservation="2G"
  api_cpu="3"
  api_workers="3"
  api_shm="2G"
  conversion_workers="2"
  postgres_memory="2G"
  postgres_cpu="2"
  redis_memory="1G"
  redis_cpu="1"
  redis_maxmemory="768mb"
  web_memory="512M"
  web_cpu="1"
  db_connections="15"
else
  profile="32G"
  api_memory="12G"
  api_reservation="3G"
  api_cpu="4"
  api_workers="4"
  api_shm="4G"
  conversion_workers="2"
  postgres_memory="4G"
  postgres_cpu="2"
  redis_memory="2G"
  redis_cpu="1"
  redis_maxmemory="1536mb"
  web_memory="1G"
  web_cpu="1"
  db_connections="20"
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

echo "Detected memory: ${total_mb}MB"
echo "Applied 3DPartHub resource profile: ${profile}"
echo "Updated: ${ENV_FILE}"

update_container_limits() {
  container="$1"
  memory="$2"
  reservation="$3"
  cpus="$4"

  if ! docker container inspect "$container" >/dev/null 2>&1; then
    echo "Skipped ${container}: container not found"
    return
  fi

  if [ -n "$reservation" ]; then
    if docker update --memory "$memory" --memory-reservation "$reservation" --cpus "$cpus" "$container" >/dev/null 2>&1; then
      echo "Updated ${container}: memory=${memory}, reservation=${reservation}, cpus=${cpus}"
    else
      echo "Warning: failed to update ${container}; check whether current usage is higher than the new limit"
    fi
  else
    if docker update --memory "$memory" --cpus "$cpus" "$container" >/dev/null 2>&1; then
      echo "Updated ${container}: memory=${memory}, cpus=${cpus}"
    else
      echo "Warning: failed to update ${container}; check whether current usage is higher than the new limit"
    fi
  fi
}

apply_runtime_limits() {
  if [ "$APPLY_RUNTIME_LIMITS" != "1" ]; then
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Runtime limits skipped: docker command not found"
    return
  fi

  echo "Applying runtime limits to existing containers..."
  update_container_limits "3dparthub-api" "$api_memory" "$api_reservation" "$api_cpu"
  update_container_limits "3dparthub-web" "$web_memory" "" "$web_cpu"
  update_container_limits "3dparthub-postgres" "$postgres_memory" "" "$postgres_cpu"
  update_container_limits "3dparthub-redis" "$redis_memory" "" "$redis_cpu"

  if docker container inspect 3dparthub-redis >/dev/null 2>&1; then
    if docker exec 3dparthub-redis redis-cli CONFIG SET maxmemory "$redis_maxmemory" >/dev/null 2>&1; then
      echo "Updated 3dparthub-redis: maxmemory=${redis_maxmemory}"
    else
      echo "Warning: failed to update Redis maxmemory at runtime"
    fi
  fi

  echo "Note: API_WORKERS, API_SHM_SIZE and DB_CONNECTION_LIMIT are saved to .env and take effect after recreating api."
}

apply_runtime_limits
