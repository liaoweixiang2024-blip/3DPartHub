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
start_dev_processes
