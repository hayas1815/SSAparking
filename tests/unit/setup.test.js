/**
 * Integration & Unit Tests: Initial Setup & Owner Account Creation Flow
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';

const { getSetupStatus, createInitialOwner } = require('../../controllers/setupController');
const db = require('../../db');

describe('Setup Controller — Unit / Logic Tests', () => {
  it('should export getSetupStatus and createInitialOwner', () => {
    assert.equal(typeof getSetupStatus, 'function');
    assert.equal(typeof createInitialOwner, 'function');
  });

  it('should reject missing required fields on owner creation', async () => {
    const req = { body: { username: '', password: '', fullName: '' } };
    let status = null;
    let jsonResult = null;

    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(data) {
        jsonResult = data;
        return this;
      }
    };

    await createInitialOwner(req, res);

    assert.equal(status, 400);
    assert.equal(jsonResult.success, false);
    assert.equal(jsonResult.errorCode, 'INVALID_INPUT');
  });

  it('should check setup status using case-insensitive active owner lookup', async () => {
    const originalQuery = db.query;
    let sql = '';
    db.query = async (queryText) => {
      sql = queryText;
      return { rows: [{ has_owner: true, total_users: '3', active_owner_count: '1' }] };
    };

    let jsonResult = null;
    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name] = value;
      },
      json(data) {
        jsonResult = data;
        return this;
      }
    };

    try {
      await getSetupStatus({}, res);
    } finally {
      db.query = originalQuery;
    }

    assert.match(sql, /LOWER\(TRIM\(role\)\)\s*=\s*'owner'/i);
    assert.match(sql, /is_active\s+IS\s+TRUE/i);
    assert.equal(jsonResult.success, true);
    assert.equal(jsonResult.setupRequired, false);
    assert.equal(jsonResult.hasOwner, true);
    assert.equal(jsonResult.isSetupRequired, false);
    assert.equal(headers['Cache-Control'], 'no-store, no-cache, must-revalidate, proxy-revalidate');
    assert.equal(headers.Pragma, 'no-cache');
    assert.equal(headers.Expires, '0');
    assert.equal(headers['Surrogate-Control'], 'no-store');
  });

  for (const role of ['OWNER', 'Owner', 'owner']) {
    it(`should detect active ${role} role as an owner`, async () => {
      const originalQuery = db.query;
      let jsonResult = null;
      db.query = async (queryText) => {
        assert.match(queryText, /LOWER\(TRIM\(role\)\)\s*=\s*'owner'/i);
        return { rows: [{ has_owner: role.trim().toLowerCase() === 'owner', total_users: '1', active_owner_count: '1' }] };
      };
      const res = {
        setHeader() {},
        json(data) {
          jsonResult = data;
          return this;
        }
      };

      try {
        await getSetupStatus({}, res);
      } finally {
        db.query = originalQuery;
      }

      assert.equal(jsonResult.hasOwner, true);
      assert.equal(jsonResult.setupRequired, false);
    });
  }

  it('should not treat an inactive owner as an active owner', async () => {
    const originalQuery = db.query;
    let jsonResult = null;
    db.query = async (queryText) => {
      assert.match(queryText, /is_active\s+IS\s+TRUE/i);
      return { rows: [{ has_owner: false, total_users: '1', active_owner_count: '0' }] };
    };
    const res = {
      setHeader() {},
      json(data) {
        jsonResult = data;
        return this;
      }
    };

    try {
      await getSetupStatus({}, res);
    } finally {
      db.query = originalQuery;
    }

    assert.equal(jsonResult.hasOwner, false);
    assert.equal(jsonResult.setupRequired, true);
  });
});
