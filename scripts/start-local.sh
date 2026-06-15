#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.local.yml"
SERVER_PID=""
CLIENT_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] || [ -n "$CLIENT_PID" ]; then
    kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

start_colima() {
  if command -v colima >/dev/null 2>&1; then
    colima start
  fi
}

container_exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

restart_or_create_data_services() {
  missing_services=()

  if container_exists 3dparthub-postgres; then
    echo "Restarting existing 3dparthub-postgres..."
    docker restart 3dparthub-postgres >/dev/null
  else
    missing_services+=("postgres")
  fi

  if container_exists 3dparthub-redis; then
    echo "Restarting existing 3dparthub-redis..."
    docker restart 3dparthub-redis >/dev/null
  else
    missing_services+=("redis")
  fi

  if [ "${#missing_services[@]}" -gt 0 ]; then
    echo "Creating missing local data services: ${missing_services[*]}"
    docker compose -f "$COMPOSE_FILE" up -d "${missing_services[@]}"
  fi
}

wait_for_data_services() {
  echo "Waiting for PostgreSQL and Redis..."
  for _ in $(seq 1 30); do
    if docker exec 3dparthub-postgres pg_isready -U modeluser -d 3dparthub >/dev/null 2>&1 \
      && docker exec 3dparthub-redis redis-cli ping >/dev/null 2>&1; then
      echo "Local data services are ready."
      return
    fi
    sleep 2
  done

  echo "Local data services did not become ready in time."
  docker ps --filter name=3dparthub-postgres --filter name=3dparthub-redis
  exit 1
}

read_server_database_config() {
  node -e '
const fs = require("fs");
const envFile = process.argv[1];
const content = fs.readFileSync(envFile, "utf8");
let databaseUrl = "";
for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
  if (!match) continue;
  databaseUrl = match[1].trim().replace(/^["'\'']|["'\'']$/g, "");
}
if (!databaseUrl) process.exit(1);
const url = new URL(databaseUrl);
const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
process.stdout.write([decodeURIComponent(url.username), decodeURIComponent(url.password), dbName].join("\t"));
' "$ROOT_DIR/server/.env"
}

postgres_container_network() {
  docker inspect 3dparthub-postgres --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' 2>/dev/null | sed -n '1p'
}

# The POSTGRES_PASSWORD the container was started with — i.e. the password the
# volume was initialized with. Used as a fallback to repair credentials without
# ever deleting the data volume.
postgres_container_env_password() {
  docker inspect 3dparthub-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^POSTGRES_PASSWORD=//p' | head -1
}

postgres_password_reset_sql() {
  node - "$1" "$2" <<'NODE'
const [user, password] = process.argv.slice(2);
const ident = (value) => `"${String(value).replace(/"/g, '""')}"`;
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;
process.stdout.write(`ALTER USER ${ident(user)} WITH PASSWORD ${literal(password)};`);
NODE
}

