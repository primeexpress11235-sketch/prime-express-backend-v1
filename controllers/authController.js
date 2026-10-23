import asyncHandler from 'express-async-handler';
import User from '../models/User.js';
import { success, error } from '../utils/sendResponse.js';
import { generateToken } from '../utils/generateToken.js';
import cloudinary from '../config/cloudinary.js';

/**
 * @route   POST /api/auth/admin-setup
 * @desc    Create first admin user (one-time only)
 * @access  Public
 */
export const adminSetup = asyncHandler(async (req, res) => {
  // Check if admin already exists
  const existingAdmin = await User.findOne({ role: 'admin' });
  if (existingAdmin) {
    return error(res, 403, 'Admin account already exists');
  }

  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return error(res, 400, 'Please provide name, email, and password');
  }

  // Create admin user
  const admin = new User({
    name,
    email,
    password,
    role: 'admin',
    isFirstLogin: false,
  });

  await admin.save();

  // Generate token
  const token = generateToken(admin._id);

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return success(res, 201, { user: { id: admin._id, name: admin.name, email: admin.email, role: admin.role, isFirstLogin: admin.isFirstLogin } }, 'Admin created successfully');
});

/**
 * @route   GET /api/auth/admin-exists
 * @desc    Check if an admin user exists (public)
 * @access  Public
 */
export const adminExists = asyncHandler(async (req, res) => {
  const existingAdmin = await User.findOne({ role: 'admin' }).select('_id');
  const exists = !!existingAdmin;
  return success(res, 200, { exists }, 'Admin existence checked');
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user (admin or team member)
 * @access  Public
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return error(res, 400, 'Please provide email and password');
  }

  // Find user by email and role
  let user = await User.findOne({ email }).select('+password');

  if (!user) {
    return error(res, 401, 'Invalid credentials');
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return error(res, 401, 'Invalid credentials');
  }

  // Check role if specified
  if (role && user.role !== role) {
    return error(res, 401, 'Invalid role');
  }

  // Generate token
  const token = generateToken(user._id);

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return success(
    res,
    200,
    {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        workLocation: user.workLocation,
        isFirstLogin: user.isFirstLogin,
        avatar: user.avatar || '',
        contractRequest: { status: user.contractRequest?.status || 'not_sent' },
      },
      token,
    },
    'Logged in successfully'
  );
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
export const logout = asyncHandler(async (req, res) => {
  res.clearCookie('token');
  return success(res, 200, null, 'Logged out successfully');
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
export const getMe = asyncHandler(async (req, res) => {
  const user = req.user;

  return success(res, 200, { id: user._id, name: user.name, email: user.email, role: user.role, workLocation: user.workLocation, isFirstLogin: user.isFirstLogin, avatar: user.avatar || '', contractRequest: { status: user.contractRequest?.status || 'not_sent' } }, 'User profile retrieved');
});

/**
 * @route   PUT /api/auth/me
 * @desc    Update current user's profile (name)
 * @access  Private
 */
export const updateMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return error(res, 404, 'User not found');

  const { name } = req.body;
  if (name !== undefined) user.name = name;

  await user.save();

  return success(res, 200, { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar || '' }, 'Profile updated');
});

/**
 * @route   POST /api/auth/me/avatar
 * @desc    Upload current user's avatar via server-side Cloudinary
 * @access  Private
 */
export const uploadMyAvatar = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return error(res, 404, 'User not found');

  if (!req.file) return error(res, 400, 'No file uploaded');

  const uploadFromBuffer = (buffer, opts = {}) => new Promise((resolve, reject) => {
    try {
      const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      stream.end(buffer);
    } catch (e) {
      reject(e);
    }
  });

  try {
    const resu = await uploadFromBuffer(req.file.buffer, { folder: 'dkr/avatars', resource_type: 'image' });
    const avatarUrl = resu?.secure_url || resu?.url;
    if (!avatarUrl) return error(res, 500, 'Failed to upload to Cloudinary');

    user.avatar = avatarUrl;
    await user.save();

    return success(res, 200, { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar }, 'Avatar uploaded');
  } catch (e) {
    console.error('Cloudinary upload error', e);
    return error(res, 500, 'Failed to upload avatar');
  }
});

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return error(res, 400, 'Please provide old and new password');
  }

  const user = await User.findById(req.user._id).select('+password');

  // Verify old password
  const isMatch = await user.comparePassword(oldPassword);
  if (!isMatch) {
    return error(res, 401, 'Old password is incorrect');
  }

  // Update password
  user.password = newPassword;
  user.isFirstLogin = false;
  await user.save();

  return success(res, 200, null, 'Password changed successfully');
});

export default { adminSetup, login, logout, getMe, changePassword, updateMe, uploadMyAvatar };
