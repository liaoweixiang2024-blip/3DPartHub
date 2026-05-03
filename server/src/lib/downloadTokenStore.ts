import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config.js";
import { getSetting } from "./settings.js";
const PROTECTED_RESOURCE_TOKEN_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

const modelTokenDir = join(resolve(process.cwd(), config.uploadDir), ".download_tokens", "models");
const resourceTokenDir = join(resolve(process.cwd(), config.uploadDir), ".download_tokens", "resources");
let lastModelCleanupAt = 0;
let lastResourceCleanupAt = 0;

export interface ModelDownloadTokenPayload {
  modelId: string;
  format: string;
  userId?: string;
  expiresAt: number;
}

interface ExpiringTokenPayload {
  expiresAt: number;
}

interface CreatedStoredToken {
  token: string;
  expiresAt: number;
}

export type ProtectedResourceType = "model-drawing" | "ticket-attachment" | "batch-download" | "backup-download" | "share-access";

export interface ProtectedResourceTokenPayload {
  type: ProtectedResourceType;
  resourceId: string;
  userId: string;
  role?: string;
  expiresAt: number;
  singleUse: boolean;
}

export type CreatedModelDownloadToken = CreatedStoredToken;

export type CreatedProtectedResourceToken = CreatedStoredToken;

function ensureTokenDirectory(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function tokenFilePath(dir: string, token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  return join(dir, token);
}

function isPayload(value: unknown): value is ModelDownloadTokenPayload {
  const payload = value as Partial<ModelDownloadTokenPayload> | null;
  return Boolean(
    payload &&
    typeof payload.modelId === "string" &&
    typeof payload.format === "string" &&
    typeof payload.expiresAt === "number"
  );
}

function isResourcePayload(value: unknown): value is ProtectedResourceTokenPayload {
  const payload = value as Partial<ProtectedResourceTokenPayload> | null;
  return Boolean(
    payload &&
    (payload.type === "model-drawing" || payload.type === "ticket-attachment" || payload.type === "batch-download" || payload.type === "backup-download" || payload.type === "share-access") &&
    typeof payload.resourceId === "string" &&
    typeof payload.userId === "string" &&
    typeof payload.expiresAt === "number" &&
    typeof payload.singleUse === "boolean"
  );
}

function readJsonPayload<T>(path: string, guard: (value: unknown) => value is T): T | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPayload(path: string): ModelDownloadTokenPayload | null {
  return readJsonPayload(path, isPayload);
}

function readResourcePayload(path: string): ProtectedResourceTokenPayload | null {
  return readJsonPayload(path, isResourcePayload);
}

function cleanupExpiredTokenFiles<T extends ExpiringTokenPayload>(
  dir: string,
  lastCleanupAt: number,
  read: (path: string) => T | null
): number {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return lastCleanupAt;
  try {
    ensureTokenDirectory(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !TOKEN_PATTERN.test(entry.name)) continue;
      const path = join(dir, entry.name);
      const payload = read(path);
      if (!payload || payload.expiresAt <= now) {
        rmSync(path, { force: true });
      }
    }
  } catch {
    // Cleanup is best-effort; create/consume paths still validate expiry.
  }
  return now;
}

function createTokenFile<T extends ExpiringTokenPayload>(
  dir: string,
  payloadFactory: () => T,
  errorMessage: string
): CreatedStoredToken {
  ensureTokenDirectory(dir);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(32).toString("base64url");
    const payload = payloadFactory();
    const path = tokenFilePath(dir, token);
    if (!path) continue;
    try {
      writeFileSync(path, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
      return { token, expiresAt: payload.expiresAt };
    } catch {
      // Extremely unlikely token collision; retry with a new random token.
    }
  }

  throw new Error(errorMessage);
}

function claimTokenFile(dir: string, token: string): string | null {
  const path = tokenFilePath(dir, token);
  if (!path || !existsSync(path)) return null;

  ensureTokenDirectory(dir);
  const claimedPath = `${path}.${process.pid}.${Date.now()}.used`;
  try {
    renameSync(path, claimedPath);
    return claimedPath;
  } catch {
    return null;
  }
}

function consumeTokenFile<T>(
  dir: string,
  token: string,
  read: (path: string) => T | null,
  validate: (payload: T | null) => T | null
): T | null {
  const claimedPath = claimTokenFile(dir, token);
  if (!claimedPath) return null;

  try {
    return validate(read(claimedPath));
  } finally {
    rmSync(claimedPath, { force: true });
  }
}

function verifyTokenFile<T extends ExpiringTokenPayload>(
  dir: string,
  token: string,
  read: (path: string) => T | null,
  validate: (payload: T | null) => T | null
): T | null {
  const path = tokenFilePath(dir, token);
  if (!path || !existsSync(path)) return null;

  const payload = read(path);
  const valid = validate(payload);
  if (!valid && payload?.expiresAt && payload.expiresAt <= Date.now()) {
    rmSync(path, { force: true });
  }
  return valid;
}

export async function createModelDownloadToken(input: {
  modelId: string;
  format?: string;
  userId?: string;
}): Promise<CreatedModelDownloadToken> {
  lastModelCleanupAt = cleanupExpiredTokenFiles(modelTokenDir, lastModelCleanupAt, readPayload);
  const ttlMinutes = (await getSetting<number>("download_token_ttl_minutes")) || 5;
  return createTokenFile(modelTokenDir, () => {
    const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
    return {
      modelId: input.modelId,
      format: input.format || "original",
      userId: input.userId,
      expiresAt,
    };
  }, "无法创建下载令牌");
}

export function createProtectedResourceToken(input: {
  type: ProtectedResourceType;
  resourceId: string;
  userId: string;
  role?: string;
  ttlMs?: number;
  singleUse?: boolean;
}): CreatedProtectedResourceToken {
  lastResourceCleanupAt = cleanupExpiredTokenFiles(resourceTokenDir, lastResourceCleanupAt, readResourcePayload);
  return createTokenFile(resourceTokenDir, () => {
    const expiresAt = Date.now() + (input.ttlMs || PROTECTED_RESOURCE_TOKEN_TTL_MS);
    return {
      type: input.type,
      resourceId: input.resourceId,
      userId: input.userId,
      role: input.role,
      expiresAt,
      singleUse: input.singleUse !== false,
    };
  }, "无法创建资源访问令牌");
}

function validateResourcePayload(
  payload: ProtectedResourceTokenPayload | null,
  type: ProtectedResourceType,
  resourceId: string
): ProtectedResourceTokenPayload | null {
  if (!payload || payload.expiresAt <= Date.now()) return null;
  if (payload.type !== type || payload.resourceId !== resourceId) return null;
  return payload;
}

export function consumeProtectedResourceToken(
  token: string,
  type: ProtectedResourceType,
  resourceId: string
): ProtectedResourceTokenPayload | null {
  return consumeTokenFile(resourceTokenDir, token, readResourcePayload, (payload) =>
    validateResourcePayload(payload, type, resourceId)
  );
}

export function verifyProtectedResourceToken(
  token: string,
  type: ProtectedResourceType,
  resourceId: string
): ProtectedResourceTokenPayload | null {
  return verifyTokenFile(resourceTokenDir, token, readResourcePayload, (payload) =>
    validateResourcePayload(payload, type, resourceId)
  );
}

export function consumeModelDownloadToken(token: string): ModelDownloadTokenPayload | null {
  return consumeTokenFile(modelTokenDir, token, readPayload, (payload) => {
    if (!payload || payload.expiresAt <= Date.now()) return null;
    return payload;
  });
}
