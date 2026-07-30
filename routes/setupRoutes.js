const express = require('express');
const router = express.Router();
const { getSetupStatus, createInitialOwner } = require('../controllers/setupController');
const { validateSetup } = require('../middleware/validationMiddleware');
const { authRateLimiter } = require('../middleware/rateLimiter');

// GET /api/setup/status - Check whether initial setup is required
router.get('/status', getSetupStatus);

// POST /api/setup - One-time initial owner creation (rate-limited, self-disables after first user created)
router.post('/', authRateLimiter, validateSetup, createInitialOwner);

module.exports = router;
