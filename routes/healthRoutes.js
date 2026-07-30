const express = require('express');
const router = express.Router();
const db = require('../db');
const packageJson = require('../package.json');

/**
 * GET /health — Minimal public health probe.
 * Returns only what a load balancer or uptime monitor needs.
 * Full diagnostics (DB version, memory, CPU, pool stats) are available
 * to authenticated owners at GET /api/admin/diagnostics.
 */
router.get('/', async (req, res) => {
  const timestamp = new Date().toISOString();
  const version = packageJson.version || '1.0.0';

  // Minimal DB connectivity test — no version or pool stats exposed
  let dbStatus = 'disconnected';
  try {
    await db.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    console.error('[HEALTH] Database check error:', err.message);
  }

  const statusCode = dbStatus === 'connected' ? 200 : 503;

  return res.status(statusCode).json({
    success: dbStatus === 'connected',
    server: 'running',
    database: dbStatus,
    timestamp,
    version
  });
});

/**
 * GET /health/ready — Kubernetes / Vercel Readiness Probe.
 * A lightweight liveness check used by load balancers.
 * Returns 200 OK immediately (no DB call) to confirm the Node process is alive.
 */
router.get('/ready', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /health/db — Isolated database-only connectivity check.
 * Useful for diagnosing DB connection issues independently of the full health check.
 */
router.get('/db', async (req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1 AS ping');
    const latencyMs = Date.now() - start;

    return res.status(200).json({
      success: true,
      database: 'connected',
      latencyMs,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[HEALTH/DB] Database ping failed:', err.message);
    return res.status(503).json({
      success: false,
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
