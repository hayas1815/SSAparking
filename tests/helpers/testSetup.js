/**
 * Test Setup Helper.
 *
 * Provides shared bootstrapping for all test files:
 * - Validates test environment safety
 * - Runs migrations against test database
 * - Creates a test user and generates JWT
 * - Provides cleanup on teardown
 */

const path = require('path');
const fs = require('fs');
const { assertSafeTestDatabase, generateTestRunId, createTestPool, cleanupTestData } = require('./testDb');

// Force NODE_ENV=test before anything else
process.env.NODE_ENV = 'test';

let _pool = null;
let _testRunId = null;
let _testJwt = null;
let _testUser = null;

/**
 * Initialize test environment.
 * Call once at the start of your test suite.
 * @returns {{ pool, testRunId, jwt, user }}
 */
async function setupTestEnv() {
  // Safety first
  assertSafeTestDatabase();

  _testRunId = generateTestRunId();
  _pool = createTestPool();

  // Verify connectivity
  try {
    await _pool.query('SELECT 1');
  } catch (err) {
    console.error('FATAL: Cannot connect to test database:', err.message);
    process.exit(1);
  }

  // Run migrations on test DB
  await runTestMigrations(_pool);

  // Create test user
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');

  const testUsername = `testowner_${_testRunId}`;
  const hashedPassword = await bcrypt.hash('TestPass123!', 4); // low rounds for speed

  try {
    const result = await _pool.query(
      `INSERT INTO users (username, password, full_name, phone, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, username, role`,
      [testUsername, hashedPassword, 'Test Owner', '9999999999', 'owner']
    );
    _testUser = result.rows[0];
  } catch (err) {
    // If users table doesn't exist yet, skip user creation
    console.warn('[TEST SETUP] Could not create test user:', err.message);
    _testUser = { id: 1, username: testUsername, role: 'owner' };
  }

  // Generate JWT
  const secret = process.env.JWT_SECRET || 'test_jwt_secret_that_is_at_least_64_characters_long_for_testing_purposes_only';
  _testJwt = jwt.sign(
    { id: _testUser.id, username: _testUser.username, role: _testUser.role },
    secret,
    { expiresIn: '1h' }
  );

  console.log(`[TEST SETUP] Test environment ready (runId: ${_testRunId})`);

  return {
    pool: _pool,
    testRunId: _testRunId,
    jwt: _testJwt,
    user: _testUser
  };
}

/**
 * Run versioned migrations against the test database.
 * Reuses the same migration runner logic.
 */
async function runTestMigrations(pool) {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRes = await client.query(`SELECT filename FROM schema_migrations`);
    const appliedSet = new Set(appliedRes.rows.map(r => r.filename));

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    for (const file of files) {
      if (!appliedSet.has(file)) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
        appliedCount++;
      }
    }

    await client.query('COMMIT');
    if (appliedCount > 0) {
      console.log(`[TEST SETUP] Applied ${appliedCount} migrations to test database.`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[TEST SETUP] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tear down test environment.
 * Cleans up test data and closes the pool.
 */
async function teardownTestEnv() {
  if (_pool && _testRunId) {
    try {
      await cleanupTestData(_pool, _testRunId);
      console.log(`[TEST TEARDOWN] Cleaned up test data for runId: ${_testRunId}`);
    } catch (err) {
      console.warn('[TEST TEARDOWN] Cleanup warning:', err.message);
    }
  }

  if (_pool) {
    await _pool.end();
    _pool = null;
    console.log('[TEST TEARDOWN] Test database pool closed.');
  }
}

/**
 * Get the current test pool (for use in test files).
 */
function getTestPool() { return _pool; }
function getTestRunId() { return _testRunId; }
function getTestJwt() { return _testJwt; }
function getTestUser() { return _testUser; }

/**
 * Create a mock Express request object for controller tests.
 */
function createMockReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    body: {},
    user: _testUser || { id: 1, username: 'testowner', role: 'owner' },
    id: `test-${_testRunId || 'noid'}`,
    requestId: `test-${_testRunId || 'noid'}`,
    ...overrides
  };
}

/**
 * Create a mock Express response object for controller tests.
 */
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    _chunks: [],
    setHeader(key, val) { this.headers[key] = val; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    send(content) {
      if (Buffer.isBuffer(content)) {
        this._chunks.push(content);
      }
      this.body = content;
      return this;
    },
    end(content) {
      if (content) this.body = content;
      return this;
    },
    getHeader(key) { return this.headers[key]; },
    // Capture write() calls for streaming (pdfkit)
    write(chunk) {
      if (Buffer.isBuffer(chunk)) this._chunks.push(chunk);
      else if (typeof chunk === 'string') this._chunks.push(Buffer.from(chunk));
    },
    getBuffer() {
      return Buffer.concat(this._chunks);
    }
  };
  return res;
}

module.exports = {
  setupTestEnv,
  teardownTestEnv,
  getTestPool,
  getTestRunId,
  getTestJwt,
  getTestUser,
  createMockReq,
  createMockRes
};
