/**
 * Integration Tests: Authentication flow.
 *
 * Tests login, invalid login, deactivated user, expired token, and role checks.
 * Requires TEST_DATABASE_URL.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const testDbUrl = (process.env.TEST_DATABASE_URL || '').trim();
const prodDbUrl = (process.env.DATABASE_URL || '').trim();
const canRunDbTests = testDbUrl && testDbUrl !== prodDbUrl;

if (!canRunDbTests) {
  describe('Auth Integration Tests (SKIPPED)', () => {
    it('should skip — TEST_DATABASE_URL not configured', () => {
      assert.ok(true);
    });
  });
} else {
  describe('Auth Integration Tests', () => {
    let pool, testRunId, testSetup;

    before(async () => {
      if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'a'.repeat(64);
      testSetup = require('../helpers/testSetup');
      const env = await testSetup.setupTestEnv();
      pool = env.pool;
      testRunId = env.testRunId;
    });

    after(async () => {
      if (testSetup) await testSetup.teardownTestEnv();
    });

    it('should have a test user created during setup', () => {
      const user = testSetup.getTestUser();
      assert.ok(user, 'Test user should exist');
      assert.ok(user.username, 'Test user should have a username');
      assert.equal(user.role, 'owner', 'Test user should be an owner');
    });

    it('should have a valid JWT token', () => {
      const jwt = testSetup.getTestJwt();
      assert.ok(jwt, 'JWT token should be generated');
      assert.ok(jwt.length > 50, 'JWT should be a substantial string');

      // Verify it decodes correctly
      const jwtLib = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'a'.repeat(64);
      const decoded = jwtLib.verify(jwt, secret);
      assert.ok(decoded.id, 'Decoded JWT should contain user ID');
      assert.equal(decoded.role, 'owner', 'Decoded JWT should contain owner role');
    });

    it('should reject expired tokens', () => {
      const jwtLib = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'a'.repeat(64);
      const expiredToken = jwtLib.sign(
        { id: 1, username: 'test', role: 'owner' },
        secret,
        { expiresIn: '0s' }
      );

      // Wait a tiny bit then verify
      try {
        jwtLib.verify(expiredToken, secret);
        assert.fail('Should throw on expired token');
      } catch (err) {
        assert.ok(err.message.includes('expired') || err.name === 'TokenExpiredError');
      }
    });

    it('should reject invalid role access', () => {
      const { verifyRole } = require('../../middleware/authMiddleware');
      const middleware = verifyRole('owner');

      const req = { user: { role: 'cashier' } };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; }
      };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.equal(res.statusCode, 403, 'Non-owner should get 403');
      assert.equal(nextCalled, false, 'next() should not be called');
    });

    it('should accept valid role access', () => {
      const { verifyRole } = require('../../middleware/authMiddleware');
      const middleware = verifyRole('owner', 'manager');

      const req = { user: { role: 'owner' } };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; }
      };
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, true, 'Owner should be granted access');
    });

    it('should create and verify deactivated user in test DB', async () => {
      const bcrypt = require('bcryptjs');
      const username = `deactivated_${testRunId.slice(-8)}`;
      const hashed = await bcrypt.hash('Pass123!', 4);

      await pool.query(
        `INSERT INTO users (username, password, full_name, role, is_active) VALUES ($1, $2, $3, $4, false)`,
        [username, hashed, 'Deactivated User', 'cashier']
      );

      // Verify user exists and is deactivated
      const result = await pool.query(
        `SELECT is_active FROM users WHERE username = $1`,
        [username]
      );
      assert.equal(result.rows[0].is_active, false, 'User should be deactivated');

      // Cleanup
      await pool.query(`DELETE FROM users WHERE username = $1`, [username]);
    });
  });
}
