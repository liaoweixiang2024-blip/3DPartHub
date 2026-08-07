import cluster from 'node:cluster';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { detectInterruptedRestores, startBackupScheduler } from './lib/backup.js';
import { cdnUrlRewrite } from './lib/cdnRewrite.js';
import { config } from './lib/config.js';
import { logger, createLogger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { getAllSettings, getSetting, initDefaultSettings } from './lib/settings.js';
import { cloudFirstStatic } from './lib/staticServe.js';
import { logStorageMode } from './lib/storageProvider.js';
import { getVerifiedRequestUser } from './middleware/auth.js';
import { autoAudit } from './middleware/autoAudit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { ipGuard } from './middleware/ipGuard.js';
import { maintenanceGuard } from './middleware/maintenance.js';
import { responseHandler } from './middleware/responseHandler.js';
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
import auditRouter from './routes/audit.js';
import authRouter from './routes/auth.js';
import batchDownloadsRouter from './routes/batch-downloads.js';
import batchRouter from './routes/batch.js';
import categoriesRouter from './routes/categories.js';
import downloadsRouter from './routes/downloads.js';
import favoritesRouter from './routes/favorites.js';
import healthRouter from './routes/health.js';
import inquiriesRouter from './routes/inquiries.js';
import invitesRouter from './routes/invites.js';
import modelCompareRouter from './routes/model-compare.js';
import modelDrawingsRouter from './routes/model-drawings.js';
import modelGroupsRouter from './routes/model-groups.js';
import modelsRouter from './routes/models.js';
import notificationsRouter from './routes/notifications.js';
import productWallRouter from './routes/product-wall/index.js';
import projectsRouter from './routes/projects.js';
import searchRouter from './routes/search.js';
import selectionSharesRouter from './routes/selection-shares.js';
import selectionsRouter from './routes/selections.js';
import settingsRouter from './routes/settings.js';
import sharesRouter from './routes/shares.js';
import tasksRouter from './routes/tasks.js';
import tempPreviewRouter from './routes/temp-preview.js';
import threadSizeRouter from './routes/thread-size.js';
import uploadRouter from './routes/upload.js';
import { startAuditRetentionScheduler } from './services/auditRetention.js';
import { scheduleStartupCacheWarmup } from './services/cacheWarmup.js';

const app = express();
const PORT = config.port;

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason, worker: cluster.isWorker }, 'Unhandled promise rejection — continuing');
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

