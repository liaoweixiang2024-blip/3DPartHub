import 'dotenv/config';

const missingKeys: string[] = [];
const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    missingKeys.push(key);
    return '';
  }
  return value;
};

// Collect all missing keys before exiting so the user sees them all at once
function checkRequiredEnvVars() {
  if (missingKeys.length > 0) {
    console.error(
      `\n❌ Missing required environment variable(s):\n${missingKeys.map((k) => `   - ${k}`).join('\n')}\n\nPlease set them in your .env file and restart.\n`,
    );
    process.exit(1);
  }
}

const optional = (key: string, fallback: string): string => process.env[key] || fallback;
const optionalAllowEmpty = (key: string, fallback: string): string =>
  Object.prototype.hasOwnProperty.call(process.env, key) ? (process.env[key] ?? '') : fallback;

const isProduction = process.env.NODE_ENV === 'production';

const WEAK_JWT_SECRETS = new Set([
  'change-me-in-production',
  'change-me-to-a-random-secret-string',
  'local-dev-secret-do-not-use-in-production',
  '3dparthub-default-jwt-secret-change-me-2026-04-30',
  'ChangeToARandomSecretKey',
]);
const WEAK_DATABASE_PASSWORDS = [
  'modelpass',
  'change-me-before-docker-start',
  '3dparthub-default-db-password-change-me-2026',
  'ChangeToAStrongPassword',
];
const WEAK_REDIS_PASSWORDS = [
  '',
  'changeme-set-in-env',
  'change-me-before-docker-start',
  'ChangeToAStrongRedisPassword',
];

const failConfig = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const warnLegacySecret = (message: string) => {
  console.warn(`Security warning: ${message}`);
};

const validateJwtSecret = (value: string): string => {
  if (isProduction && (WEAK_JWT_SECRETS.has(value) || value.length < 32)) {
    warnLegacySecret('JWT_SECRET is insecure for production; set a random secret of at least 32 characters.');
  }
  return value;
};

const validateDatabaseUrl = (value: string): string => {
  if (isProduction) {
    try {
      const url = new URL(value);
      if (WEAK_DATABASE_PASSWORDS.includes(decodeURIComponent(url.password))) {
        warnLegacySecret(
          'DATABASE_URL uses an insecure default password; set DB_PASSWORD to a strong value for production.',
        );
      }
    } catch {
      failConfig('DATABASE_URL is invalid.');
    }
  }
  return value;
};

const validateRedisUrl = (value: string): string => {
  if (isProduction) {
    try {
      const url = new URL(value);
      if (WEAK_REDIS_PASSWORDS.includes(decodeURIComponent(url.password))) {
        warnLegacySecret(
          'REDIS_URL uses an insecure or empty password; set REDIS_PASSWORD to a strong value for production.',
        );
      }
    } catch {
      failConfig('REDIS_URL is invalid.');
    }
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
  if (isProduction && value && (value === 'http://localhost:5173' || value === '*')) {
    failConfig(
      'ALLOWED_ORIGINS must be explicitly set for production (cannot use localhost or wildcard). Leave empty for same-origin (behind reverse proxy).',
    );
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
  maxFileSize: Number(optional('MAX_FILE_SIZE', String(500 * 1024 * 1024))) || 500 * 1024 * 1024,
  redisUrl: validateRedisUrl(optional('REDIS_URL', 'redis://localhost:6379')),
  storageType: optional('STORAGE_TYPE', 'local'),
  allowedOrigins: validateAllowedOrigins(
    optionalAllowEmpty('ALLOWED_ORIGINS', isProduction ? '' : 'http://localhost:5173'),
  ),
  // MinIO (used when STORAGE_TYPE=minio)
  minioEndpoint: optional('MINIO_ENDPOINT', 'localhost'),
  minioPort: Number(optional('MINIO_PORT', '9000')),
  minioAccessKey: validateMinioCredentials('MINIO_ACCESS_KEY', 'minioadmin'),
  minioSecretKey: validateMinioCredentials('MINIO_SECRET_KEY', 'minioadmin'),
  minioBucket: optional('MINIO_BUCKET', 'models'),
  minioUseSSL: optional('MINIO_USE_SSL', 'false') === 'true',
};

checkRequiredEnvVars();