verify_or_repair_postgres_credentials() {
  local config db_user db_password db_name network reset_sql
  config="$(read_server_database_config 2>/dev/null || true)"
  if [ -z "$config" ]; then
    echo "Skipping PostgreSQL password check: server/.env DATABASE_URL is missing or invalid."
    return
  fi

  db_user="$(printf '%s' "$config" | awk -F '\t' '{print $1}')"
  db_password="$(printf '%s' "$config" | awk -F '\t' '{print $2}')"
  db_name="$(printf '%s' "$config" | awk -F '\t' '{print $3}')"
  network="$(postgres_container_network)"

  if [ -z "$db_user" ] || [ -z "$db_name" ] || [ -z "$network" ]; then
    echo "Skipping PostgreSQL password check: local database config is incomplete."
    return
  fi

  echo "Verifying PostgreSQL password from server/.env..."
  if docker run --rm --network "$network" -e PGPASSWORD="$db_password" postgres:16-alpine \
    psql -h 3dparthub-postgres -U "$db_user" -d "$db_name" -c 'select 1;' >/dev/null 2>&1; then
    echo "PostgreSQL credentials match server/.env."
    return
  fi

  echo "PostgreSQL password mismatch detected; repairing local dev database user..."
  reset_sql="$(postgres_password_reset_sql "$db_user" "$db_password")"
  local init_pass
  init_pass="$(postgres_container_env_password)"

  # Repair attempt 1: local socket inside the container (often needs no password).
  if docker exec 3dparthub-postgres psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -c "$reset_sql" >/dev/null 2>&1 \
    && docker run --rm --network "$network" -e PGPASSWORD="$db_password" postgres:16-alpine \
      psql -h 3dparthub-postgres -U "$db_user" -d "$db_name" -c 'select 1;' >/dev/null 2>&1; then
    echo "PostgreSQL credentials repaired."
    return
  fi

  # Repair attempt 2: connect with the password the volume was initialized with.
  # This always matches a volume created by docker-compose.local.yml and never
  # requires deleting data.
  if [ -n "$init_pass" ] \
    && docker exec -e PGPASSWORD="$init_pass" 3dparthub-postgres psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -c "$reset_sql" >/dev/null 2>&1 \
    && docker run --rm --network "$network" -e PGPASSWORD="$db_password" postgres:16-alpine \
      psql -h 3dparthub-postgres -U "$db_user" -d "$db_name" -c 'select 1;' >/dev/null 2>&1; then
    echo "PostgreSQL credentials repaired."
    return
  fi

  echo "PostgreSQL password repair failed."
  echo "!!! WARNING: do NOT run 'docker compose ... down -v' — it permanently deletes"
  echo "!!! ALL database data (models, selections, users, etc.)."
  echo ""
  echo "Safe recovery options that PRESERVE your data:"
  echo "  1. Set the password in server/.env DATABASE_URL to the one the database was"
  echo "     created with (docker-compose.local.yml default is 'modelpass'), or"
  echo "  2. Reset the database password manually, then match it in server/.env:"
  echo "       docker exec -it 3dparthub-postgres psql -U \"$db_user\" -d \"$db_name\""
  echo "       # inside psql: ALTER USER \"$db_user\" WITH PASSWORD '<new-password>';"
  exit 1
}

kill_port_listener() {
  port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi

  echo "Stopping old local process on port ${port}: ${pids}"
  kill $pids 2>/dev/null || true
  sleep 1

  remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$remaining" ]; then
    echo "Force stopping old local process on port ${port}: ${remaining}"
    kill -9 $remaining 2>/dev/null || true
  fi
}

start_dev_processes() {
  kill_port_listener 8000
  kill_port_listener 5173

  echo "Starting local API on http://127.0.0.1:8000 ..."
  (cd "$ROOT_DIR/server" && npm run dev:local) &
  SERVER_PID="$!"

  echo "Waiting for local API health..."
  for _ in $(seq 1 45); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "API process stopped before becoming healthy."
      exit 1
    fi
    if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
      echo "Local API is ready."
      break
    fi
    sleep 2
  done

  if ! curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "Local API did not become healthy in time."
    exit 1
  fi

  echo "Starting local Web on http://127.0.0.1:5173 ..."
  (cd "$ROOT_DIR/client" && npm run dev:local) &
  CLIENT_PID="$!"

  echo
  echo "Local project is starting:"
  echo "  Web: http://127.0.0.1:5173"
  echo "  API: http://127.0.0.1:8000"
  echo "Press Ctrl+C to stop Web/API. PostgreSQL and Redis will keep running."

  while true; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "API process stopped."
      exit 1
    fi
    if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
      echo "Web process stopped."
      exit 1
    fi
    sleep 2
  done
}

cd "$ROOT_DIR"
start_colima
restart_or_create_data_services
wait_for_data_services
verify_or_repair_postgres_credentials
start_dev_processes