// CORS — restrict origins from config (empty = same-origin only, for reverse proxy setups)
const originList = config.allowedOrigins
  ? config.allowedOrigins
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : false;
app.use(
  cors({
    origin: originList,
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
  const requestId = randomUUID();
  req.headers['x-request-id'] = requestId;
  _res.setHeader('X-Request-Id', requestId);

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
mkdirSync(`${config.staticDir}/temp-previews`, { recursive: true });
mkdirSync(`${config.staticDir}/ticket-attachments`, { recursive: true });
mkdirSync(`${config.staticDir}/inquiry-attachments`, { recursive: true });

function backupRestoreLockIsActive(): boolean {
  const lockFile = join(process.cwd(), config.uploadDir, '.backup_restore.lock');
  if (!existsSync(lockFile)) return false;
  try {
    const pid = Number(readFileSync(lockFile, 'utf-8').trim().split(/\r?\n/)[0]);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
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
} catch (err) {
  logger.warn({ err }, 'Failed to clean up internal work directories on startup');
}

// Rate limiting
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/refresh', refreshLimiter);
app.use('/api/models/upload', uploadLimiter);
app.use('/api/temp-preview/upload', uploadLimiter);
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
  'inquiry-attachments',
  'drawings',
  'batch',
]);

function setStaticSecurityHeaders(res: express.Response, filePath: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (extname(filePath).toLowerCase() === '.svg') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  }
}

function setTempPreviewStaticHeaders(res: express.Response, filePath: string) {
  setStaticSecurityHeaders(res, filePath);
  res.setHeader('Cache-Control', 'private, no-store');
}

let _requireLoginBrowseCached: boolean | null = null;
let _requireLoginBrowseAt = 0;
const REQUIRE_LOGIN_BROWSE_TTL = 30_000;

async function staticModelAssetsRequireAuth(): Promise<boolean> {
  const now = Date.now();
  if (_requireLoginBrowseCached !== null && now - _requireLoginBrowseAt < REQUIRE_LOGIN_BROWSE_TTL) {
    return _requireLoginBrowseCached;
  }
  const value = Boolean(await getSetting<boolean>('require_login_browse'));
  _requireLoginBrowseCached = value;
  _requireLoginBrowseAt = now;
  return value;
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

// 云优先服务：配了云就从云端流式代理（支持 Range），未配云端 / 云端 miss 时回退 express.static 本地。
app.use('/static', cloudFirstStatic);

app.use(
  '/static/thumbnails',
  express.static(join(process.cwd(), config.staticDir, 'thumbnails'), {
    maxAge: '365d',
    etag: true,
    setHeaders: setStaticSecurityHeaders,
  }),
);

app.use(
  '/static/temp-previews',
  express.static(join(process.cwd(), config.staticDir, 'temp-previews'), {
    maxAge: 0,
    etag: true,
    setHeaders: setTempPreviewStaticHeaders,
  }),
);

app.use(
  '/static',
  express.static(join(process.cwd(), config.staticDir), {
    maxAge: '1d',
    etag: true,
    setHeaders: setStaticSecurityHeaders,
  }),
);

// CDN 响应改写：必须挂在 responseHandler 之前（成为最内层 res.json 包装），
// 这样 responseHandler 的信封包装先执行，CDN 改写作用于最终 payload 里的 /static/ URL。
app.use(cdnUrlRewrite);

// Global response wrapper
app.use(responseHandler);

// Auto audit logging for mutations
app.use(autoAudit);

// Feature toggle guards (applied before route handlers)
const { featureGuard } = await import('./middleware/featureToggle.js');
app.use('/api/selections', featureGuard('feature_selection_enabled'));
app.use('/api/selection-shares', featureGuard('feature_selection_enabled'));
app.use('/api/selection-shares', featureGuard('feature_shares_enabled'));
app.use('/api/inquiries', featureGuard('feature_inquiry_enabled'));
app.use('/api/product-wall', featureGuard('feature_product_wall_enabled'));
// Note: /api/tasks/:id and GET /api/tasks are conversion-status queries (model upload progress),
// not tickets. Only POST /api/tasks (create ticket), /api/my-tickets, and /api/tickets/* are ticket APIs.
app.post('/api/tasks', featureGuard('feature_tickets_enabled'));
app.get('/api/my-tickets', featureGuard('feature_tickets_enabled'));
app.use('/api/tickets', featureGuard('feature_tickets_enabled'));
app.use('/api/favorites', featureGuard('feature_favorites_enabled'));
// Favorite toggle from model detail page — path lives under /api/models/:id, not /api/favorites.
app.post('/api/models/:id/favorite', featureGuard('feature_favorites_enabled'));
app.delete('/api/models/:id/favorite', featureGuard('feature_favorites_enabled'));
app.use('/api/shares', featureGuard('feature_shares_enabled'));
// Share list for a specific model — also lives under /api/models/:id.
app.get('/api/models/:id/shares', featureGuard('feature_shares_enabled'));
app.use('/api/downloads', featureGuard('feature_downloads_enabled'));
// User-facing batch download — separate entry point that also needs the download guard.
app.use('/api/batch-download', featureGuard('feature_downloads_enabled'));
app.use('/api/auth/register', featureGuard('allow_register'));
app.use('/api/auth/forgot-password', featureGuard('feature_password_reset_enabled'));
app.use('/api/auth/reset-password', featureGuard('feature_password_reset_enabled'));
app.use('/api/temp-preview', featureGuard('feature_temp_viewer_enabled'));

// Routes
app.use(healthRouter);
app.use(modelCompareRouter);
app.use(modelDrawingsRouter);
app.use(batchDownloadsRouter);
// Model count — must be registered before modelsRouter to avoid /api/models/:id catching "count"
app.get('/api/models/count', async (req, res) => {
  try {
    const { cacheGetOrSet, TTL, resolveCacheTtl } = await import('./lib/cache.js');
    const mod = await import('./lib/prisma.js');
    const { MODEL_STATUS } = await import('./services/modelStatus.js');
    const grouped = req.query.grouped !== 'false';
    const cacheKey = grouped ? 'cache:models:count:grouped' : 'cache:models:count:all';
    const listTtl = resolveCacheTtl((await getAllSettings()).cache_model_list_ttl_seconds, TTL.MODELS_LIST);
    const { value, hit } = await cacheGetOrSet(cacheKey, listTtl, async () => {
      const where: Prisma.ModelWhereInput = { status: MODEL_STATUS.COMPLETED };
      if (grouped) {
        const { groupedVisibleModelWhere } = await import('./services/modelVisibility.js');
        const vis = await groupedVisibleModelWhere(mod.prisma);
        where.AND = [vis as Prisma.ModelWhereInput];
      }
      const total = await mod.prisma.model.count({ where });
      return { total };
    });
    res.set('X-Cache', hit ? 'HIT' : 'MISS').json(value);
  } catch (err) {
    logger.warn({ err }, 'Failed to compute model count, returning fallback');
    res.json({ total: 0 });
  }
});
app.use(modelsRouter);
app.use(downloadsRouter);
app.use(authRouter);
app.use(projectsRouter);
app.use(favoritesRouter);
app.use(invitesRouter);
app.use(sharesRouter);
app.use(tasksRouter);
app.use(tempPreviewRouter);
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
    logger.debug('Pending migrations check skipped — _prisma_migrations table may not exist yet');
  }

  await initDefaultSettings();

  // 打印对象存储模式（本地 / 云端），不阻塞启动
  void logStorageMode();

  // Business categories are project-specific, so bundled demo seeds are opt-in.
  const shouldAutoSeedCategories = process.env.AUTO_SEED === '1' || process.env.AUTO_SEED_CATEGORIES === '1';
  const shouldAutoSeedSelectionCategories =
    process.env.AUTO_SEED === '1' || process.env.AUTO_SEED_SELECTION_CATEGORIES === '1';

  if (!cluster.isWorker && (shouldAutoSeedCategories || shouldAutoSeedSelectionCategories)) {
    // Try compiled dist/prisma/ (Docker: ./prisma/seed-xxx.js from dist/main.js)
    // then prisma/ with tsx (local dev: ../prisma/seed-xxx.js from src/main.js)
    const trySeed = async <T>(paths: string[]) => {
      for (const p of paths) {
        try {
          return (await import(p)) as T;
        } catch {
          logger.debug({ path: p }, 'Seed module not found at path, trying next');
        }
      }
      return null;
    };
    const { PrismaClient } = await import('@prisma/client');
    const seedPrisma = new PrismaClient();
    if (shouldAutoSeedCategories) {
      const seedCategoriesMod = await trySeed<{ seedCategories: (p: PrismaClient) => Promise<{ upserted: number }> }>([
        './prisma/seed-categories.js',
        '../prisma/seed-categories.js',
      ]);
      try {
        if (seedCategoriesMod) {
          const result = await seedCategoriesMod.seedCategories(seedPrisma);
          logger.info({ upserted: result.upserted }, 'Auto-seed categories completed');
        } else {
          logger.warn('Auto-seed categories skipped: compiled seed module not found');
        }
      } catch (err) {
        logger.warn({ err }, 'Auto-seed categories failed');
      }
    }

    if (shouldAutoSeedSelectionCategories) {
      const seedBeizeMod = await trySeed<{ seedBeizeCategories: (p: PrismaClient) => Promise<{ upserted: number }> }>([
        './prisma/seed-beize.js',
        '../prisma/seed-beize.js',
      ]);
      try {
        if (seedBeizeMod) {
          const result = await seedBeizeMod.seedBeizeCategories(seedPrisma);
          logger.info({ upserted: result.upserted }, 'Auto-seed selection-categories completed');
        } else {
          logger.warn('Auto-seed selection-categories skipped: compiled seed module not found');
        }
      } catch (err) {
        logger.warn({ err }, 'Auto-seed selection-categories failed');
      }
    }
    await seedPrisma.$disconnect();
  }

  // Backup scheduler should only run in one process (primary handles background jobs)
  if (!cluster.isWorker) {
    startBackupScheduler();
    startAuditRetentionScheduler();
  }
  // Seed admin account on first run
  try {
    const { hashPassword } = await import('./lib/password.js');
    const existing = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!existing) {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || (process.env.NODE_ENV === 'production' ? '' : 'admin123');
      if (process.env.NODE_ENV === 'production' && (!adminPass || adminPass === 'admin123' || adminPass.length < 8)) {
        logger.fatal('ADMIN_PASS is required for first production startup and must be at least 8 characters');
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
        logger.debug('Admin account creation skipped — another worker created it first');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Admin account seeding failed');
  }

  if (process.env.NODE_ENV === 'production') {
    const insecureDefaults: string[] = [];
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.includes('change-me')) insecureDefaults.push('JWT_SECRET');
    if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.includes('change-me')) insecureDefaults.push('DB_PASSWORD');
    if (process.env.REDIS_URL && /changeme/i.test(process.env.REDIS_URL)) insecureDefaults.push('REDIS_PASSWORD');
    if (insecureDefaults.length > 0) {
      logger.warn(
        { insecure: insecureDefaults },
        'Insecure default credentials detected — set strong passwords in .env before exposing to the internet',
      );
    }
  }

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
    logger.debug('Startup migration safety check skipped — _prisma_migrations table may not exist yet');
  }

  // Detect a restore that was hard-interrupted during the destructive phase (SIGKILL/OOM/power loss).
  // A persisted pre-restore snapshot means the DB may be in a reset/inconsistent state — surface it loudly.
  // Recovery is actionable via POST /api/settings/backup/recover-interrupted.
  try {
    const interrupted = detectInterruptedRestores();
    if (interrupted.length > 0) {
      for (const info of interrupted) {
        logger.error(
          {
            jobId: info.jobId,
            durableSnapshot: info.durableSnapshot,
            startedAt: info.startedAt,
          },
          'Restore was interrupted during destructive phase — DB may be inconsistent. ' +
            'A pre-restore safety snapshot is preserved. ' +
            'Recover via POST /api/settings/backup/recover-interrupted { durableSnapshot }, or re-run the restore.',
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to check for interrupted restores on startup');
  }

  if (process.env.CACHE_WARMUP_ENABLED !== '0') {
    scheduleStartupCacheWarmup(PORT);
  }

  // Report memory usage to primary process periodically
  if (cluster.isWorker) {
    const memReportTimer = setInterval(() => {
      try {
        const mem = process.memoryUsage();
        process.send?.({ type: 'memory', rss: mem.rss });
      } catch (err) {
        logger.debug({ err }, 'Failed to report memory usage to primary process');
      }
    }, 60000);
    memReportTimer.unref?.();
  }
});
