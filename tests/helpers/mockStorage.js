/**
 * Mock Backup Storage Driver for tests.
 * Implements the backup storage interface without any filesystem or cloud dependency.
 */

class MockBackupStorage {
  constructor() {
    this._store = new Map();
  }

  async save(filename, data) {
    this._store.set(filename, {
      data,
      createdAt: new Date().toISOString(),
      size: Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data))
    });
    return { filename, size: this._store.get(filename).size };
  }

  async list() {
    const entries = [];
    for (const [filename, meta] of this._store) {
      entries.push({ filename, size: meta.size, createdAt: meta.createdAt });
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async read(filename) {
    const entry = this._store.get(filename);
    if (!entry) throw new Error(`Backup file not found: ${filename}`);
    return entry.data;
  }

  async verify(filename) {
    const entry = this._store.get(filename);
    if (!entry) throw new Error(`Backup file not found: ${filename}`);
    try {
      const parsed = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
      const tables = Object.keys(parsed.tables || {});
      const totalRows = tables.reduce((sum, t) => sum + (parsed.tables[t] || []).length, 0);
      return { valid: true, tables, totalRows, version: parsed.version || 'unknown', createdAt: parsed.createdAt };
    } catch {
      return { valid: false };
    }
  }

  async delete(filename) {
    const existed = this._store.has(filename);
    this._store.delete(filename);
    return { deleted: existed };
  }

  /** Helper for tests to check internal state */
  _getStore() { return this._store; }
  _clear() { this._store.clear(); }
}

module.exports = { MockBackupStorage };
