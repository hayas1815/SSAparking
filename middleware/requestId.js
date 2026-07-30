const { randomUUID } = require('crypto');

/**
 * Middleware that generates a unique UUID for every incoming request.
 * Attaches req.id and sets X-Request-ID response header.
 * Used for distributed tracing, debug logging, and audit trail correlation.
 */
function requestId(req, res, next) {
  let id = req.headers['x-request-id'];

  if (typeof id !== 'string' || id.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    id = randomUUID();
  }

  req.requestId = id;
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = requestId;
