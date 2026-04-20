import "dotenv/config";

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] || fallback;

export const config = {
  port: Number(optional("PORT", "8000")),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "7d"),
  uploadDir: optional("UPLOAD_DIR", "uploads"),
  staticDir: optional("STATIC_DIR", "static"),
  maxFileSize: Number(optional("MAX_FILE_SIZE", String(100 * 1024 * 1024))),
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),
  storageType: optional("STORAGE_TYPE", "local"),
  allowedOrigins: optional("ALLOWED_ORIGINS", "http://localhost:5173"),
  // MinIO (used when STORAGE_TYPE=minio)
  minioEndpoint: optional("MINIO_ENDPOINT", "localhost"),
  minioPort: Number(optional("MINIO_PORT", "9000")),
  minioAccessKey: optional("MINIO_ACCESS_KEY", "minioadmin"),
  minioSecretKey: optional("MINIO_SECRET_KEY", "minioadmin"),
  minioBucket: optional("MINIO_BUCKET", "models"),
};
