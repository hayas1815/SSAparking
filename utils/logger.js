const db = require('../db');

/**
 * Enhanced Audit Logger with request ID tracking.
 * Records: timestamp, requestId, userId, username, role, ip, userAgent, action, details.
 */
async function logAudit(req, action, details = '', userId = null, username = null, role = null) {
  try {
    const effectiveUserId = userId || (req && req.user ? req.user.id : null);
    const effectiveUsername = username || (req && req.user ? req.user.username : null) || '';
    const effectiveRole = role || (req && req.user ? req.user.role : null) || '';
    const requestId = req ? (req.id || '') : '';

    const ip = (req && req.headers)
      ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '')
      : '';

    const userAgent = (req && req.headers) ? (req.headers['user-agent'] || '') : '';
    const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
    const timestamp = new Date().toISOString();

    console.log(`[AUDIT] [${timestamp}] [ReqID:${requestId || 'N/A'}] Action: ${action} | User: ${effectiveUsername || 'Anonymous'} (Role: ${effectiveRole || 'N/A'}, ID: ${effectiveUserId || 'N/A'}) | IP: ${ip} | ${detailStr}`);

    await db.query(
      `INSERT INTO audit_logs (user_id, username, role, action, ip_address, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [effectiveUserId, effectiveUsername, effectiveRole, action, ip, userAgent,
        requestId ? `[ReqID:${requestId}] ${detailStr}` : detailStr]
    );
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { logAudit };
