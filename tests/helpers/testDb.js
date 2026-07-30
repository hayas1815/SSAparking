/**
 * Test Database Safety Guard & Connection Helper.
 * 
 * Ensures tests NEVER connect to the production database.
 * Generates unique test run IDs for scoped cleanup.
 */

const { randomUUID } = require('crypto');

/**
 * Assert that the test environment is safe to use.
 * Must be called before any test database operations.
 * Aborts the process on failure — this is intentional.
 */
function assertSafeTestDatabase(customEnv = null) {
  const nodeEnv = customEnv ? customEnv.NODE_ENV : process.env.NODE_ENV;
  const testDbUrl = customEnv ? customEnv.TEST_DATABASE_URL : (process.env.TEST_DATABASE_URL || '').trim();
  const prodDbUrl = customEnv ? customEnv.DATABASE_URL : (process.env.DATABASE_URL || '').trim();

  if (nodeEnv !== 'test') {
    if (customEnv) throw new Error('FATAL: Tests must run with NODE_ENV=test');
    console.error('FATAL: Tests must run with NODE_ENV=test');
    process.exit(1);
  }

  if (!testDbUrl) {
    const msg = 'FATAL SAFETY ERROR: TEST_DATABASE_URL is not set.\nAutomated tests MUST run against a dedicated test database.\nSee docs/TEST_ISOLATION_GUIDE.md for Neon test branch setup.';
    if (customEnv) throw new Error(msg);
    console.error(msg);
    process.exit(1);
  }

  if (testDbUrl === prodDbUrl) {
    const msg = 'FATAL SAFETY ERROR: TEST_DATABASE_URL is identical to DATABASE_URL.\nTests aborted to protect production data.';
    if (customEnv) throw new Error(msg);
    console.error(msg);
    process.exit(1);
  }
}

/**
 * Generate a unique test run ID.
 * Used to tag all records created during a test run for scoped cleanup.
 * @returns {string} e.g. "trun_1722364800000_a1b2c3d4"
 */
function generateTestRunId() {
  const ts = Date.now();
  const suffix = randomUUID().slice(0, 8);
  return `trun_${ts}_${suffix}`;
}

/**
 * Create a pg Pool connected to TEST_DATABASE_URL.
 * Only call this after assertSafeTestDatabase().
 * @returns {import('pg').Pool}
 */
function createTestPool() {
  const { Pool } = require('pg');
  const testDbUrl = process.env.TEST_DATABASE_URL;

  const pool = new Pool({
    connectionString: testDbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    max: 5 // keep small for tests
  });

  pool.on('error', (err) => {
    console.error('[TEST POOL] Unexpected error:', err.message);
  });

  return pool;
}

/**
 * Clean up ALL records tagged with the given test run ID.
 * Only deletes rows where test_run_id matches — never touches production data.
 * @param {import('pg').Pool} pool
 * @param {string} testRunId
 */
async function cleanupTestData(pool, testRunId) {
  if (!testRunId || !testRunId.startsWith('trun_')) {
    throw new Error('Invalid test run ID for cleanup');
  }

  const tables = ['audit_logs', 'exit_history', 'parking_entries', 'users'];
  for (const table of tables) {
    try {
      if (table === 'users') {
        // Users don't have test_run_id — clean by username pattern
        await pool.query(
          `DELETE FROM ${table} WHERE username LIKE $1`,
          [`%_${testRunId}%`]
        );
      } else {
        await pool.query(
          `DELETE FROM ${table} WHERE test_run_id = $1`,
          [testRunId]
        );
      }
    } catch (err) {
      // Ignore errors for tables that may not exist yet
      if (!err.message.includes('does not exist') && !err.message.includes('column')) {
        console.warn(`[TEST CLEANUP] Warning cleaning ${table}: ${err.message}`);
      }
    }
  }
}

module.exports = {
  assertSafeTestDatabase,
  generateTestRunId,
  createTestPool,
  cleanupTestData
};
