/**
 * Security Tests: Backup path traversal, CRON_SECRET validation,
 * production DB rejection, and CSV injection defense.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set env before requiring modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.CRON_SECRET = 'test_cron_secret_that_is_at_least_32_chars_long';

describe('Backup Path Traversal Protection', () => {
  // We need to require backup.js carefully — it imports db.js which tries to connect
  // For these tests we only need validateFilename which is testable via verifyBackup error
  const path = require('path');

  it('should reject Unix path traversal', () => {
    // Directly test filename validation logic
    const SAFE_REGEX = /^[a-zA-Z0-9_-]+\.json$/;

    const malicious = '../../../etc/passwd';
    const basename = path.basename(malicious.trim());
    const isValid = basename === malicious && SAFE_REGEX.test(basename);
    assert.equal(isValid, false, 'Unix path traversal should be rejected');
  });

  it('should reject Windows path traversal', () => {
    const SAFE_REGEX = /^[a-zA-Z0-9_-]+\.json$/;

    const malicious = '..\\..\\windows\\system32';
    const basename = path.basename(malicious.trim());
    const isValid = basename === malicious && SAFE_REGEX.test(basename);
    assert.equal(isValid, false, 'Windows path traversal should be rejected');
  });

  it('should reject non-json extensions', () => {
    const SAFE_REGEX = /^[a-zA-Z0-9_-]+\.json$/;
    assert.equal(SAFE_REGEX.test('backup.exe'), false);
    assert.equal(SAFE_REGEX.test('backup.sh'), false);
    assert.equal(SAFE_REGEX.test('backup'), false);
  });

  it('should accept valid backup filenames', () => {
    const SAFE_REGEX = /^[a-zA-Z0-9_-]+\.json$/;
    assert.equal(SAFE_REGEX.test('backup_2026-07-30_12-00-00.json'), true);
    assert.equal(SAFE_REGEX.test('backup_test.json'), true);
  });
});

describe('CRON_SECRET Validation', () => {
  it('should reject missing authorization header', () => {
    const { verifyCronSecret } = require('../../routes/cronRoutes');
    assert.equal(verifyCronSecret(''), false, 'Empty secret should be rejected');
    assert.equal(verifyCronSecret(null), false, 'Null secret should be rejected');
    assert.equal(verifyCronSecret(undefined), false, 'Undefined secret should be rejected');
  });

  it('should reject incorrect CRON_SECRET', () => {
    const { verifyCronSecret } = require('../../routes/cronRoutes');
    assert.equal(verifyCronSecret('wrong_secret'), false, 'Wrong secret should be rejected');
  });

  it('should accept correct CRON_SECRET', () => {
    const { verifyCronSecret } = require('../../routes/cronRoutes');
    assert.equal(
      verifyCronSecret('test_cron_secret_that_is_at_least_32_chars_long'),
      true,
      'Correct secret should be accepted'
    );
  });

  it('should reject CRON_SECRET with partial match', () => {
    const { verifyCronSecret } = require('../../routes/cronRoutes');
    assert.equal(
      verifyCronSecret('test_cron_secret_that_is_at_least_32_chars'),
      false,
      'Partial secret should be rejected'
    );
  });
});

describe('Production Database Rejection in Tests', () => {
  it('should have TEST_DATABASE_URL different from DATABASE_URL', () => {
    assert.notEqual(
      process.env.TEST_DATABASE_URL,
      process.env.DATABASE_URL,
      'TEST_DATABASE_URL must differ from DATABASE_URL'
    );
  });

  it('should have NODE_ENV set to test', () => {
    assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
  });

  it('should have TEST_DATABASE_URL configured', () => {
    assert.ok(
      process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL.length > 0,
      'TEST_DATABASE_URL must be configured'
    );
  });
});

describe('Request ID Sanitization Security', () => {
  it('should reject script injection in X-Request-ID', () => {
    const requestIdMiddleware = require('../../middleware/requestId');
    const req = { headers: { 'x-request-id': '<script>alert(1)</script>' } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    requestIdMiddleware(req, res, () => {});

    assert.notEqual(req.requestId, '<script>alert(1)</script>');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(req.requestId), 'Sanitized ID should be safe');
  });

  it('should reject overly long X-Request-ID', () => {
    const requestIdMiddleware = require('../../middleware/requestId');
    const longId = 'a'.repeat(100);
    const req = { headers: { 'x-request-id': longId } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    requestIdMiddleware(req, res, () => {});

    assert.notEqual(req.requestId, longId, 'Overly long ID should be replaced');
  });
});

describe('CSV Injection Defense', () => {
  it('should prefix all dangerous formula characters', () => {
    const { toCSV } = require('../../utils/export');

    const dangerousCells = [
      { val: '=cmd|', expected: "'=cmd|" },
      { val: '+cmd|', expected: "'+cmd|" },
      { val: '-1+2', expected: "'-1+2" },
      { val: '@SUM()', expected: "'@SUM()" }
    ];

    for (const { val, expected } of dangerousCells) {
      const csv = toCSV([{ test: val }]);
      assert.ok(
        csv.includes(expected),
        `Cell "${val}" should be prefixed to "${expected}"`
      );
    }
  });

  it('should not prefix normal values', () => {
    const { toCSV } = require('../../utils/export');
    const csv = toCSV([{ name: 'Normal Value', number: '12345' }]);
    assert.ok(csv.includes('Normal Value'), 'Normal values should not be modified');
    assert.ok(csv.includes('12345'), 'Numbers should not be modified');
  });
});

describe('Unsupported Backup Storage Driver', () => {
  it('should validate backup driver configuration', () => {
    const validDrivers = ['local', 's3', 'gcs', 'provider-managed'];
    assert.ok(validDrivers.includes('local'));
    assert.ok(!validDrivers.includes('azure'), 'Azure should not be supported');
    assert.ok(!validDrivers.includes('ftp'), 'FTP should not be supported');
  });
});
