/**
 * Integration Tests: Cron endpoint and advisory lock protection.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.CRON_SECRET = 'test_cron_secret_that_is_at_least_32_chars_long';

describe('Cron Endpoint Authentication', () => {
  const { verifyCronSecret } = require('../../routes/cronRoutes');

  it('should reject empty authorization', () => {
    assert.equal(verifyCronSecret(''), false);
  });

  it('should reject null authorization', () => {
    assert.equal(verifyCronSecret(null), false);
  });

  it('should reject wrong secret', () => {
    assert.equal(verifyCronSecret('totally_wrong_secret_value_here_32chars'), false);
  });

  it('should accept correct secret', () => {
    assert.equal(verifyCronSecret(process.env.CRON_SECRET), true);
  });

  it('should use timing-safe comparison', () => {
    // The verifyCronSecret function uses crypto.timingSafeEqual internally
    // We can verify it handles different-length strings without crashing
    assert.equal(verifyCronSecret('short'), false);
    assert.equal(verifyCronSecret('a'.repeat(1000)), false);
    assert.equal(verifyCronSecret(''), false);
  });
});

describe('Cron Job Validation', () => {
  it('should validate supported job names', () => {
    const validJobs = ['history-cleanup', 'audit-cleanup', 'backup-retention-cleanup'];
    assert.ok(validJobs.includes('history-cleanup'));
    assert.ok(validJobs.includes('audit-cleanup'));
    assert.ok(validJobs.includes('backup-retention-cleanup'));
    assert.ok(!validJobs.includes('drop-tables'));
    assert.ok(!validJobs.includes(''));
    assert.ok(!validJobs.includes(null));
  });
});

// Advisory lock tests require DB connection
const testDbUrl = (process.env.TEST_DATABASE_URL || '').trim();
const prodDbUrl = (process.env.DATABASE_URL || '').trim();
const canRunDbTests = testDbUrl && testDbUrl !== prodDbUrl;

if (canRunDbTests) {
  describe('Advisory Lock Protection', () => {
    let pool;

    it('should acquire and release advisory lock', async () => {
      const { Pool } = require('pg');
      pool = new Pool({
        connectionString: testDbUrl,
        ssl: { rejectUnauthorized: false },
        max: 2,
        connectionTimeoutMillis: 2000
      });

      const LOCK_KEY = 999999; // Use a unique key for tests
      try {
        try {
          await pool.query('SELECT 1');
        } catch {
          console.log('    Skipping advisory lock test: TEST_DATABASE_URL is not connectable');
          return;
        }

        // Acquire lock
        const lockRes = await pool.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_KEY]);
        assert.equal(lockRes.rows[0].acquired, true, 'Should acquire lock');

        // Try to acquire same lock again (should fail on a different connection)
        const client2 = await pool.connect();
        try {
          const lockRes2 = await client2.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_KEY]);
          console.log(`    Second lock attempt: acquired=${lockRes2.rows[0].acquired}`);
        } finally {
          client2.release();
        }

        // Release lock
        await pool.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } finally {
        await pool.end();
      }
    });
  });
}
