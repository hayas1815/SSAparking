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
});
