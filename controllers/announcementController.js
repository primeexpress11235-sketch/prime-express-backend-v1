import asyncHandler from 'express-async-handler';
import Announcement from '../models/Announcement.js';
import User from '../models/User.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';

/**
 * @route   GET /api/announcements
 * @desc    List announcements, optionally filtered by ?role visibility.
 * @access  Private/Admin
 */
export const getAnnouncements = asyncHandler(async (req, res) => {
  const { role } = req.query;
  const query = {};
  if (role) {
    // Match announcements visible to that role (empty visibleToRoles = all).
    query.$or = [{ visibleToRoles: role }, { visibleToRoles: { $size: 0 } }];
  }

  const announcements = await Announcement.find(query)
    .populate('postedBy', 'name')
    .sort('-createdAt');

  return success(res, 200, announcements, 'Announcements retrieved');
});

/**
 * @route   POST /api/announcements
 * @desc    Post an announcement; notifies users in the target roles.
 * @access  Private/Admin
 */
export const createAnnouncement = asyncHandler(async (req, res) => {
  const { title, body, visibleToRoles } = req.body;
  if (!title) return error(res, 400, 'A title is required');

  const roles = Array.isArray(visibleToRoles) ? visibleToRoles : [];

  const announcement = await Announcement.create({
    title,
    body,
    postedBy: req.user._id,
    visibleToRoles: roles,
  });

  // Notify the targeted users (all non-admin users when no roles specified).
  const userQuery = roles.length ? { role: { $in: roles } } : { role: { $ne: 'admin' } };
  const recipients = await User.find({ ...userQuery, isActive: { $ne: false } }).select('_id');
  await Promise.all(
    recipients.map((u) =>
      createNotification({
        recipientId: u._id,
        type: 'announcement_posted',
        title: 'New announcement',
        body: title,
        relatedModel: 'Announcement',
        relatedId: announcement._id,
      })
    )
  );

  await announcement.populate('postedBy', 'name');
  return success(res, 201, announcement, 'Announcement posted');
});

/**
 * @route   DELETE /api/announcements/:id
 * @desc    Delete an announcement
 * @access  Private/Admin
 */
export const deleteAnnouncement = asyncHandler(async (req, res) => {
  const a = await Announcement.findByIdAndDelete(req.params.id);
  if (!a) return error(res, 404, 'Announcement not found');
  return success(res, 200, null, 'Announcement deleted');
});

export default { getAnnouncements, createAnnouncement, deleteAnnouncement };
