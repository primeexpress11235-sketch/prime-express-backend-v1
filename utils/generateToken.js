import jwt from 'jsonwebtoken';

/**
 * Generate JWT Token
 * Creates a signed JWT token for authentication
 */
export const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

export default generateToken;
