/**
 * Unit Tests: Export Format Verification
 *
 * Validates CSV output, genuine XLSX signature, genuine PDF signature,
 * and correct MIME types. No database required.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Set env before requiring modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';
process.env.JWT_SECRET = 'a'.repeat(64);

const { toCSV, toXLSX, toPDF, toPrintableHTML } = require('../../utils/export');

const SAMPLE_ROWS = [
  { token_no: 501, veh_no: 'TN 67 AD 2007', veh_type: 'BIKE 15', cust_name: 'RAVI', total_amount: 30 },
  { token_no: 502, veh_no: 'TN 67 BE 1234', veh_type: 'BIKE 15', cust_name: 'KUMAR', total_amount: 15 },
  { token_no: 503, veh_no: 'TN 01 AB 9999', veh_type: 'SCOOTER', cust_name: '=SUM(A1)', total_amount: 45 }
];

describe('CSV Export', () => {
  it('should produce valid CSV with header and data rows', () => {
    const csv = toCSV(SAMPLE_ROWS);
    assert.ok(csv, 'CSV output should be non-empty');

    const lines = csv.split('\r\n');
    assert.ok(lines.length >= 4, 'Should have header + 3 data rows');
    assert.ok(lines[0].includes('token_no'), 'Header should contain column names');
  });

  it('should handle empty input', () => {
    const csv = toCSV([]);
    assert.equal(csv, '', 'Empty input should produce empty string');
  });

  it('should sanitize formula injection in cells', () => {
    const csv = toCSV(SAMPLE_ROWS);
    // The third row has cust_name = '=SUM(A1)' which should be prefixed
    assert.ok(csv.includes("'=SUM(A1)"), 'Formula injection should be neutralized');
  });
});

describe('XLSX Export (genuine workbook)', () => {
  it('should produce a valid XLSX buffer with correct signature', async () => {
    const buffer = await toXLSX(SAMPLE_ROWS, 'Test Report');

    assert.ok(Buffer.isBuffer(buffer), 'Should return a Buffer');
    assert.ok(buffer.length > 100, 'Buffer should have substantial size');

    // XLSX files are ZIP archives — first 2 bytes should be 'PK' (0x50, 0x4B)
    assert.equal(buffer[0], 0x50, 'First byte should be P (0x50) — ZIP/XLSX signature');
    assert.equal(buffer[1], 0x4B, 'Second byte should be K (0x4B) — ZIP/XLSX signature');
  });

  it('should handle empty data', async () => {
    const buffer = await toXLSX([], 'Empty Report');
    assert.ok(Buffer.isBuffer(buffer), 'Should still return a Buffer');
    assert.equal(buffer[0], 0x50, 'Empty XLSX should still have valid signature');
  });
});

describe('PDF Export (genuine PDF)', () => {
  it('should produce a valid PDF buffer with correct signature', async () => {
    const buffer = await toPDF(SAMPLE_ROWS, 'Test Report', { totalRevenue: '₹90' });

    assert.ok(Buffer.isBuffer(buffer), 'Should return a Buffer');
    assert.ok(buffer.length > 100, 'Buffer should have substantial size');

    // PDF files start with '%PDF-'
    const header = buffer.slice(0, 5).toString('ascii');
    assert.equal(header, '%PDF-', 'Should have valid PDF signature');
  });

  it('should handle empty data', async () => {
    const buffer = await toPDF([], 'Empty Report');
    assert.ok(Buffer.isBuffer(buffer));
    const header = buffer.slice(0, 5).toString('ascii');
    assert.equal(header, '%PDF-', 'Empty PDF should still have valid signature');
  });
});

describe('Printable HTML Export', () => {
  it('should produce valid HTML string', () => {
    const html = toPrintableHTML(SAMPLE_ROWS, 'Test Report', { total: 90 });
    assert.ok(html.includes('<!DOCTYPE html>'), 'Should be valid HTML');
    assert.ok(html.includes('SSA Two-Wheeler Parking'), 'Should contain system name');
    assert.ok(html.includes('Test Report'), 'Should contain report title');
  });

  it('should escape HTML entities to prevent XSS', () => {
    const maliciousRows = [{ name: '<script>alert(1)</script>', value: '& " test' }];
    const html = toPrintableHTML(maliciousRows, 'XSS Test');
    assert.ok(!html.includes('<script>'), 'Script tags should be escaped');
    assert.ok(html.includes('&lt;script&gt;'), 'Should contain escaped script tag');
  });
});
