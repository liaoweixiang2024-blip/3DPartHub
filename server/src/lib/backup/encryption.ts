// 备份归档加密 / 解密（从 backup.ts 抽出，零依赖核心，避免循环）
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const BACKUP_ENCRYPTION_MAGIC = '3DPHBAKENC1';
export const BACKUP_ENCRYPTION_ALGORITHM = 'aes-256-gcm';

type BackupEncryptionHeader = {
  algorithm: typeof BACKUP_ENCRYPTION_ALGORITHM;
  iv: string;
  authTag: string;
  createdAt: string;
};

export type BackupEncryptionStatus = {
  enabled: boolean;
  algorithm: typeof BACKUP_ENCRYPTION_ALGORITHM;
  configuredBy: 'BACKUP_ENCRYPTION_SECRET' | 'BACKUP_ENCRYPTION_KEY' | null;
  recommendedEnvName: 'BACKUP_ENCRYPTION_SECRET';
  legacyEnvName: 'BACKUP_ENCRYPTION_KEY';
};

function backupEncryptionConfig(): { secret: string; configuredBy: BackupEncryptionStatus['configuredBy'] } {
  const primary = process.env.BACKUP_ENCRYPTION_SECRET?.trim() || '';
  if (primary) return { secret: primary, configuredBy: 'BACKUP_ENCRYPTION_SECRET' };

  const legacy = process.env.BACKUP_ENCRYPTION_KEY?.trim() || '';
  if (legacy) return { secret: legacy, configuredBy: 'BACKUP_ENCRYPTION_KEY' };

  return { secret: '', configuredBy: null };
}

function backupEncryptionSecret(): string {
  return backupEncryptionConfig().secret;
}

function backupEncryptionEnabled(): boolean {
  return backupEncryptionSecret().trim().length > 0;
}

export function getBackupEncryptionStatus(): BackupEncryptionStatus {
  const config = backupEncryptionConfig();
  return {
    enabled: config.secret.length > 0,
    algorithm: BACKUP_ENCRYPTION_ALGORITHM,
    configuredBy: config.configuredBy,
    recommendedEnvName: 'BACKUP_ENCRYPTION_SECRET',
    legacyEnvName: 'BACKUP_ENCRYPTION_KEY',
  };
}

function backupEncryptionKey(): Buffer {
  const secret = backupEncryptionSecret().trim();
  if (!secret) throw new Error('备份文件已加密，但服务器未配置 BACKUP_ENCRYPTION_SECRET');
  return createHash('sha256').update(secret).digest();
}

export function isEncryptedBackupArchiveFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(BACKUP_ENCRYPTION_MAGIC.length);
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
      return bytesRead === buffer.length && buffer.toString('utf-8') === BACKUP_ENCRYPTION_MAGIC;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function readEncryptedBackupHeader(path: string): { header: BackupEncryptionHeader; payloadOffset: number } {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const prefix = `${BACKUP_ENCRYPTION_MAGIC}\n`;
    const text = buffer.toString('utf-8', 0, bytesRead);
    if (!text.startsWith(prefix)) throw new Error('备份加密头无效');
    const headerEnd = text.indexOf('\n', prefix.length);
    if (headerEnd < 0) throw new Error('备份加密头不完整');
    const header = JSON.parse(text.slice(prefix.length, headerEnd)) as BackupEncryptionHeader;
    if (header.algorithm !== BACKUP_ENCRYPTION_ALGORITHM || !header.iv || !header.authTag) {
      throw new Error('备份加密参数无效');
    }
    return { header, payloadOffset: Buffer.byteLength(text.slice(0, headerEnd + 1)) };
  } finally {
    closeSync(fd);
  }
}

export async function encryptBackupArchiveInPlace(path: string): Promise<boolean> {
  if (!backupEncryptionEnabled() || isEncryptedBackupArchiveFile(path)) return false;

  const iv = randomBytes(12);
  const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGORITHM, backupEncryptionKey(), iv);
  const payloadPath = `${path}.payload.${process.pid}.tmp`;
  const encryptedPath = `${path}.encrypted.${process.pid}.tmp`;
  try {
    await pipeline(createReadStream(path), cipher, createWriteStream(payloadPath));
    const header: BackupEncryptionHeader = {
      algorithm: BACKUP_ENCRYPTION_ALGORITHM,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(encryptedPath, `${BACKUP_ENCRYPTION_MAGIC}\n${JSON.stringify(header)}\n`);
    await pipeline(createReadStream(payloadPath), createWriteStream(encryptedPath, { flags: 'a' }));
    renameSync(encryptedPath, path);
    return true;
  } finally {
    if (existsSync(payloadPath)) rmSync(payloadPath, { force: true });
    if (existsSync(encryptedPath)) rmSync(encryptedPath, { force: true });
  }
}

async function decryptBackupArchiveToFile(path: string, destination: string): Promise<void> {
  const { header, payloadOffset } = readEncryptedBackupHeader(path);
  const decipher = createDecipheriv(
    BACKUP_ENCRYPTION_ALGORITHM,
    backupEncryptionKey(),
    Buffer.from(header.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(header.authTag, 'base64'));
  await pipeline(createReadStream(path, { start: payloadOffset }), decipher, createWriteStream(destination));
}

export async function materializeReadableBackupArchive(archive: string, tmpDir: string): Promise<string> {
  if (!isEncryptedBackupArchiveFile(archive)) return archive;
  mkdirSync(tmpDir, { recursive: true });
  const decryptedPath = join(tmpDir, 'decrypted-backup.tar.gz');
  await decryptBackupArchiveToFile(archive, decryptedPath);
  return decryptedPath;
}
