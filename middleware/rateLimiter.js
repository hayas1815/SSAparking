const rateLimit = require('express-rate-limit');

/**
 * Login & Setup Rate Limiter
 * Limits to 5 attempts per IP within 15 minutes window.
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Maximum 5 requests per window
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    success: false,
    message: 'Too many failed login attempts. Please try again after 15 minutes.',
    errorCode: 'TOO_MANY_REQUESTS',
    timestamp: new Date().toISOString()
  },
  handler: (req, res, next, options) => {
    res.status(429).json({
      success: false,
      message: 'Too many login attempts from this IP address. Please try again after 15 minutes.',
      errorCode: 'TOO_MANY_REQUESTS',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = {
  authRateLimiter,

  /**
   * Backup & Restore Rate Limiter
   * Limits destructive/expensive backup operations to 3 per 10 minutes per IP.
   */
  backupRateLimiter: rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: 'Too many backup/restore requests. Please wait before retrying.',
        errorCode: 'TOO_MANY_REQUESTS',
        timestamp: new Date().toISOString()
      });
    }
  }),

  /**
   * Job Trigger Rate Limiter
   * Limits manual job triggers to 5 per 15 minutes per IP.
   */
  jobRateLimiter: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: 'Too many job trigger requests. Please wait before retrying.',
        errorCode: 'TOO_MANY_REQUESTS',
        timestamp: new Date().toISOString()
      });
    }
  })
};
