require('dotenv').config();

const env = {
  PORT: parseInt(process.env.PORT || '5500', 10),
  DATABASE_URL: (process.env.DATABASE_URL || '').trim(),
  TEST_DATABASE_URL: (process.env.TEST_DATABASE_URL || '').trim(),
  CRON_SECRET: (process.env.CRON_SECRET || '').trim(),
  JWT_SECRET: (process.env.JWT_SECRET || '').trim(),
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  NODE_ENV: (process.env.NODE_ENV || 'development').trim(),
  ALLOWED_ORIGIN: (process.env.ALLOWED_ORIGIN || '*').trim(),
  HISTORY_RETENTION_DAYS: parseInt(process.env.HISTORY_RETENTION_DAYS || '45', 10),
  OUTLET_TIMEZONE: (process.env.OUTLET_TIMEZONE || 'Asia/Kolkata').trim(),
  BACKUP_STORAGE_DRIVER: (process.env.BACKUP_STORAGE_DRIVER || 'local').trim().toLowerCase()
};

/**
 * Ensures test database isolation.
 * Throws a fatal error if TEST_DATABASE_URL is missing or matches production DATABASE_URL.
 */
function assertSafeTestDatabase() {
  if (!env.TEST_DATABASE_URL) {
    throw new Error('FATAL SAFETY ERROR: TEST_DATABASE_URL is missing. Automated tests must run against a dedicated test database to protect production data.');
  }
  if (env.TEST_DATABASE_URL === env.DATABASE_URL) {
    throw new Error('FATAL SAFETY ERROR: TEST_DATABASE_URL is identical to production DATABASE_URL. Automated tests aborted.');
  }
}

/**
 * Validates critical environment variables on startup.
 * Stops server startup if required variables are missing or invalid.
 */
function validateEnv() {
  const errors = [];

  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL is missing. Please set DATABASE_URL in .env.');
  }

  if (!env.JWT_SECRET) {
    errors.push('JWT_SECRET is missing. Please set JWT_SECRET in .env.');
  } else if (env.JWT_SECRET.length < 64) {
    errors.push(`JWT_SECRET is insecure (length ${env.JWT_SECRET.length}). Minimum required length is 64 characters.`);
  }

  if (isNaN(env.PORT) || env.PORT <= 0) {
    errors.push(`PORT is invalid: ${process.env.PORT}`);
  }

  if (isNaN(env.BCRYPT_ROUNDS) || env.BCRYPT_ROUNDS < 12) {
    errors.push(`BCRYPT_ROUNDS must be a number >= 12 (got ${process.env.BCRYPT_ROUNDS})`);
  }

  if (!env.ALLOWED_ORIGIN) {
    errors.push('ALLOWED_ORIGIN is missing. Please set ALLOWED_ORIGIN in .env.');
  }

  if (isNaN(env.HISTORY_RETENTION_DAYS) || env.HISTORY_RETENTION_DAYS <= 0) {
    errors.push(`HISTORY_RETENTION_DAYS must be a positive integer.`);
  }

  // Validate OUTLET_TIMEZONE is a recognizable IANA timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: env.OUTLET_TIMEZONE });
  } catch (e) {
    errors.push(`OUTLET_TIMEZONE '${env.OUTLET_TIMEZONE}' is not a valid IANA timezone identifier.`);
  }

  const validDrivers = ['local', 's3', 'gcs', 'provider-managed'];
  if (!validDrivers.includes(env.BACKUP_STORAGE_DRIVER)) {
    errors.push(`BACKUP_STORAGE_DRIVER must be one of: ${validDrivers.join(', ')} (got '${env.BACKUP_STORAGE_DRIVER}').`);
  }

  if (env.NODE_ENV === 'production' && env.BACKUP_STORAGE_DRIVER !== 'provider-managed' && env.BACKUP_STORAGE_DRIVER !== 'local') {
    // For s3 or gcs, check driver readiness
    if (env.BACKUP_STORAGE_DRIVER === 's3' && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.AWS_S3_BUCKET)) {
      errors.push(`BACKUP_STORAGE_DRIVER='s3' is configured but AWS credentials or AWS_S3_BUCKET are missing.`);
    }
    if (env.BACKUP_STORAGE_DRIVER === 'gcs' && (!process.env.GCS_BUCKET_NAME || !process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      errors.push(`BACKUP_STORAGE_DRIVER='gcs' is configured but GCS_BUCKET_NAME or GOOGLE_APPLICATION_CREDENTIALS are missing.`);
    }
  }

  if (env.NODE_ENV === 'test') {
    try {
      assertSafeTestDatabase();
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ ENVIRONMENT CONFIGURATION ERROR:');
    errors.forEach(err => console.error(`   - ${err}`));
    console.error('Server startup aborted.\n');
    process.exit(1);
  }
}

// Perform environment validation immediately on module load
validateEnv();

module.exports = {
  ...env,
  assertSafeTestDatabase
};
