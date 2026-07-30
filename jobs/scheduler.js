const env = require('../config/env');
const db = require('../db');
const { createBackup } = require('../utils/backup');

/**
 * Background Job Scheduler
 * Runs periodic maintenance tasks without blocking API request handling.
 * All jobs use setInterval with try/catch to prevent crashing the server.
 *
 * VERCEL/SERVERLESS NOTE:
 * setInterval does NOT persist in serverless environments (Vercel, AWS Lambda).
 * On serverless, the scheduler is disabled automatically.
 * Use POST /api/parking/jobs/trigger with an external cron service instead:
 *   - Vercel Cron (vercel.json crons)
 *   - cron-job.org
 *   - GitHub Actions scheduled workflow
 */

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let cleanupInterval = null;
let backupInterval = null;
let auditCleanupInterval = null;
let statsRefreshInterval = null;

/**
 * Purge exit history older than HISTORY_RETENTION_DAYS.
 * Uses PostgreSQL advisory lock (882501) to prevent concurrent executions.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - If true, counts affected rows without deleting.
 * @returns {Promise<{ affectedRows: number, dryRun: boolean, locked: boolean, startedAt: string, completedAt: string }>}
 */
async function runHistoryCleanup(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const retentionDays = Math.max(1, parseInt(env.HISTORY_RETENTION_DAYS || '45', 10));
  const LOCK_KEY = 882501;
  const startedAt = new Date().toISOString();

  try {
    const lockRes = await db.query('SELECT pg_try_advisory_lock($1) as acquired', [LOCK_KEY]);
    if (!lockRes.rows[0]?.acquired) {
      console.log('[SCHEDULER] History cleanup skipped: lock already acquired by another worker.');
      return { affectedRows: 0, dryRun, locked: false, startedAt, completedAt: new Date().toISOString() };
    }

    try {
      let affectedRows = 0;
      if (dryRun) {
        const checkRes = await db.query(
          `SELECT COUNT(*) as cnt FROM exit_history WHERE exited_at < NOW() - INTERVAL '${retentionDays} days'`
        );
        affectedRows = parseInt(checkRes.rows[0].cnt, 10);
        console.log(`[SCHEDULER] [DRY RUN] History cleanup: ${affectedRows} expired records identified (> ${retentionDays} days).`);
      } else {
        const result = await db.query(
          `DELETE FROM exit_history WHERE exited_at < NOW() - INTERVAL '${retentionDays} days'`
        );
        affectedRows = result.rowCount || 0;
        if (affectedRows > 0) {
          console.log(`[SCHEDULER] History cleanup: removed ${affectedRows} records older than ${retentionDays} days.`);
        }
      }
      return { affectedRows, dryRun, locked: true, startedAt, completedAt: new Date().toISOString() };
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } catch (err) {
    console.error('[SCHEDULER] History cleanup failed:', err.message);
    throw err;
  }
}

/**
 * Purge audit_logs older than 90 days.
 * Uses PostgreSQL advisory lock (882502) to prevent concurrent executions.
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<{ affectedRows: number, dryRun: boolean, locked: boolean, startedAt: string, completedAt: string }>}
 */
async function runAuditCleanup(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const LOCK_KEY = 882502;
  const startedAt = new Date().toISOString();

  try {
    const lockRes = await db.query('SELECT pg_try_advisory_lock($1) as acquired', [LOCK_KEY]);
    if (!lockRes.rows[0]?.acquired) {
      console.log('[SCHEDULER] Audit cleanup skipped: lock already acquired.');
      return { affectedRows: 0, dryRun, locked: false, startedAt, completedAt: new Date().toISOString() };
    }

    try {
      let affectedRows = 0;
      if (dryRun) {
        const checkRes = await db.query(
          `SELECT COUNT(*) as cnt FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days'`
        );
        affectedRows = parseInt(checkRes.rows[0].cnt, 10);
        console.log(`[SCHEDULER] [DRY RUN] Audit cleanup: ${affectedRows} old log records identified.`);
      } else {
        const result = await db.query(
          `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days'`
        );
        affectedRows = result.rowCount || 0;
        if (affectedRows > 0) {
          console.log(`[SCHEDULER] Audit cleanup: removed ${affectedRows} old audit log records.`);
        }
      }
      return { affectedRows, dryRun, locked: true, startedAt, completedAt: new Date().toISOString() };
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } catch (err) {
    console.error('[SCHEDULER] Audit cleanup failed:', err.message);
    throw err;
  }
}

/**
 * Refresh materialized statistics (lightweight query to warm indexes).
 */
async function runStatsRefresh() {
  try {
    await db.query(`SELECT COUNT(*) FROM parking_entries WHERE status = 'ACTIVE' OR status IS NULL`);
    await db.query(`SELECT COUNT(*) FROM exit_history WHERE exited_at >= NOW() - INTERVAL '1 day'`);
    return { refreshed: true };
  } catch (err) {
    console.error('[SCHEDULER] Stats refresh failed:', err.message);
    throw err;
  }
}

/**
 * Automated daily backup creation.
 */
async function runAutoBackup() {
  try {
    const backupInfo = await createBackup();
    console.log(`[SCHEDULER] Auto backup created: ${backupInfo.filename} (${backupInfo.totalRows} rows)`);
    return backupInfo;
  } catch (err) {
    console.error('[SCHEDULER] Auto backup failed:', err.message);
    throw err;
  }
}

/**
 * Start all background job intervals.
 * Skipped in serverless environments where setInterval has no effect.
 */
function startScheduler() {
  if (IS_SERVERLESS) {
    console.log('[SCHEDULER] Serverless environment detected — setInterval scheduler disabled.');
    console.log('[SCHEDULER] Use POST /api/parking/jobs/trigger with an external cron service.');
    return;
  }

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Run initial history cleanup after 30 seconds
  setTimeout(() => runHistoryCleanup().catch(() => {}), 30 * 1000);
  setTimeout(() => runAuditCleanup().catch(() => {}), 45 * 1000);

  // Recurring jobs
  cleanupInterval = setInterval(() => runHistoryCleanup().catch(() => {}), TWENTY_FOUR_HOURS);
  auditCleanupInterval = setInterval(() => runAuditCleanup().catch(() => {}), TWENTY_FOUR_HOURS);
  statsRefreshInterval = setInterval(() => runStatsRefresh().catch(() => {}), 5 * 60 * 1000);
  backupInterval = setInterval(() => runAutoBackup().catch(() => {}), TWENTY_FOUR_HOURS);

  console.log('[SCHEDULER] Background job scheduler started.');
}

/**
 * Stop all active background job intervals gracefully.
 */
function stopScheduler() {
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (backupInterval) clearInterval(backupInterval);
  if (auditCleanupInterval) clearInterval(auditCleanupInterval);
  if (statsRefreshInterval) clearInterval(statsRefreshInterval);
  console.log('[SCHEDULER] Background scheduler stopped.');
}

module.exports = {
  startScheduler,
  stopScheduler,
  runHistoryCleanup,
  runAuditCleanup,
  runStatsRefresh,
  runAutoBackup
};
