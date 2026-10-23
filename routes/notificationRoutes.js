import express from 'express';
import * as notificationController from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// @route   GET /api/notifications
// @desc    Get notifications
// @access  Private
router.get('/', protect, notificationController.getNotifications);

// @route   GET /api/notifications/unread-count
// @desc    Get count of unread notifications
// @access  Private
router.get('/unread-count', protect, notificationController.getUnreadCount);

// @route   PATCH /api/notifications/mark-all-read
// @desc    Mark all notifications as read
// @access  Private
router.patch('/mark-all-read', protect, notificationController.markAllAsRead);

// @route   PATCH /api/notifications/read-all
// @desc    Mark all notifications as read (alias)
// @access  Private
router.patch('/read-all', protect, notificationController.markAllAsRead);

// @route   PATCH /api/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.patch('/:id/read', protect, notificationController.markAsRead);

// @route   DELETE /api/notifications/:id
// @desc    Delete notification
// @access  Private
router.delete('/:id', protect, notificationController.deleteNotification);

export default router;
