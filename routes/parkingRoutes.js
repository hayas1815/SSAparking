const express = require('express');
const router = express.Router();
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');
const { validateParkingEntry, validateCheckout } = require('../middleware/validationMiddleware');
const { backupRateLimiter, jobRateLimiter } = require('../middleware/rateLimiter');
const {
  getNextToken,
  getEntries,
  createEntry,
  lookupVehicle,
  checkoutVehicle,
  getHistory,
  clearAllEntries,
  getDashboardStats,
  advancedSearch,
  exportReport,
  getAuditLogs,
  handleCreateBackup,
  handleListBackups,
  handleVerifyBackup,
  handleRestoreBackup,
  handleTriggerJob,
  getDiagnostics
} = require('../controllers/parkingController');

// GET /api/parking/next-token - Get next sequence token (all authenticated)
router.get('/next-token', verifyToken, getNextToken);

// GET /api/parking/entries - Get all active parking entries
router.get('/entries', verifyToken, verifyRole('owner', 'manager', 'cashier', 'security'), getEntries);

// POST /api/parking/entry - Save new parking entry
router.post('/entry', verifyToken, verifyRole('owner', 'manager', 'cashier', 'security'), validateParkingEntry, createEntry);

// GET /api/parking/lookup - Lookup vehicle by barcode/token for exit
router.get('/lookup', verifyToken, verifyRole('owner', 'manager', 'cashier', 'security'), lookupVehicle);

// POST /api/parking/checkout - Complete vehicle exit checkout
router.post('/checkout', verifyToken, verifyRole('owner', 'manager', 'cashier', 'security'), validateCheckout, checkoutVehicle);

// GET /api/parking/history - Get paginated exit history (?page=1&limit=50)
router.get('/history', verifyToken, verifyRole('owner', 'manager'), getHistory);

// DELETE /api/parking/entries - Soft delete all active entries (owner only)
router.delete('/entries', verifyToken, verifyRole('owner'), clearAllEntries);

// GET /api/parking/dashboard - Dashboard statistics (views + PL/pgSQL function)
router.get('/dashboard', verifyToken, verifyRole('owner', 'manager'), getDashboardStats);

// GET /api/parking/search - Advanced multi-field search with pagination
router.get('/search', verifyToken, verifyRole('owner', 'manager', 'cashier', 'security'), advancedSearch);

// GET /api/parking/export - Export report as CSV, Excel, or PDF
// ?format=csv|excel|pdf&type=history|active|daily|monthly
router.get('/export', verifyToken, verifyRole('owner', 'manager'), exportReport);

// GET /api/parking/audit-logs - Get paginated audit logs (owner/manager)
router.get('/audit-logs', verifyToken, verifyRole('owner', 'manager'), getAuditLogs);

// Backup System Endpoints (owner only) — rate-limited to prevent abuse
router.post('/backup', verifyToken, verifyRole('owner'), backupRateLimiter, handleCreateBackup);
router.get('/backups', verifyToken, verifyRole('owner'), handleListBackups);
router.post('/backup/verify', verifyToken, verifyRole('owner'), backupRateLimiter, handleVerifyBackup);
router.post('/backup/restore', verifyToken, verifyRole('owner'), backupRateLimiter, handleRestoreBackup);

// POST /api/jobs/trigger — Manually trigger a background maintenance job (owner only)
router.post('/jobs/trigger', verifyToken, verifyRole('owner'), jobRateLimiter, handleTriggerJob);

// GET /api/admin/diagnostics — Full server + DB diagnostics (owner only)
router.get('/admin/diagnostics', verifyToken, verifyRole('owner'), getDiagnostics);

module.exports = router;
