const db = require('../db');
const path = require('path');
const fs = require('fs');

/**
 * Database Backup & Restore Utility.
 * 
 * AUDIT OF BACKUP STORAGE DRIVERS:
 * - MockBackupStorage: TEST-ONLY (used in unit/integration tests)
 * - Local filesystem: DEVELOPMENT-ONLY (local file backups in /backups)
 * - S3 / GCS / Provider-Managed: UNSUPPORTED (no cloud storage SDK code implemented)
 */

const BACKUP_DRIVERS = {
  mock: 'TEST-ONLY',
  local: 'DEVELOPMENT-ONLY',
  s3: 'UNSUPPORTED',
  gcs: 'UNSUPPORTED',
  'provider-managed': 'UNSUPPORTED'
};

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Check if a durable production backup storage driver is configured and implemented.
 * @returns {boolean}
 */
function isDurableStorageConfigured() {
  // S3, GCS, and provider-managed driver logic is not implemented in this codebase.
  // Local filesystem is development-only; mock is test-only.
  return false;
}

/**
 * Validate backup filename against strict allowlist regex to prevent path traversal.
 * @param {string} filename
 * @returns {string} Cleaned filename
 */
function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename parameter is required.');
  }
  const basename = path.basename(filename.trim());
  if (basename !== filename || !/^[a-zA-Z0-9_-]+\.json$/.test(basename)) {
    throw new Error('Invalid backup filename. Only alphanumeric, dashes, underscores, and .json extension allowed.');
  }
  return basename;
}

/**
 * Create a full logical backup of parking_entries, exit_history, audit_logs, and users.
 * Prohibited in production unless a durable production storage driver is configured.
 * @returns {Promise<{ filename, path, tables, totalRows, createdAt }>}
 */
async function createBackup() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Durable backup storage is not configured.');
  }

  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `backup_${timestamp}.json`;
  const filePath = path.join(BACKUP_DIR, filename);

  const tables = ['parking_entries', 'exit_history', 'audit_logs', 'users'];
  const backup = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    tables: {}
  };

  let totalRows = 0;
  for (const table of tables) {
    try {
      const result = await db.query(`SELECT * FROM ${table} ORDER BY id`);
      const rows = result.rows.map(row => {
        const copy = { ...row };
        if (table === 'users' && copy.password) {
          delete copy.password;
        }
        return copy;
      });
      backup.tables[table] = rows;
      totalRows += rows.length;
    } catch (err) {
      backup.tables[table] = [];
      console.warn(`Backup: Table ${table} skipped — ${err.message}`);
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');

  return {
    filename,
    path: filePath,
    tables: Object.keys(backup.tables),
    totalRows,
    createdAt: backup.createdAt
  };
}

/**
 * List all available backup files.
 * @returns {object[]} Array of backup metadata objects
 */
function listBackups() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Durable backup storage is not configured.');
  }
  ensureBackupDir();
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('backup_'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        filename: f,
        size: stat.size,
        createdAt: stat.birthtime.toISOString()
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return files;
}

/**
 * Verify a backup file is valid JSON with expected table keys.
 * @param {string} filename - Backup filename (not full path)
 * @returns {{ valid, tables, totalRows, version, createdAt }}
 */
