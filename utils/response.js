/**
 * Standardized API response utility.
 * Enforces consistent JSON response envelope across all endpoints:
 * { success, message, data, pagination, timestamp, requestId }
 *
 * Legacy top-level fields (entries, history, count, etc.) are preserved
 * inside `data` for backward compatibility, and also spread at the root level
 * so existing frontend code continues to work without modification.
 */

/**
 * Send a standardized JSON response.
 * @param {object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {boolean} success - Operation success flag
 * @param {string} message - Human-readable message
 * @param {object} [data={}] - Response payload
 * @param {object|null} [pagination=null] - Pagination metadata
 * @param {object|null} [req=null] - Express request (for requestId)
 */
function sendResponse(res, statusCode, success, message, data = {}, pagination = null, req = null) {
  const envelope = {
    success,
    message,
    ...data, // spread for backward compat with existing frontend
    data,    // structured data envelope for new clients
    timestamp: new Date().toISOString(),
    requestId: req ? (req.id || null) : null
  };

  if (pagination) {
    envelope.pagination = pagination;
  }

  return res.status(statusCode).json(envelope);
}

/**
 * Build a pagination metadata object.
 * @param {number} page - Current page (1-based)
 * @param {number} limit - Page size
 * @param {number} total - Total record count
 */
function buildPagination(page, limit, total) {
  return {
    currentPage: page,
    pageSize: limit,
    totalRecords: total,
    totalPages: Math.ceil(total / limit)
  };
}

module.exports = {
  sendResponse,
  buildPagination
};
