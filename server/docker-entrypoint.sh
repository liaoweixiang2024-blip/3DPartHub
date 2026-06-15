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
seed_static_file "favicon/favicon.svg"
seed_static_file "thumbnail-renderer.html"

if [ -d /app/default-static/js ]; then
  mkdir -p /app/static/js
  cp -R /app/default-static/js/. /app/static/js/
fi

chown -R node:node /app/uploads /app/static
chmod -R ug+rwX /app/uploads /app/static

# Auto-repair failed Prisma migrations before deploy.
# Re-runs the fixed migration SQL and marks the migration as applied,
# so that prisma migrate deploy won't be blocked by P3009.
node -e "
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  try { await client.connect(); } catch { return; }
  try {
    const { rows } = await client.query(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND started_at IS NOT NULL'
    );
    if (rows.length === 0) return;
    console.log('[repair] Found ' + rows.length + ' failed migration(s).');
    for (const row of rows) {
      const name = row.migration_name;
      const sqlPath = path.join('/app/prisma/migrations', name, 'migration.sql');
      if (fs.existsSync(sqlPath)) {
        const sql = fs.readFileSync(sqlPath, 'utf-8');
        try {
          await client.query(sql);
        } catch (e) {
          // Re-run failed — do NOT mark finished, or prisma will skip a
          // migration that was only partially applied (phantom migration).
          console.error('[repair] Re-run FAILED for ' + name + ': ' + (e && e.message));
          continue;
        }
      }
      await client.query(
        'UPDATE _prisma_migrations SET finished_at = NOW(), logs = NULL, rolled_back_at = NULL WHERE migration_name = \$1 AND finished_at IS NULL',
        [name]
      );
      console.log('[repair] Fixed: ' + name);
    }
    console.log('[repair] Done.');
  } finally { await client.end(); }
}
main().catch(() => {});
" || true

exec su-exec node:node sh -c 'npx prisma migrate deploy && exec node dist/cluster.js'
