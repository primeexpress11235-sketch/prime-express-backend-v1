import asyncHandler from 'express-async-handler';
import Notification from '../models/Notification.js';
import { success, error } from '../utils/sendResponse.js';
import logger from '../utils/logger.js';

/**
 * @route   GET /api/notifications
 * @desc    Get notifications for current user/admin
 * @access  Private
 */
export const getNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly = false, type = 'all', page = 1, limit = 50 } = req.query;
  const skip = (page - 1) * limit;

  const recipientQuery = {
    $or: [
      { recipient: req.user._id },
      { recipient: null },
      { recipient: { $exists: false } },
    ],
  };

  let query = { ...recipientQuery };

  if (unreadOnly === 'true') {
    query.isRead = false;
  }

  if (type && type !== 'all') {
    query.type = type;
  }

  // Sort unread first (isRead: false/0 before true/1), then newest first
  const notifications = await Notification.find(query)
    .sort({ isRead: 1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Notification.countDocuments(query);
  const unreadTotal = await Notification.countDocuments({ ...recipientQuery, isRead: false });

  return success(
    res,
    200,
    { notifications, total, unreadTotal, page: parseInt(page), limit: parseInt(limit) },
    'Notifications retrieved'
  );
});

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get count of unread notifications
 * @access  Private
 */
export const getUnreadCount = asyncHandler(async (req, res) => {
  const query = {
    isRead: false,
    $or: [
      { recipient: req.user._id },
      { recipient: null },
      { recipient: { $exists: false } },
    ],
  };

  const count = await Notification.countDocuments(query);
  return success(res, 200, { count }, 'Unread count retrieved');
});

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Mark single notification as read
 * @access  Private
 */
export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    return error(res, 404, 'Notification not found');
  }

  notification.isRead = true;
  await notification.save();

  return success(res, 200, notification, 'Notification marked as read');
});

/**
 * @route   PATCH /api/notifications/mark-all-read
 * @desc    Mark all notifications as read
 * @access  Private
 */
export const markAllAsRead = asyncHandler(async (req, res) => {
  const query = {
    isRead: false,
    $or: [
      { recipient: req.user._id },
      { recipient: null },
      { recipient: { $exists: false } },
    ],
  };

  await Notification.updateMany(query, { isRead: true });

  return success(res, 200, null, 'All notifications marked as read');
});

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findById(req.params.id);

  if (!notification) {
    return error(res, 404, 'Notification not found');
  }

  await Notification.findByIdAndDelete(req.params.id);

  return success(res, 200, null, 'Notification deleted');
});

export default { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
