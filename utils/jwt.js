const jwt = require('jsonwebtoken');
const env = require('../config/env');

const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRES_IN = '24h';

/**
 * Generates a signed JWT token for an authenticated user.
 * Includes Expiration (exp), Issued At (iat), and enforces HS256 algorithm.
 * @param {object} user 
 * @returns {string} Signed JWT token
 */
function generateToken(user) {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing from environment configuration');
  }

  const payload = {
    id: user.id,
    username: user.username,
    fullName: user.fullName || user.full_name,
    role: user.role
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN
  });
}

/**
 * Verifies a JWT token using strict algorithm validation (HS256 only).
 * Rejects 'none' algorithm and malformed or expired tokens.
 * @param {string} token 
 * @returns {object|null} Decoded payload or null if invalid
 */
function verifyJwtToken(token) {
  if (!token || typeof token !== 'string' || !env.JWT_SECRET) {
    return null;
  }

  try {
    return jwt.verify(token, env.JWT_SECRET, {
      algorithms: [JWT_ALGORITHM] // Explicitly enforce HS256 algorithm validation and prevent 'none' algorithm attacks
    });
  } catch (err) {
    return null;
  }
}

module.exports = {
  generateToken,
  verifyJwtToken
};
