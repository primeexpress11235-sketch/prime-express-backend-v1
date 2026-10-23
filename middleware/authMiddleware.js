import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { error } from '../utils/sendResponse.js';

/**
 * Protect Route Middleware
 * Verifies JWT token from httpOnly cookie and attaches user to request
 */
export const protect = async (req, res, next) => {
  try {
    // Accept token from httpOnly cookie, Authorization header (Bearer), or URL query param
    let token = req.cookies?.token;
    if (!token && req.headers?.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token && req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      return error(res, 401, 'Not authorized to access this route');
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');

      if (!user) {
        return error(res, 404, 'User not found');
      }

      req.user = user;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return error(res, 401, 'Token expired');
      }
      return error(res, 401, 'Invalid token');
    }
  } catch (err) {
    return error(res, 500, err.message);
  }
};

/**
 * Optional Auth Middleware
 * If a JWT cookie is present, verify it and attach the user to `req.user`.
 * If no token is present or verification fails, continue without error.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.token;
    if (!token && req.headers?.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return next();

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user) req.user = user;
    } catch (err) {
      // silently ignore invalid/expired token for optional auth
    }

    return next();
  } catch (err) {
    return next();
  }
};

/**
 * Admin Only Middleware
 * Ensures the authenticated user has admin role
 */
function normalizedRole(user) {
  if (!user?.role) return '';
  return String(user.role).trim().toLowerCase();
}

export const adminOnly = (req, res, next) => {
  if (!req.user) {
    return error(res, 401, 'Not authenticated');
  }

  if (normalizedRole(req.user) !== 'admin') {
    const current = req.user.role == null ? 'missing' : String(req.user.role);
    const hint =
      process.env.NODE_ENV === 'development'
        ? ` Your account role in the database is "${current}". Only users with role "admin" can call this API.`
        : '';
    return error(res, 403, `Not authorized. Admin access required.${hint}`);
  }

  next();
};

/**
 * Require Role Middleware (factory)
 * Ensures the authenticated user's role is one of the allowed roles. RBAC
 * scaffolding for the admin/dispatcher/sales_agent/carrier roles — only admin
 * gets full UI this phase, but the guard is ready for the others.
 *
 * Usage: router.get('/', protect, requireRole('admin', 'dispatcher'), handler)
 */
export const requireRole = (...roles) => {
  const allowed = roles.map((r) => String(r).trim().toLowerCase());
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 401, 'Not authenticated');
    }
    if (!allowed.includes(normalizedRole(req.user))) {
      return error(res, 403, `Not authorized. Requires role: ${allowed.join(', ')}.`);
    }
    next();
  };
};

export default { protect, optionalAuth, adminOnly, requireRole };
