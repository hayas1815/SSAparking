const db = require('../db');
const { hashPassword } = require('../utils/password');
const { logAudit } = require('../utils/logger');

function setSetupStatusNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

/**
 * Check if initial setup is required (if no active owner user exists)
 * Returns unambiguous setupRequired and hasOwner status.
 */
async function getSetupStatus(req, res) {
  setSetupStatusNoCacheHeaders(res);

  try {
    const result = await db.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(TRIM(role)) = 'owner'
            AND is_active IS TRUE
        ) as has_owner,
        (SELECT COUNT(*) FROM users) as total_users,
        (
          SELECT COUNT(*)
          FROM users
          WHERE LOWER(TRIM(role)) = 'owner'
            AND is_active IS TRUE
        ) as active_owner_count
    `);

    const hasOwner = Boolean(result.rows[0].has_owner);
    const totalUsers = parseInt(result.rows[0].total_users || '0', 10);
    const activeOwnerCount = parseInt(result.rows[0].active_owner_count || '0', 10);
    const setupRequired = !hasOwner;

    console.info('[SETUP STATUS]', {
      hasOwner,
      userCount: totalUsers,
      activeOwnerCount
    });

    res.json({
      success: true,
      setupRequired,
      hasOwner,
      isSetupRequired: setupRequired, // Backward compatibility
      userCount: totalUsers
    });
  } catch (err) {
    console.error('Setup status check error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve setup status.',
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Initial One-Time Setup to create the first Owner account.
 * Atomically guarded against duplicate owner creation using database transaction.
 */
async function createInitialOwner(req, res) {
  const { username, password, fullName, phone } = req.body || {};

  if (!username || !password || !fullName) {
    return res.status(400).json({
      success: false,
      message: 'Username, password, and full name are required.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  const cleanUsername = String(username).toLowerCase().trim();
  const cleanFullName = String(fullName).trim();
  const cleanPhone = String(phone || '').trim();

  try {
    let newOwner = null;

    await db.transaction(async (client) => {
      // 1. Check if an active owner already exists
      const ownerCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1
          FROM users
          WHERE LOWER(TRIM(role)) = 'owner'
            AND is_active IS TRUE
        ) as has_owner
      `);

      if (ownerCheck.rows[0].has_owner) {
        const err = new Error('Setup is already complete. Please log in.');
        err.statusCode = 409;
        err.errorCode = 'SETUP_ALREADY_COMPLETED';
        throw err;
      }

      // 2. Check if username is already taken
      const userCheck = await client.query(
        `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)`,
        [cleanUsername]
      );

      if (userCheck.rows.length > 0) {
        const err = new Error('Username is already taken. Please choose a different username.');
        err.statusCode = 409;
        err.errorCode = 'USERNAME_EXISTS';
        throw err;
      }

      // 3. Hash password and insert owner
      const hashedPassword = await hashPassword(password);

      const insertSql = `
        INSERT INTO users (username, password, full_name, phone, role, is_active)
        VALUES ($1, $2, $3, $4, 'owner', true)
        RETURNING id, username, full_name, role, is_active
      `;

      const result = await client.query(insertSql, [cleanUsername, hashedPassword, cleanFullName, cleanPhone]);
      newOwner = result.rows[0];

      if (String(newOwner.role).trim().toLowerCase() !== 'owner' || newOwner.is_active !== true) {
        throw new Error('Created owner account failed role or active-state verification.');
      }
    });

    await logAudit(req, 'INITIAL_SETUP', `First owner account created: ${newOwner.username}`, newOwner.id, newOwner.username);

    return res.status(201).json({
      success: true,
      message: 'Owner account created successfully! You can now log in.',
      setupRequired: false,
      hasOwner: true,
      isSetupRequired: false,
      owner: {
        id: newOwner.id,
        username: newOwner.username,
        fullName: newOwner.full_name,
        role: newOwner.role
      }
    });
  } catch (err) {
    if (err.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: err.message,
        errorCode: err.errorCode || 'SETUP_ALREADY_COMPLETED',
        timestamp: new Date().toISOString()
      });
    }

    console.error('Initial setup error:', err);
    return res.status(500).json({
      success: false,
      message: err.message ? `Setup failed: ${err.message}` : 'Setup failed.',
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  getSetupStatus,
  createInitialOwner
};