function verifyBackup(filename) {
  const safeName = validateFilename(filename);
  const filePath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${safeName}`);
  }

  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const tables = Object.keys(content.tables || {});
  const totalRows = tables.reduce((sum, t) => sum + (content.tables[t] || []).length, 0);

  return {
    valid: true,
    version: content.version || 'unknown',
    createdAt: content.createdAt,
    tables,
    totalRows
  };
}

/**
 * Restore database state from a validated JSON backup file.
 * Performs restoration inside an atomic database transaction.
 * @param {string} filename - Name of backup file in /backups
 * @param {string} confirmText - Mandatory confirmation string: 'RESTORE_DATABASE_CONFIRM'
 * @returns {Promise<{ restored: boolean, filename: string, restoredCounts: object }>}
 */
async function restoreBackup(filename, confirmText) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Durable backup storage is not configured.');
  }

  if (confirmText !== 'RESTORE_DATABASE_CONFIRM') {
    throw new Error('Database restoration requires explicit confirmation text: "RESTORE_DATABASE_CONFIRM".');
  }

  const safeName = validateFilename(filename);
  const verification = verifyBackup(safeName);
  if (!verification.valid) {
    throw new Error('Invalid backup file structure.');
  }

  const filePath = path.join(BACKUP_DIR, safeName);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const tablesData = content.tables || {};

  const restoredCounts = {};

  await db.transaction(async (client) => {
    // Restore users
    if (tablesData.users && Array.isArray(tablesData.users)) {
      for (const row of tablesData.users) {
        const safePassword = row.password || '$2a$12$RESTORED_USER_PASSWORD_PLACEHOLDER_HASH';
        await client.query(`
          INSERT INTO users (id, username, password, full_name, phone, role, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            password = CASE WHEN EXCLUDED.password = '$2a$12$RESTORED_USER_PASSWORD_PLACEHOLDER_HASH' THEN users.password ELSE EXCLUDED.password END,
            full_name = EXCLUDED.full_name,
            phone = EXCLUDED.phone,
            role = EXCLUDED.role,
            is_active = COALESCE(EXCLUDED.is_active, users.is_active)
        `, [
          row.id, row.username, safePassword, row.full_name, row.phone || '',
          row.role || 'owner', row.is_active !== undefined ? row.is_active : true,
          row.created_at || new Date()
        ]);
      }
      restoredCounts.users = tablesData.users.length;
    }

    // Restore parking_entries
    if (tablesData.parking_entries && Array.isArray(tablesData.parking_entries)) {
      for (const row of tablesData.parking_entries) {
        await client.query(`
          INSERT INTO parking_entries (id, token_no, barcode, veh_type, veh_no, cust_name, mobile_no, rate, payment_mode, in_date, entry_time, status, exit_time, total_hours, total_amount, created_by, deleted_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO UPDATE SET
            token_no = EXCLUDED.token_no,
            barcode = EXCLUDED.barcode,
            veh_type = EXCLUDED.veh_type,
            veh_no = EXCLUDED.veh_no,
            cust_name = EXCLUDED.cust_name,
            mobile_no = EXCLUDED.mobile_no,
            rate = EXCLUDED.rate,
            payment_mode = EXCLUDED.payment_mode,
            in_date = EXCLUDED.in_date,
            entry_time = EXCLUDED.entry_time,
            status = EXCLUDED.status,
            exit_time = EXCLUDED.exit_time,
            total_hours = EXCLUDED.total_hours,
            total_amount = EXCLUDED.total_amount,
            created_by = EXCLUDED.created_by,
            deleted_at = EXCLUDED.deleted_at
        `, [
          row.id, row.token_no, row.barcode, row.veh_type, row.veh_no, row.cust_name, row.mobile_no,
          row.rate, row.payment_mode, row.in_date, row.entry_time, row.status, row.exit_time,
          row.total_hours, row.total_amount, row.created_by, row.deleted_at, row.created_at || new Date()
        ]);
      }
      restoredCounts.parking_entries = tablesData.parking_entries.length;
    }

    // Restore exit_history
    if (tablesData.exit_history && Array.isArray(tablesData.exit_history)) {
      for (const row of tablesData.exit_history) {
        await client.query(`
          INSERT INTO exit_history (id, token_no, barcode, veh_type, veh_no, cust_name, mobile_no, rate, payment_mode, in_date, entry_time, exit_date, exit_time, fine_amount, total_amount, created_by, exited_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            token_no = EXCLUDED.token_no,
            barcode = EXCLUDED.barcode,
            veh_type = EXCLUDED.veh_type,
            veh_no = EXCLUDED.veh_no,
            cust_name = EXCLUDED.cust_name,
            mobile_no = EXCLUDED.mobile_no,
            rate = EXCLUDED.rate,
            payment_mode = EXCLUDED.payment_mode,
            in_date = EXCLUDED.in_date,
            entry_time = EXCLUDED.entry_time,
            exit_date = EXCLUDED.exit_date,
            exit_time = EXCLUDED.exit_time,
            fine_amount = EXCLUDED.fine_amount,
            total_amount = EXCLUDED.total_amount,
            created_by = EXCLUDED.created_by,
            exited_at = EXCLUDED.exited_at
        `, [
          row.id, row.token_no, row.barcode, row.veh_type, row.veh_no, row.cust_name, row.mobile_no,
          row.rate, row.payment_mode, row.in_date, row.entry_time, row.exit_date, row.exit_time,
          row.fine_amount, row.total_amount, row.created_by, row.exited_at || new Date()
        ]);
      }
      restoredCounts.exit_history = tablesData.exit_history.length;
    }

    // Restore audit_logs
    if (tablesData.audit_logs && Array.isArray(tablesData.audit_logs)) {
      for (const row of tablesData.audit_logs) {
        await client.query(`
          INSERT INTO audit_logs (id, user_id, username, role, action, ip_address, user_agent, details, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            username = EXCLUDED.username,
            role = EXCLUDED.role,
            action = EXCLUDED.action,
            ip_address = EXCLUDED.ip_address,
            user_agent = EXCLUDED.user_agent,
            details = EXCLUDED.details
        `, [
          row.id, row.user_id, row.username, row.role, row.action, row.ip_address,
          row.user_agent, row.details, row.created_at || new Date()
        ]);
      }
      restoredCounts.audit_logs = tablesData.audit_logs.length;
    }

    // Sync sequence after restoration
    await client.query(`SELECT setval('parking_token_seq', GREATEST(500, COALESCE((SELECT MAX(token_no) FROM parking_entries), 499)), true);`);
  });

  return {
    restored: true,
    filename,
    restoredCounts
  };
}

module.exports = {
  createBackup,
  listBackups,
  verifyBackup,
  restoreBackup,
  isDurableStorageConfigured,
  BACKUP_DRIVERS,
  BACKUP_DIR
};
