const db = require('../db');
const { hashPassword } = require('../utils/password');
const { logAudit } = require('../utils/logger');

/**
 * Check if initial setup is required (if users table has 0 users)
 */
async function getSetupStatus(req, res) {
  try {
    const result = await db.query(`SELECT COUNT(*) as count FROM users`);
    const userCount = parseInt(result.rows[0].count, 10);

    res.json({
      success: true,
      isSetupRequired: userCount === 0,
      userCount: userCount
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Initial One-Time Setup to create the first Owner account
 */
async function createInitialOwner(req, res) {
  try {
    const countResult = await db.query(`SELECT COUNT(*) as count FROM users`);
    const userCount = parseInt(countResult.rows[0].count, 10);

    if (userCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'Initial setup disabled. Owner account has already been registered.',
        errorCode: 'SETUP_DISABLED',
        timestamp: new Date().toISOString()
      });
    }

    const { username, password, fullName, phone } = req.body;
    const hashedPassword = await hashPassword(password);
    const cleanUsername = username.toLowerCase().trim();

    const insertSql = `
      INSERT INTO users (username, password, full_name, phone, role)
      VALUES ($1, $2, $3, $4, 'owner')
      RETURNING id, username, full_name, role
    `;
    const result = await db.query(insertSql, [cleanUsername, hashedPassword, fullName, phone || '']);
    const newOwner = result.rows[0];

    await logAudit(req, 'INITIAL_SETUP', `First owner account created: ${newOwner.username}`, newOwner.id, newOwner.username);

    res.status(201).json({
      success: true,
      message: 'Owner account created successfully! You can now log in.',
      owner: {
        id: newOwner.id,
        username: newOwner.username,
        fullName: newOwner.full_name,
        role: newOwner.role
      }
    });
  } catch (err) {
    console.error('Initial setup error:', err);
    res.status(500).json({
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
