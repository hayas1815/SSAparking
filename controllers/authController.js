const db = require('../db');
const { comparePassword } = require('../utils/password');
const { generateToken } = require('../utils/jwt');
const { logAudit } = require('../utils/logger');

/**
 * Handles User Login
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;

    const lowerUsername = username.toLowerCase().trim();

    // Query user by username — include is_active flag
    const query = `SELECT id, username, password, full_name, phone, role, is_active FROM users WHERE LOWER(username) = $1`;
    const result = await db.query(query, [lowerUsername]);
    const user = result.rows[0];

    if (!user) {
      await logAudit(req, 'FAILED_LOGIN', `Failed login attempt for username: ${username}`, null, username);
      return res.status(401).json({
        success: false,
        message: 'Invalid Username or Password',
        errorCode: 'UNAUTHORIZED',
        timestamp: new Date().toISOString()
      });
    }

    // Reject deactivated users
    if (user.is_active === false) {
      await logAudit(req, 'FAILED_LOGIN', `Deactivated account login attempt: ${user.username}`, user.id, user.username);
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Contact the administrator.',
        errorCode: 'ACCOUNT_DEACTIVATED',
        timestamp: new Date().toISOString()
      });
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      await logAudit(req, 'FAILED_LOGIN', `Failed password verification for user: ${user.username}`, user.id, user.username);
      return res.status(401).json({
        success: false,
        message: 'Invalid Username or Password',
        errorCode: 'UNAUTHORIZED',
        timestamp: new Date().toISOString()
      });
    }

    const token = generateToken(user);

    await logAudit(req, 'LOGIN', `User logged in successfully`, user.id, user.username);

    res.json({
      success: true,
      message: 'Login successful!',
      token: token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal authentication error.',
      errorCode: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handles User Logout
 */
async function logout(req, res) {
  try {
    if (req.user) {
      await logAudit(req, 'LOGOUT', 'User logged out', req.user.id, req.user.username);
    }
    res.json({
      success: true,
      message: 'Logged out successfully!'
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
 * Get Current User Profile (Token validation test)
 */
async function getMe(req, res) {
  res.json({
    success: true,
    user: req.user
  });
}

module.exports = {
  login,
  logout,
  getMe
};
