/**
 * Vercel Cron / External Scheduler Routes.
 *
 * GET /api/cron/run — Vercel Cron execution (HTTP GET).
 * Authentication: Authorization: Bearer <CRON_SECRET> (timing-safe).
 *
 * POST /api/cron/run — Owner manual dry-run testing only.
 * Authentication: JWT (Owner role) + dryRun=true required.
 *
 * Security:
 *   - Timing-safe comparison (verifies buffer lengths before timingSafeEqual).
 *   - Rejects missing or invalid secrets with HTTP 401.
 *   - Returns HTTP 503 if CRON_SECRET is missing from environment.
 *   - Does NOT accept secrets via query parameters.
 *   - Never exposes CRON_SECRET in logs or responses.
 *   - Uses PostgreSQL advisory locks to prevent overlapping runs.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const env = require('../config/env');
const { runHistoryCleanup, runAuditCleanup } = require('../jobs/scheduler');
const { logAudit } = require('../utils/logger');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

/**
 * Check if CRON_SECRET is configured in environment.
 * @returns {boolean}
 */
function isCronSecretConfigured() {
  const secret = env.CRON_SECRET;
  return Boolean(secret && typeof secret === 'string' && secret.length >= 16);
}

/**
 * Timing-safe comparison of CRON_SECRET.
 * Safely checks buffer lengths before timingSafeEqual to avoid RangeError.
 * @param {string} providedSecret
 * @returns {boolean}
 */
function verifyCronSecret(providedSecret) {
  const expected = env.CRON_SECRET;
  if (!isCronSecretConfigured()) {
    return false;
  }
  if (!providedSecret || typeof providedSecret !== 'string') {
    return false;
  }

  const a = Buffer.from(providedSecret);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Middleware: Validate CRON_SECRET from Authorization header.
 * Rejects query parameter secrets.
 */
function verifyCronAuth(req, res, next) {
  if (!isCronSecretConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'CRON_SECRET is missing from the environment configuration.',
      timestamp: new Date().toISOString()
    });
  }

  const authHeader = req.headers['authorization'] || '';
  let secret = '';

  if (authHeader.startsWith('Bearer ')) {
    secret = authHeader.slice(7).trim();
  }

  if (!verifyCronSecret(secret)) {
    console.warn(`[CRON] Unauthorized cron request from ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: 'Unauthorized. Invalid or missing cron secret.',
      timestamp: new Date().toISOString()
    });
  }

  req.user = { id: null, username: 'CRON_SCHEDULER', role: 'system' };
  next();
}

/**
 * GET /api/cron/run
 * Primary Vercel Cron handler.
 * Executes all scheduled maintenance tasks safely with advisory locks.
 */
router.get('/run', verifyCronAuth, async (req, res) => {
  try {
    const historyRes = await runHistoryCleanup({ dryRun: false });
    const auditRes = await runAuditCleanup({ dryRun: false });

    await logAudit(req, 'CRON_JOB', 'Scheduled maintenance completed via Vercel GET /api/cron/run');

    return res.status(200).json({
      success: true,
      message: 'Scheduled maintenance completed',
      data: {
        historyCleanup: {
          status: historyRes.locked ? 'completed' : 'locked',
          affectedRows: historyRes.affectedRows || 0
        },
        auditCleanup: {
          status: auditRes.locked ? 'completed' : 'locked',
          affectedRows: auditRes.affectedRows || 0
        },
        backupRetentionCleanup: {
          status: 'skipped',
          reason: 'No durable production backup driver configured'
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[CRON] Scheduled maintenance failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Scheduled maintenance failed.',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/cron/run
 * Owner-only manual testing. Restricted to dry-run operations only.
 * Prevents non-owner or live destructive cleanup via POST.
 */
router.post('/run', verifyToken, verifyRole('owner'), async (req, res) => {
  try {
    const isDryRun = req.body.dryRun === true || req.query.dryRun === 'true';

    if (!isDryRun) {
      return res.status(400).json({
        success: false,
        message: 'POST /api/cron/run is restricted to manual dry-run testing only. Set dryRun: true in body or query parameters.',
        timestamp: new Date().toISOString()
      });
    }

    const { job } = req.body || {};
    let historyRes, auditRes;

    if (!job || job === 'all') {
      historyRes = await runHistoryCleanup({ dryRun: true });
      auditRes = await runAuditCleanup({ dryRun: true });
    } else if (job === 'history-cleanup') {
      historyRes = await runHistoryCleanup({ dryRun: true });
    } else if (job === 'audit-cleanup') {
      auditRes = await runAuditCleanup({ dryRun: true });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid job specified. Supported: history-cleanup, audit-cleanup, or all.',
        timestamp: new Date().toISOString()
      });
    }

    await logAudit(req, 'CRON_JOB_DRYRUN', `Owner triggered dry-run cron test: ${job || 'all'}`);

    return res.status(200).json({
      success: true,
      message: 'Manual dry-run cron test executed successfully',
      data: {
        historyCleanup: historyRes ? { status: 'dry-run', affectedRows: historyRes.affectedRows || 0 } : undefined,
        auditCleanup: auditRes ? { status: 'dry-run', affectedRows: auditRes.affectedRows || 0 } : undefined,
        backupRetentionCleanup: { status: 'skipped', reason: 'No durable production backup driver configured' }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[CRON] Manual dry-run test failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Manual dry-run cron test failed.',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
module.exports.verifyCronSecret = verifyCronSecret;
module.exports.isCronSecretConfigured = isCronSecretConfigured;
