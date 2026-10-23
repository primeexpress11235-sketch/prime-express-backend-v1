import asyncHandler from 'express-async-handler';
import Meeting from '../models/Meeting.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';

/**
 * @route   GET /api/meetings
 * @desc    List meetings, sorted by date (soonest first).
 * @access  Private/Admin
 */
export const getMeetings = asyncHandler(async (req, res) => {
  const query = {};
  if (req.user.role !== 'admin') {
    query.$or = [{ attendees: req.user._id }, { attendees: { $size: 0 } }, { attendees: null }, { attendees: { $exists: false } }];
  }

  const meetings = await Meeting.find(query)
    .populate('attendees', 'name email role')
    .sort('date');

  return success(res, 200, meetings, 'Meetings retrieved');
});

/**
 * @route   POST /api/meetings
 * @desc    Create a meeting record (no external calendar API); notifies attendees.
 * @access  Private/Admin
 */
export const createMeeting = asyncHandler(async (req, res) => {
  const { title, date, time, type, linkOrLocation, notes, attendees } = req.body;
  if (!title || !date) return error(res, 400, 'Title and date are required');

  const meeting = await Meeting.create({
    title,
    date,
    time,
    type,
    linkOrLocation,
    notes,
    attendees: Array.isArray(attendees) ? attendees : [],
  });

  await Promise.all(
    (meeting.attendees || []).map((uid) =>
      createNotification({
        recipientId: uid,
        type: 'meeting_created',
        title: 'New meeting scheduled',
        body: `${title} — ${new Date(date).toLocaleDateString()}${time ? ` ${time}` : ''}`,
        relatedModel: 'Meeting',
        relatedId: meeting._id,
      })
    )
  );

  await meeting.populate('attendees', 'name email role');
  return success(res, 201, meeting, 'Meeting created');
});

/**
 * @route   PATCH /api/meetings/:id
 * @desc    Update a meeting
 * @access  Private/Admin
 */
export const updateMeeting = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) return error(res, 404, 'Meeting not found');

  const fields = ['title', 'date', 'time', 'type', 'linkOrLocation', 'notes', 'attendees'];
  for (const f of fields) {
    if (req.body[f] !== undefined) meeting[f] = req.body[f];
  }

  await meeting.save();
  await meeting.populate('attendees', 'name email role');
  return success(res, 200, meeting, 'Meeting updated');
});

/**
 * @route   DELETE /api/meetings/:id
 * @desc    Delete a meeting
 * @access  Private/Admin
 */
export const deleteMeeting = asyncHandler(async (req, res) => {
  const m = await Meeting.findByIdAndDelete(req.params.id);
  if (!m) return error(res, 404, 'Meeting not found');
  return success(res, 200, null, 'Meeting deleted');
});

export default { getMeetings, createMeeting, updateMeeting, deleteMeeting };
