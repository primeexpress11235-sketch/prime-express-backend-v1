/**
 * Standardized API Response Helpers
 * Consistent response format for all endpoints
 */

export const success = (res, statusCode = 200, data = null, message = 'Success') => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const error = (res, statusCode = 500, message = 'Server Error') => {
  return res.status(statusCode).json({
    success: false,
    message,
  });
};

export default { success, error };
