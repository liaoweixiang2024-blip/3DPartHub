import express from "express";
import cors from "cors";
import compression from "compression";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./lib/config.js";
import modelsRouter from "./routes/models.js";
import authRouter from "./routes/auth.js";
import projectsRouter from "./routes/projects.js";
import favoritesRouter from "./routes/favorites.js";
import commentsRouter from "./routes/comments.js";
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
import { initDefaultSettings } from "./lib/settings.js";
import { prisma } from "./lib/prisma.js";
import { responseHandler } from "./middleware/responseHandler.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter, uploadLimiter, authLimiter, securityHeaders } from "./middleware/security.js";
import { autoAudit } from "./middleware/autoAudit.js";

const app = express();
const PORT = config.port;

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

// Request logging — skip health checks and static files, only log slow requests
app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/static/") || req.originalUrl === "/api/health") {
    next();
    return;
  }
  const start = Date.now();
  _res.on("finish", () => {
    const ms = Date.now() - start;
    if (ms > 200 || _res.statusCode >= 400) {
      console.log(`${req.method} ${req.originalUrl} ${_res.statusCode} ${ms}ms`);
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

app.use("/static/thumbnails", express.static(join(process.cwd(), config.staticDir, "thumbnails"), {
  maxAge: "1h",
}));

app.use("/static", express.static(join(process.cwd(), config.staticDir), {
  maxAge: "30d",
  immutable: true,
}));

// Rate limiting
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/models/upload", uploadLimiter);
app.use("/api/upload", uploadLimiter);
app.use("/api/batch", uploadLimiter);
app.use("/api", apiLimiter);

// Global response wrapper
app.use(responseHandler);

// Auto audit logging for mutations
app.use(autoAudit);

// Routes
app.use(modelsRouter);
app.use(authRouter);
app.use(projectsRouter);
app.use(favoritesRouter);
app.use(commentsRouter);
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

// 404 handler
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(PORT, async () => {
  await initDefaultSettings();
  // Seed admin account on first run
  try {
    const { hashPassword } = await import("./lib/password.js");
    const { randomUUID } = await import("node:crypto");
    const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!existing) {
      const adminUser = process.env.ADMIN_USER || "admin";
      const adminPass = process.env.ADMIN_PASS || "admin123";
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
        console.log(`     Password: ${adminPass}`);
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
  console.log(`  🔒 Security: Helmet + Rate Limit enabled\n`);
});
