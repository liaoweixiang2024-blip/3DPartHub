import express from 'express';
import cluster from 'node:cluster';
import cors from 'cors';
import compression from 'compression';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { config } from './lib/config.js';
import modelCompareRouter from './routes/model-compare.js';
import modelDrawingsRouter from './routes/model-drawings.js';
import modelsRouter from './routes/models.js';
import downloadsRouter from './routes/downloads.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import favoritesRouter from './routes/favorites.js';
import sharesRouter from './routes/shares.js';
import tasksRouter from './routes/tasks.js';
import uploadRouter from './routes/upload.js';
import searchRouter from './routes/search.js';
import auditRouter from './routes/audit.js';
import batchRouter from './routes/batch.js';
import categoriesRouter from './routes/categories.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import modelGroupsRouter from './routes/model-groups.js';
import selectionsRouter from './routes/selections.js';
import inquiriesRouter from './routes/inquiries.js';
import selectionSharesRouter from './routes/selection-shares.js';
import productWallRouter from './routes/product-wall.js';
import threadSizeRouter from './routes/thread-size.js';
import healthRouter from './routes/health.js';
import { getSetting, initDefaultSettings } from './lib/settings.js';
import { startBackupScheduler } from './lib/backup.js';
import { prisma } from './lib/prisma.js';
import { logger, createLogger } from './lib/logger.js';
import { responseHandler } from './middleware/responseHandler.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import {
  apiLimiter,
  uploadLimiter,
  authLimiter,
  searchLimiter,
  securityHeaders,
  refreshLimiter,
  tokenGenLimiter,
  mutationLimiter,
} from './middleware/security.js';
import { autoAudit } from './middleware/autoAudit.js';
import { ipGuard } from './middleware/ipGuard.js';
import { getVerifiedRequestUser } from './middleware/auth.js';
import { maintenanceGuard } from './middleware/maintenance.js';
import { scheduleStartupCacheWarmup } from './services/cacheWarmup.js';

const app = express();
const PORT = config.port;

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason, worker: cluster.isWorker }, 'Unhandled promise rejection');
  process.exit(1);
});

if (!cluster.isWorker) {
  import('./workers/downloadRecorderWorker.js').catch((err) => {
    logger.error({ err }, 'download-recorder failed to start');
  });
  import('./workers/conversionWorker.js').catch((err) => {
    logger.error({ err }, 'conversion-worker failed to start');
  });
}

// Security headers
app.use(securityHeaders);

// CORS — restrict origins from config
const allowedOrigins = config.allowedOrigins.split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }),
);

// Trust nginx proxy — needed for express-rate-limit with X-Forwarded-For
app.set('trust proxy', 1);

// Response compression (filter out small responses already compressed by nginx)
app.use(compression({ threshold: 512 }));

app.use(express.json({ limit: '1mb' }));

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function floatEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const slowRequestThresholdMs = intEnv('SLOW_REQUEST_LOG_THRESHOLD_MS', 200, 0, 60_000);
const slowRequestWindowMs = intEnv('SLOW_REQUEST_LOG_WINDOW_MS', 10_000, 1000, 60_000);
const slowRequestBurst = intEnv('SLOW_REQUEST_LOG_BURST', 5, 0, 1000);
const slowRequestSampleRate = floatEnv('SLOW_REQUEST_LOG_SAMPLE_RATE', 0.01, 0, 1);
let slowRequestWindowStartedAt = Date.now();
let slowRequestLoggedInWindow = 0;
let slowRequestSuppressedInWindow = 0;

function resetSlowRequestWindow(now: number) {
  if (now - slowRequestWindowStartedAt < slowRequestWindowMs) return;
  if (slowRequestSuppressedInWindow > 0) {
    logger.debug(
      { suppressed: slowRequestSuppressedInWindow, windowMs: now - slowRequestWindowStartedAt },
      'Slow request log window summary',
    );
  }
  slowRequestWindowStartedAt = now;
  slowRequestLoggedInWindow = 0;
  slowRequestSuppressedInWindow = 0;
}

