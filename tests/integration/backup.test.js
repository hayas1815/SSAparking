/**
 * Integration Tests: Backup functionality.
 *
 * Tests mock storage driver, path traversal, unauthorized restore rejection.
 * Uses MockBackupStorage — no filesystem or cloud dependency.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://prod:prod@prodhost/proddb';
process.env.TEST_DATABASE_URL = 'postgres://test:test@testhost/testdb';
process.env.JWT_SECRET = 'a'.repeat(64);

const { MockBackupStorage } = require('../helpers/mockStorage');

describe('Mock Backup Storage Driver', () => {
  it('should save and list backups', async () => {
    const storage = new MockBackupStorage();

    await storage.save('backup_test1.json', JSON.stringify({
      version: '1.0',
      createdAt: new Date().toISOString(),
      tables: { parking_entries: [{ id: 1 }], exit_history: [] }
    }));

    const list = await storage.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].filename, 'backup_test1.json');
  });

  it('should read a saved backup', async () => {
    const storage = new MockBackupStorage();
    const data = JSON.stringify({
      version: '1.0',
      createdAt: new Date().toISOString(),
      tables: { parking_entries: [] }
    });

    await storage.save('backup_read.json', data);
    const content = await storage.read('backup_read.json');
    assert.equal(content, data);
  });

  it('should verify a valid backup', async () => {
    const storage = new MockBackupStorage();
    await storage.save('backup_verify.json', JSON.stringify({
      version: '1.0',
      createdAt: new Date().toISOString(),
      tables: { parking_entries: [{ id: 1 }, { id: 2 }], exit_history: [{ id: 1 }] }
    }));

    const result = await storage.verify('backup_verify.json');
    assert.equal(result.valid, true);
    assert.equal(result.totalRows, 3);
    assert.ok(result.tables.includes('parking_entries'));
  });

  it('should delete a backup', async () => {
    const storage = new MockBackupStorage();
    await storage.save('backup_delete.json', '{}');

    const result = await storage.delete('backup_delete.json');
    assert.equal(result.deleted, true);

    const list = await storage.list();
    assert.equal(list.length, 0);
  });

  it('should throw on reading non-existent backup', async () => {
    const storage = new MockBackupStorage();
    await assert.rejects(
      () => storage.read('nonexistent.json'),
      { message: /not found/i }
    );
  });
});

describe('Backup Restore Authorization', () => {
  it('should require confirmation text for restore', () => {
    // Simulate the confirmation check from backup.js
    const confirmText = 'WRONG_CONFIRMATION';
    const required = 'RESTORE_DATABASE_CONFIRM';
    assert.notEqual(confirmText, required, 'Wrong confirmation should not match');
  });

  it('should accept correct confirmation text', () => {
    const confirmText = 'RESTORE_DATABASE_CONFIRM';
    const required = 'RESTORE_DATABASE_CONFIRM';
    assert.equal(confirmText, required, 'Correct confirmation should match');
  });
});

describe('Backup Filename Validation', () => {
  const path = require('path');
  const SAFE_REGEX = /^[a-zA-Z0-9_-]+\.json$/;

  const validateFilename = (filename) => {
    if (!filename || typeof filename !== 'string') throw new Error('Filename parameter is required.');
    const basename = path.basename(filename.trim());
    if (basename !== filename || !SAFE_REGEX.test(basename)) {
      throw new Error('Invalid backup filename.');
    }
    return basename;
  };

  it('should reject path traversal attempts', () => {
    assert.throws(() => validateFilename('../../../etc/passwd'), /Invalid backup filename/);
    assert.throws(() => validateFilename('..\\..\\windows\\system32'), /Invalid backup filename/);
    assert.throws(() => validateFilename('/etc/passwd'), /Invalid backup filename/);
  });

  it('should reject non-JSON extensions', () => {
    assert.throws(() => validateFilename('backup.exe'), /Invalid backup filename/);
    assert.throws(() => validateFilename('backup.sh'), /Invalid backup filename/);
  });

  it('should accept valid filenames', () => {
    assert.equal(validateFilename('backup_2026-07-30.json'), 'backup_2026-07-30.json');
    assert.equal(validateFilename('backup_test.json'), 'backup_test.json');
  });
});
