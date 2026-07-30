/**
 * Unit Tests: Environment Configuration & Test DB Safety
 *
 * Verifies that the environment validation and test database isolation
 * guards work correctly using isolated custom env objects.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDatabase, generateTestRunId } = require('../../tests/helpers/testDb');

describe('Test Database Safety Guards', () => {
  it('should detect when TEST_DATABASE_URL is missing', () => {
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://prod:prod@prodhost/proddb',
      TEST_DATABASE_URL: ''
    };

    assert.throws(
      () => assertSafeTestDatabase(env),
      { message: /TEST_DATABASE_URL is not set/i }
    );
  });

  it('should detect when TEST_DATABASE_URL equals DATABASE_URL', () => {
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://same:same@host/db',
      TEST_DATABASE_URL: 'postgres://same:same@host/db'
    };

    assert.throws(
      () => assertSafeTestDatabase(env),
      { message: /identical to DATABASE_URL/i }
    );
  });

  it('should pass when TEST_DATABASE_URL is different from DATABASE_URL', () => {
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://prod:prod@prodhost/proddb',
      TEST_DATABASE_URL: 'postgres://test:test@testhost/testdb'
    };

    assert.doesNotThrow(() => assertSafeTestDatabase(env));
  });

  it('should generate unique test run IDs', () => {
    const id1 = generateTestRunId();
    const id2 = generateTestRunId();

    assert.ok(id1.startsWith('trun_'), 'Test run ID should start with trun_');
    assert.ok(id2.startsWith('trun_'), 'Test run ID should start with trun_');
    assert.notEqual(id1, id2, 'Each test run ID should be unique');
  });
});

describe('NODE_ENV Guard', () => {
  it('should detect when NODE_ENV is not test', () => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://prod:prod@prodhost/proddb',
      TEST_DATABASE_URL: 'postgres://test:test@testhost/testdb'
    };

    assert.throws(
      () => assertSafeTestDatabase(env),
      { message: /NODE_ENV=test/i }
    );
  });
});