function shouldLogSlowRequest(now: number): boolean {
  resetSlowRequestWindow(now);
  if (slowRequestLoggedInWindow < slowRequestBurst) {
    slowRequestLoggedInWindow++;
    return true;
  }
  if (Math.random() < slowRequestSampleRate) {
    slowRequestLoggedInWindow++;
    return true;
  }
  slowRequestSuppressedInWindow++;
  return false;
}

// Request logging — skip health checks and static files, only log slow requests
const reqLogger = createLogger({ component: 'request' });
app.use((req, _res, next) => {
  // Attach a request ID for log correlation
  req.headers['x-request-id'] = req.headers['x-request-id'] || randomUUID();
  _res.setHeader('X-Request-Id', req.headers['x-request-id']);

  if (req.originalUrl.startsWith('/static/') || req.originalUrl.startsWith('/api/health')) {
    next();
    return;
  }
  const start = Date.now();
  _res.once('finish', () => {
    const ms = Date.now() - start;
    if (_res.statusCode >= 400 || (ms > slowRequestThresholdMs && shouldLogSlowRequest(Date.now()))) {
      reqLogger.info({
        method: req.method,
        url: req.originalUrl.replace(/[\r\n]/g, '_'),
        status: _res.statusCode,
        ms,
        requestId: req.headers['x-request-id'],
      });
    }
  });
  next();
});

mkdirSync(`${config.uploadDir}/.metadata`, { recursive: true });
mkdirSync(`${config.uploadDir}/chunks`, { recursive: true });
mkdirSync(`${config.uploadDir}/batch`, { recursive: true });
mkdirSync(`${config.staticDir}/models`, { recursive: true });
mkdirSync(`${config.staticDir}/thumbnails`, { recursive: true });
mkdirSync(`${config.staticDir}/originals`, { recursive: true });
mkdirSync(`${config.staticDir}/batch`, { recursive: true });
mkdirSync(`${config.staticDir}/ticket-attachments`, { recursive: true });

