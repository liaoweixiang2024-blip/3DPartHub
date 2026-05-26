#!/bin/sh
set -e

mkdir -p \
  /app/uploads/.metadata \
  /app/uploads/chunks \
  /app/uploads/batch \
  /app/static/models \
  /app/static/thumbnails \
  /app/static/originals \
  /app/static/drawings \
  /app/static/html-previews \
  /app/static/temp-previews \
  /app/static/ticket-attachments \
  /app/static/inquiry-attachments \
  /app/static/product-wall/previews \
  /app/static/option-images \
  /app/static/selection-assets \
  /app/static/batch \
  /app/static/backups/.work \
  /app/static/logo \
  /app/static/favicon

seed_static_file() {
  relative_path="$1"
  source_path="/app/default-static/${relative_path}"
  target_path="/app/static/${relative_path}"
  if [ ! -e "$target_path" ] && [ -e "$source_path" ]; then
    mkdir -p "$(dirname "$target_path")"
    cp "$source_path" "$target_path"
  fi
}

seed_static_file "logo/icon.svg"
seed_static_file "logo/logo.svg"
seed_static_file "logo/logo.png"
seed_static_file "favicon/favicon.png"

chown -R node:node /app/uploads /app/static
chmod -R ug+rwX /app/uploads /app/static

exec su-exec node:node sh -c 'npx prisma migrate deploy && exec node dist/cluster.js'
