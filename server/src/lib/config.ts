import 'dotenv/config';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
};

const optional = (key: string, fallback: string): string => process.env[key] || fallback;

const isProduction = process.env.NODE_ENV === 'production';

const WEAK_JWT_SECRETS = new Set([
  'change-me-to-a-random-secret-string',
  'local-dev-secret-do-not-use-in-production',
  '3dparthub-default-jwt-secret-change-me-2026-04-30',
]);

const failConfig = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const validateJwtSecret = (value: string): string => {
  if (isProduction && (WEAK_JWT_SECRETS.has(value) || value.length < 32)) {
    failConfig('JWT_SECRET is insecure for production; set a random secret of at least 32 characters.');
  }
  return value;
};

const validateDatabaseUrl = (value: string): string => {
  if (isProduction && /:\/\/[^:]+:modelpass@/.test(value)) {
    failConfig('DATABASE_URL uses the default database password; set DB_PASSWORD to a strong value.');
  }
  if (isProduction && /:\/\/[^:]+:3dparthub-default/i.test(value)) {
    failConfig('DATABASE_URL uses the docker-compose default password; set DB_PASSWORD to a strong value in .env.');
  }
  return value;
};

const validateMinioCredentials = (key: string, fallback: string): string => {
  const value = process.env[key] || fallback;
  if (isProduction && value === 'minioadmin' && process.env.STORAGE_TYPE === 'minio') {
    failConfig(`${key} uses the default "minioadmin" credential; set a strong value for production MinIO.`);
  }
  return value;
};

const validateAllowedOrigins = (value: string): string => {
  if (isProduction && (value === 'http://localhost:5173' || value === '*')) {
    failConfig('ALLOWED_ORIGINS must be explicitly set for production (cannot use localhost or wildcard).');
  }
  return value;
};

export const config = {
  port: Number(optional('PORT', '8000')),
  databaseUrl: validateDatabaseUrl(required('DATABASE_URL')),
  jwtSecret: validateJwtSecret(required('JWT_SECRET')),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),
  uploadDir: optional('UPLOAD_DIR', 'uploads'),
  staticDir: optional('STATIC_DIR', 'static'),
  maxFileSize: Number(optional('MAX_FILE_SIZE', String(100 * 1024 * 1024))) || 100 * 1024 * 1024,
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
  storageType: optional('STORAGE_TYPE', 'local'),
  allowedOrigins: validateAllowedOrigins(optional('ALLOWED_ORIGINS', 'http://localhost:5173')),
  // MinIO (used when STORAGE_TYPE=minio)
  minioEndpoint: optional('MINIO_ENDPOINT', 'localhost'),
  minioPort: Number(optional('MINIO_PORT', '9000')),
  minioAccessKey: validateMinioCredentials('MINIO_ACCESS_KEY', 'minioadmin'),
  minioSecretKey: validateMinioCredentials('MINIO_SECRET_KEY', 'minioadmin'),
  minioBucket: optional('MINIO_BUCKET', 'models'),
  minioUseSSL: optional('MINIO_USE_SSL', 'false') === 'true',
};
