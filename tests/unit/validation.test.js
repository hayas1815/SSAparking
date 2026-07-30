/**
 * Unit Tests: Input Validation
 *
 * Tests payment validation rules, CSV injection defense, and request ID sanitization.
 * These are pure unit tests — no database required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Payment Validation Middleware', () => {
  // Dynamically require to avoid triggering env validation on import
  let validateCheckout, validateParkingEntry;

  it('should load validation middleware', () => {
    // Set minimal env to prevent process.exit from env.js
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
    process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';
    process.env.JWT_SECRET = 'a'.repeat(64);

    const mod = require('../../middleware/validationMiddleware');
    validateCheckout = mod.validateCheckout;
    validateParkingEntry = mod.validateParkingEntry;
    assert.ok(validateCheckout, 'validateCheckout should be a function');
    assert.ok(validateParkingEntry, 'validateParkingEntry should be a function');
  });

  it('should reject GPAY without transaction reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'GPAY', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400, 'Should reject GPAY without txnRef');
    assert.equal(nextCalled, false, 'next() should not be called');
    assert.ok(res.body.message.includes('mandatory'), 'Error message should mention mandatory');
  });

  it('should reject UPI without transaction reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'UPI', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400, 'Should reject UPI without txnRef');
    assert.equal(nextCalled, false);
  });

  it('should reject CARD without transaction reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'CARD', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400, 'Should reject CARD without txnRef');
  });

  it('should accept CASH payment without transaction reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'CASH', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'CASH without ref should pass');
  });

  it('should reject CASH payment with transaction reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'CASH', txnRef: 'TXN123', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400, 'CASH with ref should be rejected');
    assert.equal(nextCalled, false);
  });

  it('should reject invalid payment mode', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'BITCOIN', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.message.includes('Invalid Payment Mode'));
  });

  it('should reject negative fine amount', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'CASH', fineAmount: -10 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.message.includes('negative'));
  });

  it('should reject whitespace-only UPI reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'UPI', txnRef: '   ', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 400, 'Whitespace-only UPI ref should be rejected');
  });

  it('should accept valid GPAY payment with reference', () => {
    const req = {
      body: { tokenNo: 100, paymentMode: 'GPAY', txnRef: 'TXN-2026-001', fineAmount: 0 },
      headers: {}
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    let nextCalled = false;
    validateCheckout(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'Valid GPAY with ref should pass');
  });
});

describe('CSV Formula Injection Defense', () => {
  it('should neutralize formula-prefixed cell values', () => {
    const { toCSV } = require('../../utils/export');
    const rows = [
      { name: '=1+2', cmd: '+cmd|', at: '@SUM(A1)', tab: '\tmalicious', normal: 'Hello' }
    ];
    const csv = toCSV(rows);

    assert.ok(csv.includes("'=1+2"), 'Formula with = should be prefixed');
    assert.ok(csv.includes("'+cmd|"), 'Formula with + should be prefixed');
    assert.ok(csv.includes("'@SUM(A1)"), 'Formula with @ should be prefixed');
    assert.ok(csv.includes("Hello"), 'Normal values should pass through');
  });
});

describe('Request ID Middleware', () => {
  it('should accept valid custom X-Request-ID', () => {
    const requestIdMiddleware = require('../../middleware/requestId');
    const req = { headers: { 'x-request-id': 'custom-valid-req-id-999' } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    let nextCalled = false;
    requestIdMiddleware(req, res, () => { nextCalled = true; });

    assert.ok(nextCalled, 'next() should be called');
    assert.equal(req.requestId, 'custom-valid-req-id-999');
    assert.equal(res.headers['X-Request-ID'], 'custom-valid-req-id-999');
  });

  it('should reject malformed X-Request-ID with spaces and special characters', () => {
    const requestIdMiddleware = require('../../middleware/requestId');
    const req = { headers: { 'x-request-id': 'invalid id with spaces!@#' } };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    requestIdMiddleware(req, res, () => {});

    assert.notEqual(req.requestId, 'invalid id with spaces!@#', 'Malformed ID should be replaced');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(req.requestId), 'Generated ID should be alphanumeric');
  });

  it('should generate UUID for missing X-Request-ID', () => {
    const requestIdMiddleware = require('../../middleware/requestId');
    const req = { headers: {} };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
    requestIdMiddleware(req, res, () => {});

    assert.ok(req.requestId, 'Should generate a request ID');
    assert.ok(req.requestId.length > 0, 'Generated ID should be non-empty');
  });
});
