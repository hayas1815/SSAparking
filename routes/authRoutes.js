const express = require('express');
const router = express.Router();
const { login, logout, getMe } = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { validateLogin } = require('../middleware/validationMiddleware');
const { authRateLimiter } = require('../middleware/rateLimiter');

// POST /api/login - Authenticate user and return JWT
router.post('/login', authRateLimiter, validateLogin, login);

// POST /api/logout - Logout (JWT-based, token removed on frontend)
router.post('/logout', verifyToken, logout);

// GET /api/me - Get current authenticated user info
router.get('/me', verifyToken, getMe);

module.exports = router;
