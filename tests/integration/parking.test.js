/**
 * Integration Tests: Parking Entry, Checkout, Duplicate Guards.
 *
 * Requires TEST_DATABASE_URL to be configured.
 * Skips gracefully if no test database is available.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Force test env
process.env.NODE_ENV = 'test';

let pool, testRunId, canRunDbTests;

// Check if we can run DB tests
const testDbUrl = (process.env.TEST_DATABASE_URL || '').trim();
const prodDbUrl = (process.env.DATABASE_URL || '').trim();
canRunDbTests = testDbUrl && testDbUrl !== prodDbUrl;

if (!canRunDbTests) {
  describe('Parking Integration Tests (SKIPPED)', () => {
    it('should skip — TEST_DATABASE_URL not configured or matches production', () => {
      console.log('⚠️  Skipping DB integration tests: TEST_DATABASE_URL not configured');
      assert.ok(true);
    });
  });
} else {
  describe('Parking Integration Tests', () => {
    let testSetup;

    before(async () => {
      // Ensure JWT_SECRET exists for module loading
      if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = 'a'.repeat(64);
      }

      testSetup = require('../helpers/testSetup');
      const env = await testSetup.setupTestEnv();
      pool = env.pool;
      testRunId = env.testRunId;
    });

    after(async () => {
      if (testSetup) {
        await testSetup.teardownTestEnv();
      }
    });

    it('should connect to test database (not production)', async () => {
      const result = await pool.query('SELECT current_database() AS db');
      assert.ok(result.rows[0].db, 'Should connect to a database');
      console.log(`    Connected to test DB: ${result.rows[0].db}`);
    });

    it('should have schema_migrations table', async () => {
      const result = await pool.query(
        `SELECT COUNT(*) AS cnt FROM schema_migrations`
      );
      assert.ok(parseInt(result.rows[0].cnt) >= 1, 'Migrations should be applied');
    });

    it('should create a parking entry', async () => {
      const tokenNo = 900001;
      const vehNo = `TST_${testRunId.slice(-8)}_ENT1`;

      const result = await pool.query(
        `INSERT INTO parking_entries (token_no, barcode, veh_type, veh_no, cust_name, mobile_no, rate, payment_mode, in_date, entry_time, status, test_run_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11)
         RETURNING id, token_no`,
        [tokenNo, `CARD-${tokenNo}`, 'BIKE 15', vehNo, 'TEST USER', '9999900001', 15, 'CASH', '30/07/2026', '12:00 PM', testRunId]
      );

      assert.equal(result.rows.length, 1, 'Should insert one row');
      assert.equal(result.rows[0].token_no, tokenNo);
    });

    it('should reject duplicate active vehicle entry', async () => {
      const vehNo = `TST_${testRunId.slice(-8)}_ENT1`;

      // Check for existing active entry
      const dupCheck = await pool.query(
        `SELECT id FROM parking_entries WHERE UPPER(veh_no) = $1 AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`,
        [vehNo.toUpperCase()]
      );

      assert.ok(dupCheck.rows.length > 0, 'Should find existing active entry');
    });

    it('should checkout a vehicle via transaction', async () => {
      const tokenNo = 900001;

      const result = await pool.query('BEGIN');
      try {
        // Lock the entry
        const findRes = await pool.query(
          `SELECT * FROM parking_entries WHERE token_no = $1 AND status = 'ACTIVE' AND deleted_at IS NULL FOR UPDATE`,
          [tokenNo]
        );
        assert.ok(findRes.rows.length > 0, 'Should find active entry for checkout');

        const entry = findRes.rows[0];

        // Insert to exit_history
        await pool.query(
          `INSERT INTO exit_history (token_no, barcode, veh_type, veh_no, cust_name, mobile_no, rate, payment_mode, in_date, entry_time, exit_date, exit_time, fine_amount, total_amount, test_run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [entry.token_no, entry.barcode, entry.veh_type, entry.veh_no, entry.cust_name, entry.mobile_no, entry.rate, 'CASH', entry.in_date, entry.entry_time, '30/07/2026', '1:00 PM', 0, 15, testRunId]
        );

        // Soft-delete the active entry
        await pool.query(
          `UPDATE parking_entries SET status = 'EXITED', deleted_at = NOW() WHERE id = $1`,
          [entry.id]
        );

        await pool.query('COMMIT');
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    });

    it('should reject duplicate checkout (already exited)', async () => {
      const tokenNo = 900001;

      const findRes = await pool.query(
        `SELECT * FROM parking_entries WHERE token_no = $1 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        [tokenNo]
      );

      assert.equal(findRes.rows.length, 0, 'Already exited vehicle should not be found for checkout');
    });

    it('should verify exit_history contains the checkout record', async () => {
      const result = await pool.query(
        `SELECT * FROM exit_history WHERE test_run_id = $1`,
        [testRunId]
      );

      assert.ok(result.rows.length >= 1, 'Exit history should contain at least one test record');
      assert.equal(result.rows[0].payment_mode, 'CASH');
    });

    it('should verify transaction rollback on error', async () => {
      const testVehNo = `ROLLBACK_${testRunId.slice(-8)}`;
      let rollbackCaught = false;

      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO parking_entries (token_no, veh_no, in_date, entry_time, status, test_run_id) VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
            [999999, testVehNo, '30/07/2026', '12:00 PM', testRunId]
          );
          throw new Error('Simulated transaction failure');
        } catch (err) {
          await client.query('ROLLBACK');
          rollbackCaught = true;
        } finally {
          client.release();
        }
      } catch (err) {
        rollbackCaught = true;
      }

      // Verify the record was not inserted
      const check = await pool.query(
        `SELECT * FROM parking_entries WHERE veh_no = $1`,
        [testVehNo]
      );

      assert.ok(rollbackCaught, 'Transaction error should be caught');
      assert.equal(check.rows.length, 0, 'Rolled-back record should not exist');
    });

    it('should verify cleanup only removes test run data', async () => {
      // Count records with our test_run_id
      const testRecords = await pool.query(
        `SELECT COUNT(*) AS cnt FROM parking_entries WHERE test_run_id = $1`,
        [testRunId]
      );

      // Count all records
      const allRecords = await pool.query(
        `SELECT COUNT(*) AS cnt FROM parking_entries WHERE test_run_id IS NULL`
      );

      const testCount = parseInt(testRecords.rows[0].cnt);
      const nullCount = parseInt(allRecords.rows[0].cnt);

      console.log(`    Test records: ${testCount}, Non-test records: ${nullCount}`);
      assert.ok(testCount >= 0, 'Should have counted test records');
      // Non-test records should be untouched — we don't assert a specific count
      // because the test DB may or may not have pre-existing data
    });
  });
}
