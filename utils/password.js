const bcrypt = require('bcryptjs');
const env = require('../config/env');

const BCRYPT_ROUNDS = Math.max(12, env.BCRYPT_ROUNDS || 12);

/**
 * Hashes a plain text password using bcrypt with cost factor 12.
 * @param {string} password 
 * @returns {Promise<string>} Hashed password string
 */
async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(password, salt);
}

/**
 * Compares a plain text password with a bcrypt hash.
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>} Match result
 */
async function comparePassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch (err) {
    return false;
  }
}

module.exports = {
  hashPassword,
  comparePassword
};
