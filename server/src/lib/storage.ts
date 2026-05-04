import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { logger } from '../lib/logger.js';

export interface StorageProvider {
  upload(key: string, data: Buffer | NodeJS.ReadableStream, contentType?: string): Promise<string>;
  uploadFile(localPath: string, key: string, contentType?: string): Promise<string>;
  getFile(key: string): Promise<NodeJS.ReadableStream>;
  deleteFile(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

// --- Local filesystem storage ---

class LocalStorage implements StorageProvider {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    mkdirSync(basePath, { recursive: true });
  }

  private resolve(key: string): string {
    const p = resolve(this.basePath, key);
    const basePathResolved = resolve(this.basePath);
    if (p !== basePathResolved && !p.startsWith(basePathResolved + sep)) {
      throw new Error('Storage key escapes base path');
    }
    mkdirSync(dirname(p), { recursive: true });
    return p;
  }

  async upload(key: string, data: Buffer | NodeJS.ReadableStream): Promise<string> {
    const filePath = this.resolve(key);
    if (Buffer.isBuffer(data)) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, data);
    } else {
      const ws = createWriteStream(filePath);
      await pipeline(data, ws);
    }
    return `/static/${key}`;
  }

  async uploadFile(localPath: string, key: string): Promise<string> {
    const filePath = this.resolve(key);
    const { copyFile } = await import('node:fs/promises');
    await copyFile(localPath, filePath);
    return `/static/${key}`;
  }

  async getFile(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = this.resolve(key);
    return createReadStream(filePath);
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = this.resolve(key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  async getSignedUrl(key: string): Promise<string> {
    return `/static/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolve(key));
  }
}

// --- MinIO storage ---

class MinioStorage implements StorageProvider {
  private client: any = null;
  private bucket: string;

  constructor() {
    this.bucket = config.minioBucket;
    this.init().catch((err) => logger.error({ err }, 'init failed'));
  }

  private async init() {
    try {
      const Minio = (await import('minio')).default;
      this.client = new Minio.Client({
        endPoint: config.minioEndpoint,
        port: config.minioPort,
        useSSL: config.minioUseSSL,
        accessKey: config.minioAccessKey,
        secretKey: config.minioSecretKey,
      });

      // Ensure bucket exists
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }
      logger.info(`  📦 MinIO storage ready (bucket: ${this.bucket})`);
    } catch (err) {
      logger.warn('  ⚠️  MinIO not available, falling back to local storage');
      this.client = null;
    }
  }

  async upload(key: string, data: Buffer | NodeJS.ReadableStream, contentType?: string): Promise<string> {
    if (!this.client) throw new Error('MinIO not initialized');

    const metadata = contentType ? { 'Content-Type': contentType } : {};
    if (Buffer.isBuffer(data)) {
      await this.client.putObject(this.bucket, key, data, data.length, metadata);
    } else {
      await this.client.putObject(this.bucket, key, data, metadata);
    }
    return `/storage/${this.bucket}/${key}`;
  }

  async uploadFile(localPath: string, key: string, contentType?: string): Promise<string> {
    if (!this.client) throw new Error('MinIO not initialized');
    const stat = statSync(localPath);
    const stream = createReadStream(localPath);
    const metadata = contentType ? { 'Content-Type': contentType } : {};
    await this.client.putObject(this.bucket, key, stream, stat.size, metadata);
    return `/storage/${this.bucket}/${key}`;
  }

  async getFile(key: string): Promise<NodeJS.ReadableStream> {
    if (!this.client) throw new Error('MinIO not initialized');
    return this.client.getObject(this.bucket, key);
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.removeObject(this.bucket, key);
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (!this.client) return `/storage/${this.bucket}/${key}`;
    return this.client.presignedGetObject(this.bucket, key, expiresIn);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }
}

// --- Storage factory ---

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storageInstance) {
    if (config.storageType === 'minio') {
      storageInstance = new MinioStorage();
    } else {
      storageInstance = new LocalStorage(config.staticDir);
    }
  }
  return storageInstance;
}
