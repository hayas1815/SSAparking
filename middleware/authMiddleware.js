const { verifyJwtToken } = require('../utils/jwt');

/**
 * Middleware to verify JWT Access Token from Authorization header.
 * Returns 401 Unauthorized if missing or invalid.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Access token required. Please log in.',
      errorCode: 'UNAUTHORIZED',
      timestamp: new Date().toISOString()
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authorization header format.',
      errorCode: 'UNAUTHORIZED',
      timestamp: new Date().toISOString()
    });
  }

  const token = parts[1];
  const decoded = verifyJwtToken(token);

  if (!decoded) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please log in again.',
      errorCode: 'UNAUTHORIZED',
      timestamp: new Date().toISOString()
    });
  }

  req.user = decoded;
  next();
}

/**
 * Factory middleware to verify user role against allowed roles.
 * Returns 403 Forbidden if user role is not authorized.
 * @param {...string} allowedRoles 
 */
function verifyRole(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map(r => String(r).toLowerCase());
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: 'User authentication context missing.',
        errorCode: 'UNAUTHORIZED',
        timestamp: new Date().toISOString()
      });
    }

    const userRole = String(req.user.role).toLowerCase();
    if (!normalizedAllowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Role '${req.user.role}' is not authorized for this resource.`,
        errorCode: 'FORBIDDEN',
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
}

module.exports = {
  verifyToken,
  verifyRole
};
