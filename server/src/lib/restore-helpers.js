/**
 * restore-helpers.js
 *
 * Handles circular foreign key constraints during data-only database restore.
 * The models ↔ model_groups tables have circular FKs:
 *   - models.group_id → model_groups.id
 *   - model_groups.primary_id → models.id
 *
 * During data-only restore, rows are inserted in alphabetical table order,
 * so "models" rows come before "model_groups" rows, causing FK violations.
 * These helpers temporarily drop and re-add those constraints.
 */

const { execFileSync } = require('child_process');

let _container = undefined;

function getContainer() {
  if (_container !== undefined) return _container;
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'pipe', timeout: 5000 });
    _container = null;
  } catch {
    try {
      const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { stdio: 'pipe', timeout: 5000 })
        .toString()
        .trim()
        .split('\n');
      const found = names.find((c) => c.includes('postgres'));
      _container = found ? found.trim() : null;
    } catch {
      _container = null;
    }
  }
  return _container;
}

function runSql(dbUrl, sql) {
  const container = getContainer();
  const dbName = new URL(dbUrl).pathname.replace(/^\//, '');
  const user = new URL(dbUrl).username;

  if (container) {
    execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', dbName, '-c', sql], {
      stdio: 'pipe',
      timeout: 60_000,
    });
  } else {
    execFileSync('psql', [dbUrl, '-c', sql], {
      stdio: 'pipe',
      timeout: 60_000,
    });
  }
}

/**
 * Drop the circular FK constraints:
 *   - models_group_id_fkey  (models.group_id → model_groups.id)
 *   - model_groups_primary_id_fkey  (model_groups.primary_id → models.id)
 */
async function dropCircularFKs(dbUrl) {
  console.log('[restore-helpers] Dropping circular FK constraints...');

  runSql(dbUrl, `ALTER TABLE "models" DROP CONSTRAINT IF EXISTS "models_group_id_fkey"`);
  runSql(dbUrl, `ALTER TABLE "model_groups" DROP CONSTRAINT IF EXISTS "model_groups_primary_id_fkey"`);

  console.log('[restore-helpers] Circular FK constraints dropped.');
}

/**
 * Re-add the circular FK constraints after data import.
 */
async function restoreCircularFKs(dbUrl) {
  console.log('[restore-helpers] Re-adding circular FK constraints...');

  runSql(
    dbUrl,
    `ALTER TABLE "models" ADD CONSTRAINT "models_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "model_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  );
  runSql(
    dbUrl,
    `ALTER TABLE "model_groups" ADD CONSTRAINT "model_groups_primary_id_fkey" FOREIGN KEY ("primary_id") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  );

  console.log('[restore-helpers] Circular FK constraints restored.');
}

module.exports = { dropCircularFKs, restoreCircularFKs };
