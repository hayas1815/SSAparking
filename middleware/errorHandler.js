/**
 * Centralized Error Handling Middleware for Express.
 * Includes requestId in every error response for distributed tracing and debugging.
 * Never exposes stack traces in production.
 */
function errorHandler(err, req, res, next) {
  const requestId = req ? (req.id || null) : null;
  console.error(`[SERVER ERROR] [ReqID:${requestId || 'N/A'}]`, err.message || err);

  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.errorCode || (
    statusCode === 401 ? 'UNAUTHORIZED' :
    statusCode === 403 ? 'FORBIDDEN' :
    statusCode === 404 ? 'NOT_FOUND' :
    'INTERNAL_SERVER_ERROR'
  );
  const message = err.message || 'An unexpected internal server error occurred.';

  res.status(statusCode).json({
    success: false,
    message,
    errorCode,
    requestId,
    timestamp: new Date().toISOString()
  });
}

/**
 * 404 Not Found Middleware for unknown API routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    errorCode: 'NOT_FOUND',
    requestId: req.id || null,
    timestamp: new Date().toISOString()
  });
}

module.exports = { errorHandler, notFoundHandler };
