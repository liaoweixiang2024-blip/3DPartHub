import express from "express";
import cluster from "node:cluster";
import cors from "cors";
import compression from "compression";
import { extname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { config } from "./lib/config.js";
import modelCompareRouter from "./routes/model-compare.js";
import modelDrawingsRouter from "./routes/model-drawings.js";
import modelsRouter from "./routes/models.js";
import downloadsRouter from "./routes/downloads.js";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import favoritesRouter from "./routes/favorites.js";
import sharesRouter from "./routes/shares.js";
import tasksRouter from "./routes/tasks.js";
import uploadRouter from "./routes/upload.js";
import searchRouter from "./routes/search.js";
import auditRouter from "./routes/audit.js";
import batchRouter from "./routes/batch.js";
import categoriesRouter from "./routes/categories.js";
import notificationsRouter from "./routes/notifications.js";
import settingsRouter from "./routes/settings.js";
import modelGroupsRouter from "./routes/model-groups.js";
import selectionsRouter from "./routes/selections.js";
import inquiriesRouter from "./routes/inquiries.js";
import selectionSharesRouter from "./routes/selection-shares.js";
import productWallRouter from "./routes/product-wall.js";
import threadSizeRouter from "./routes/thread-size.js";
import healthRouter from "./routes/health.js";
import { getSetting, initDefaultSettings } from "./lib/settings.js";
import { startBackupScheduler } from "./lib/backup.js";
import { prisma } from "./lib/prisma.js";
import { responseHandler } from "./middleware/responseHandler.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter, uploadLimiter, authLimiter, searchLimiter, securityHeaders } from "./middleware/security.js";
import { autoAudit } from "./middleware/autoAudit.js";
import { ipGuard } from "./middleware/ipGuard.js";
import { getVerifiedRequestUser } from "./middleware/auth.js";
import { maintenanceGuard } from "./middleware/maintenance.js";
import { scheduleStartupCacheWarmup } from "./services/cacheWarmup.js";

const app = express();
const PORT = config.port;

if (!cluster.isWorker) {
  import("./workers/downloadRecorderWorker.js").catch((err) => {
    console.error("[download-recorder] failed to start:", err);
  });
  import("./workers/conversionWorker.js").catch((err) => {
    console.error("[conversion-worker] failed to start:", err);
  });
}

// Security headers
app.use(securityHeaders);

// CORS — restrict origins from config
const allowedOrigins = config.allowedOrigins.split(",").map((s) => s.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Trust nginx proxy — needed for express-rate-limit with X-Forwarded-For
app.set("trust proxy", 1);

// Response compression (filter out small responses already compressed by nginx)
app.use(compression({ threshold: 512 }));

app.use(express.json({ limit: "1mb" }));

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

const slowRequestThresholdMs = intEnv("SLOW_REQUEST_LOG_THRESHOLD_MS", 200, 0, 60_000);
const slowRequestWindowMs = intEnv("SLOW_REQUEST_LOG_WINDOW_MS", 10_000, 1000, 60_000);
const slowRequestBurst = intEnv("SLOW_REQUEST_LOG_BURST", 5, 0, 1000);
const slowRequestSampleRate = floatEnv("SLOW_REQUEST_LOG_SAMPLE_RATE", 0.01, 0, 1);
let slowRequestWindowStartedAt = Date.now();
let slowRequestLoggedInWindow = 0;
let slowRequestSuppressedInWindow = 0;

function resetSlowRequestWindow(now: number) {
  if (now - slowRequestWindowStartedAt < slowRequestWindowMs) return;
  if (slowRequestSuppressedInWindow > 0) {
    console.log(`[slow-requests] suppressed=${slowRequestSuppressedInWindow} windowMs=${now - slowRequestWindowStartedAt}`);
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
app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/static/") || req.originalUrl.startsWith("/api/health")) {
    next();
    return;
  }
  const start = Date.now();
  _res.on("finish", () => {
    const ms = Date.now() - start;
    if (_res.statusCode >= 400 || (ms > slowRequestThresholdMs && shouldLogSlowRequest(Date.now()))) {
      console.log(`${req.method} ${req.originalUrl.replace(/[\r\n]/g, "_")} ${_res.statusCode} ${ms}ms`);
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
  const lockFile = join(process.cwd(), config.uploadDir, ".backup_restore.lock");
  if (!existsSync(lockFile)) return false;
  try {
    const pid = Number(readFileSync(lockFile, "utf-8").trim().split(/\r?\n/)[0]);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

// Clean stale internal work directories that must never be served as public assets.
try {
  const staticDir = join(process.cwd(), config.staticDir);
  if (backupRestoreLockIsActive()) {
    console.log("  ⏳ Backup/restore lock is active; skipped internal workdir cleanup");
  } else {
    rmSync(join(staticDir, "_backup_db"), { recursive: true, force: true });
    for (const entry of readdirSync(staticDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".restore_")) {
        rmSync(join(staticDir, entry.name), { recursive: true, force: true });
      }
    }
  }
} catch {}

// Rate limiting
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/models/upload", uploadLimiter);
app.use("/api/upload", uploadLimiter);
app.use("/api/batch", uploadLimiter);
app.get("/api/models", searchLimiter);
app.get("/api/search", searchLimiter);
app.use("/api", apiLimiter);

// IP access control & hotlink protection
app.use(ipGuard);

// Backend maintenance gate for APIs and protected model assets.
app.use(maintenanceGuard);

const blockedStaticDirs = new Set([
  "backups",
  "_backup_db",
  "_safety_snapshots",
  "html-previews",
  "originals",
  "ticket-attachments",
  "drawings",
  "batch",
]);

function setStaticSecurityHeaders(res: express.Response, filePath: string) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (extname(filePath).toLowerCase() === ".svg") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  }
}

async function staticModelAssetsRequireAuth(): Promise<boolean> {
  return Boolean(await getSetting<boolean>("require_login_browse"));
}

app.use("/static", async (req, res, next) => {
  const path = req.path;
  const firstSegment = path.split("/").filter(Boolean)[0] || "";
  if (blockedStaticDirs.has(firstSegment) || firstSegment.startsWith(".restore_")) {
    res.status(404).end();
    return;
  }

  if (firstSegment === "models" && await staticModelAssetsRequireAuth()) {
    try {
      const verified = await getVerifiedRequestUser(req);
      if (!verified) {
        res.status(401).json({ detail: "需要登录后才能查看模型预览" });
        return;
      }
      if (verified.mustChangePassword) {
        res.status(403).json({ detail: "首次登录请先修改密码", code: "PASSWORD_CHANGE_REQUIRED" });
        return;
      }
    } catch (err) {
      console.error("[static] Failed to authorize model asset:", err);
      res.status(500).json({ detail: "认证服务暂不可用" });
      return;
    }
  }
  next();
});

app.use("/static/thumbnails", express.static(join(process.cwd(), config.staticDir, "thumbnails"), {
  maxAge: "1h",
  setHeaders: setStaticSecurityHeaders,
}));

app.use("/static", express.static(join(process.cwd(), config.staticDir), {
  maxAge: "30d",
  immutable: true,
  setHeaders: setStaticSecurityHeaders,
}));

// Global response wrapper
app.use(responseHandler);

// Auto audit logging for mutations
app.use(autoAudit);

// Routes
app.use(healthRouter);
app.use(modelCompareRouter);
app.use(modelDrawingsRouter);
// Model count — must be registered before modelsRouter to avoid /api/models/:id catching "count"
app.get("/api/models/count", async (req, res) => {
  try {
    const { cacheGetOrSet, TTL } = await import("./lib/cache.js");
    const mod = await import("./lib/prisma.js");
    const { MODEL_STATUS } = await import("./services/modelStatus.js");
    const grouped = req.query.grouped !== "false";
    const cacheKey = grouped ? "cache:models:count:grouped" : "cache:models:count:all";
    const { value, hit } = await cacheGetOrSet(cacheKey, TTL.MODELS_LIST, async () => {
      const where: any = { status: MODEL_STATUS.COMPLETED };
      if (grouped) {
        const { groupedVisibleModelWhere } = await import("./services/modelVisibility.js");
        const vis = await groupedVisibleModelWhere(mod.prisma);
        where.AND = [vis];
      }
      const total = await mod.prisma.model.count({ where });
      return { total };
    });
    res.set("X-Cache", hit ? "HIT" : "MISS").json(value);
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
  await initDefaultSettings();
  startBackupScheduler();
  // Seed admin account on first run
  try {
    const { hashPassword } = await import("./lib/password.js");
    const { randomUUID } = await import("node:crypto");
    const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!existing) {
      const adminUser = process.env.ADMIN_USER || "admin";
      const adminPass = process.env.ADMIN_PASS || (process.env.NODE_ENV === "production" ? "" : "admin123");
      if (process.env.NODE_ENV === "production" && (!adminPass || adminPass === "admin123" || adminPass === "3DPartHub@2026" || adminPass.length < 12)) {
        console.error("ADMIN_PASS is required for first production startup and must be at least 12 characters.");
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
            role: "ADMIN",
            mustChangePassword: true,
          },
        });
        console.log(`\n  👑 Admin account created (first run only):`);
        console.log(`     Username: ${adminUser}`);
        console.log(`     Email: ${adminEmail}`);
        if (process.env.NODE_ENV === "production") {
          console.log("     Password: hidden in production logs; use ADMIN_PASS from the server environment");
        } else {
          console.log(`     Password: [check your .env or ADMIN_PASS environment variable]`);
        }
        console.log(`     ⚠️  首次登录后将强制修改密码！\n`);
      } catch {
        // Another worker created admin first — safe to ignore
      }
    }
  } catch {}
  console.log(`\n  ⚙️  3DPartHub API running: http://localhost:${PORT}`);
  console.log(`  📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`  📁 Upload dir: ${join(process.cwd(), config.uploadDir)}`);
  console.log(`  📁 Static dir: ${join(process.cwd(), config.staticDir)}`);
  console.log(`  🗄️  Storage: ${config.storageType}`);
  console.log(`  🗃️  Database: ${config.databaseUrl.replace(/:[^:@]+@/, ":****@")}`);
  console.log(`  🔒 Security: Helmet + Rate Limit enabled`);

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
        console.log(`\n  ⚠️  数据库疑似最近被重置（${migrations.length} 个迁移在 ${lastTs - firstTs}ms 内完成）`);
        console.log(`  ⚠️  如有数据丢失，请通过后台「数据备份」或服务器备份目录恢复\n`);
      }
    }
  } catch {
    // _prisma_migrations might not exist yet — ignore
  }

  if (process.env.CACHE_WARMUP_ENABLED !== "0") {
    scheduleStartupCacheWarmup(PORT);
  }
});