function backupRestoreLockIsActive(): boolean {
  const lockFile = join(process.cwd(), config.uploadDir, '.backup_restore.lock');
  if (!existsSync(lockFile)) return false;
  try {
    const pid = Number(readFileSync(lockFile, 'utf-8').trim().split(/\r?\n/)[0]);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

// Clean stale internal work directories that must never be served as public assets.
try {
  const staticDir = join(process.cwd(), config.staticDir);
  if (backupRestoreLockIsActive()) {
    logger.info('Backup/restore lock active, skipped internal workdir cleanup');
  } else {
    rmSync(join(staticDir, '_backup_db'), { recursive: true, force: true });
    for (const entry of readdirSync(staticDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('.restore_')) {
        rmSync(join(staticDir, entry.name), { recursive: true, force: true });
      }
    }
  }
} catch {}

// Rate limiting
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/refresh', refreshLimiter);
app.use('/api/models/upload', uploadLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/batch', uploadLimiter);
app.get('/api/models', searchLimiter);
app.get('/api/search', searchLimiter);
app.post('/api/downloads/model-token', tokenGenLimiter);
app.post('/api/downloads/drawing-token', tokenGenLimiter);
app.use('/api/favorites/batch-remove', mutationLimiter);
app.use('/api/notifications/batch', mutationLimiter);
app.use('/api/notifications/batch-read', mutationLimiter);
app.use('/api/downloads/batch-delete', mutationLimiter);
app.use('/api/model-groups/batch-merge', mutationLimiter);
app.use('/api', apiLimiter);

// IP access control & hotlink protection
app.use(ipGuard);

// Backend maintenance gate for APIs and protected model assets.
app.use(maintenanceGuard);

const blockedStaticDirs = new Set([
  'backups',
  '_backup_db',
  '_safety_snapshots',
  'html-previews',
  'originals',
  'ticket-attachments',
  'drawings',
  'batch',
]);

function setStaticSecurityHeaders(res: express.Response, filePath: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extname(filePath).toLowerCase() === '.svg') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  }
}

async function staticModelAssetsRequireAuth(): Promise<boolean> {
  return Boolean(await getSetting<boolean>('require_login_browse'));
}

app.use('/static', async (req, res, next) => {
  const path = req.path;
  const firstSegment = path.split('/').filter(Boolean)[0] || '';
  if (blockedStaticDirs.has(firstSegment) || firstSegment.startsWith('.restore_')) {
    res.status(404).end();
    return;
  }

  if (firstSegment === 'models' && (await staticModelAssetsRequireAuth())) {
    try {
      const verified = await getVerifiedRequestUser(req);
      if (!verified) {
        res.status(401).json({ detail: '需要登录后才能查看模型预览' });
        return;
      }
      if (verified.mustChangePassword) {
        res.status(403).json({ detail: '首次登录请先修改密码', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to authorize model asset');
      res.status(500).json({ detail: '认证服务暂不可用' });
      return;
    }
  }
  next();
});

app.use(
  '/static/thumbnails',
  express.static(join(process.cwd(), config.staticDir, 'thumbnails'), {
    maxAge: '1h',
    setHeaders: setStaticSecurityHeaders,
  }),
);

app.use(
  '/static',
  express.static(join(process.cwd(), config.staticDir), {
    maxAge: '30d',
    immutable: true,
    setHeaders: setStaticSecurityHeaders,
  }),
);

// Global response wrapper
app.use(responseHandler);

// Auto audit logging for mutations
app.use(autoAudit);

// Routes
app.use(healthRouter);
app.use(modelCompareRouter);
app.use(modelDrawingsRouter);
// Model count — must be registered before modelsRouter to avoid /api/models/:id catching "count"
app.get('/api/models/count', async (req, res) => {
  try {
    const { cacheGetOrSet, TTL } = await import('./lib/cache.js');
    const mod = await import('./lib/prisma.js');
    const { MODEL_STATUS } = await import('./services/modelStatus.js');
    const grouped = req.query.grouped !== 'false';
    const cacheKey = grouped ? 'cache:models:count:grouped' : 'cache:models:count:all';
    const { value, hit } = await cacheGetOrSet(cacheKey, TTL.MODELS_LIST, async () => {
      const where: any = { status: MODEL_STATUS.COMPLETED };
      if (grouped) {
        const { groupedVisibleModelWhere } = await import('./services/modelVisibility.js');
        const vis = await groupedVisibleModelWhere(mod.prisma);
        where.AND = [vis];
      }
      const total = await mod.prisma.model.count({ where });
      return { total };
    });
    res.set('X-Cache', hit ? 'HIT' : 'MISS').json(value);
  } catch {
    res.json({ total: 0 });
  }
});
app.use(modelsRouter);
app.use(downloadsRouter);
app.use(authRouter);
app.use(projectsRouter);
app.use(favoritesRouter);
app.use(sharesRouter);
app.use(tasksRouter);
app.use(uploadRouter);
app.use(searchRouter);
app.use(auditRouter);
app.use(batchRouter);
app.use(categoriesRouter);
app.use(notificationsRouter);
app.use(settingsRouter);
app.use(modelGroupsRouter);
app.use(selectionsRouter);
app.use(inquiriesRouter);
app.use(selectionSharesRouter);
app.use(productWallRouter());
app.use(threadSizeRouter);

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, async () => {
  // Clear all business caches on startup so stale data from previous deployments is never served
  try {
    const { cacheDelByPrefix } = await import('./lib/cache.js');
    await cacheDelByPrefix('cache:');
    logger.info('Startup cache flush completed — all business caches cleared');
  } catch (err) {
    logger.warn({ err }, 'Startup cache flush failed — proceeding without cache clear');
  }

  // Startup check: warn if database migrations are not up to date
  try {
    const pending = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::int as count FROM _prisma_migrations WHERE finished_at IS NULL
    `;
    if (pending[0] && Number(pending[0].count) > 0) {
      logger.warn(
        { pending: Number(pending[0].count) },
        "Database has pending migrations — run 'npm run prisma:deploy' to apply",
      );
    }
  } catch {
    // _prisma_migrations might not exist yet — ignore
  }

  await initDefaultSettings();

  // Auto-seed categories on startup (primary process only, disable with AUTO_SEED=0)
  if (!cluster.isWorker && process.env.AUTO_SEED !== '0') {
    const { execFile } = await import('node:child_process');
    const seedScripts = [
      { name: 'categories', script: 'prisma/seed-categories.ts' },
      { name: 'selection-categories', script: 'prisma/seed-beize.ts' },
    ];
    for (const { name, script } of seedScripts) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile('npx', ['tsx', script], { cwd: process.cwd(), timeout: 60_000 }, (err, stdout, stderr) => {
            if (err) return reject(err);
            if (stderr && !stderr.includes('ExperimentalWarning')) logger.debug({ stderr }, `Auto-seed ${name} stderr`);
            resolve();
          });
        });
        logger.info({ script: name }, 'Auto-seed completed');
      } catch (err) {
        logger.warn({ err, script: name }, 'Auto-seed failed');
      }
    }
  }

  // Backup scheduler should only run in one process (primary handles background jobs)
  if (!cluster.isWorker) {
    startBackupScheduler();
  }
  // Seed admin account on first run
  try {
    const { hashPassword } = await import('./lib/password.js');
    const existing = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!existing) {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || (process.env.NODE_ENV === 'production' ? '' : 'admin123');
      if (
        process.env.NODE_ENV === 'production' &&
        (!adminPass || adminPass === 'admin123' || adminPass === '3DPartHub@2026' || adminPass.length < 12)
      ) {
        logger.fatal('ADMIN_PASS is required for first production startup and must be at least 12 characters');
        process.exit(1);
      }
      const adminEmail = process.env.ADMIN_EMAIL || `${adminUser}@model.com`;
      const hash = await hashPassword(adminPass);
      try {
        await prisma.user.create({
          data: {
            username: adminUser,
            email: adminEmail,
            passwordHash: hash,
            role: 'ADMIN',
            mustChangePassword: true,
          },
        });
        logger.info(
          { username: adminUser, email: adminEmail, env: process.env.NODE_ENV },
          'Admin account created (first run only)',
        );
      } catch {
        // Another worker created admin first — safe to ignore
      }
    }
  } catch {}
  logger.info(
    {
      port: PORT,
      uploadDir: join(process.cwd(), config.uploadDir),
      staticDir: join(process.cwd(), config.staticDir),
      storage: config.storageType,
    },
    '3DPartHub API started',
  );

  // Startup safety check — warn if DB was recently reset or no recent backup
  try {
    const migrations = await prisma.$queryRaw<Array<{ started_at: Date }>>`
      SELECT started_at FROM _prisma_migrations ORDER BY started_at
    `;
    if (migrations.length > 0) {
      const firstTs = migrations[0].started_at.getTime();
      const lastTs = migrations[migrations.length - 1].started_at.getTime();
      // If all migrations applied within 2 seconds, DB was likely reset
      if (migrations.length >= 3 && lastTs - firstTs < 2000) {
        logger.warn(
          { migrations: migrations.length, spanMs: lastTs - firstTs },
          'Database possibly recently reset — all migrations applied within 2s',
        );
      }
    }
  } catch {
    // _prisma_migrations might not exist yet — ignore
  }

  if (process.env.CACHE_WARMUP_ENABLED !== '0') {
    scheduleStartupCacheWarmup(PORT);
  }

  // Report memory usage to primary process periodically
  if (cluster.isWorker) {
    setInterval(() => {
      try {
        const mem = process.memoryUsage();
        process.send?.({ type: 'memory', rss: mem.rss });
      } catch {}
    }, 60000);
  }
});
