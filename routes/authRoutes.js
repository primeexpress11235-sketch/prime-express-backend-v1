import express from 'express';
import * as authController from '../controllers/authController.js';
import multer from 'multer';

const memory = multer({ storage: multer.memoryStorage() });
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// @route   POST /api/auth/admin-setup
// @desc    Create first admin (one-time only)
// @access  Public
router.post('/admin-setup', authController.adminSetup);

// @route   GET /api/auth/admin-exists
// @desc    Check if admin exists
// @access  Public
router.get('/admin-exists', authController.adminExists);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', authController.login);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', protect, authController.logout);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, authController.getMe);

// @route   PUT /api/auth/change-password
// @desc    Change password
// @access  Private
router.put('/change-password', protect, authController.changePassword);

// @route   PUT /api/auth/me
// @desc    Update current user's profile (name)
// @access  Private
router.put('/me', protect, authController.updateMe);

// @route   POST /api/auth/me/avatar
// @desc    Upload current user's avatar
// @access  Private
router.post('/me/avatar', protect, memory.single('avatar'), authController.uploadMyAvatar);

export default router;
