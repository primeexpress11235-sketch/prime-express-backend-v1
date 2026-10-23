import asyncHandler from 'express-async-handler';
import Attendance from '../models/Attendance.js';
import WorkSchedule from '../models/WorkSchedule.js';
import User from '../models/User.js';
import { success, error } from '../utils/sendResponse.js';
import { dateBucketStart, dateAtLocalTime } from '../utils/performanceDates.js';

// Store one attendance record against the Pakistan calendar day.
function startOfDay(d = new Date()) {
  return dateBucketStart(d);
}

// Convert a Pakistan-local schedule time into an absolute instant.
function timeOnDay(base, hhmm) {
  return dateAtLocalTime(base, hhmm || '09:00');
}

export function calculateAttendanceStatus(at, schedule, day = startOfDay(at)) {
  if (!schedule) return 'on_time';

  const scheduledStart = timeOnDay(day, schedule.startTime);
  const lateMinutes = Number(schedule.lateThresholdMinutes);
  const absentMinutes = Number(schedule.absentThresholdMinutes);
  const lateCutoff = new Date(scheduledStart.getTime() + (Number.isFinite(lateMinutes) ? lateMinutes : 0) * 60000);
  const absentCutoff = new Date(scheduledStart.getTime() + (Number.isFinite(absentMinutes) ? absentMinutes : 0) * 60000);

  // Three tiers: present through the late cutoff, late through the absent
  // cutoff, and absent only after the absent cutoff.
  if (at > absentCutoff) return 'absent';
  if (at > lateCutoff) return 'late';
  return 'on_time';
}

/**
 * @route   POST /api/attendance/check-in
 * @desc    Record a check-in for a user (self, or admin on their behalf).
 *          Status is computed against the user's WorkSchedule: on_time within
 *          the late threshold, late through the absent cutoff, and absent
 *          after the absent cutoff.
 * @access  Private/Admin
 */
export const checkIn = asyncHandler(async (req, res) => {
  const userId = req.user.role === 'admin' && req.body.userId ? req.body.userId : req.user._id;
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const day = startOfDay(at);

  const schedule = await WorkSchedule.findOne({ user: userId });
  const status = calculateAttendanceStatus(at, schedule, day);

  const record = await Attendance.findOneAndUpdate(
    { user: userId, date: day },
    { $set: { checkInTime: at, status, missingCheckOut: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return success(res, 200, record, 'Checked in');
});

/**
 * @route   POST /api/attendance/check-out
 * @desc    Record a check-out for a user. Clears the missing-check-out flag.
 * @access  Private/Admin
 */
export const checkOut = asyncHandler(async (req, res) => {
  const userId = req.user.role === 'admin' && req.body.userId ? req.body.userId : req.user._id;
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const day = startOfDay(at);

  const record = await Attendance.findOne({ user: userId, date: day });
  if (!record) return error(res, 404, 'No check-in found for today');

  record.checkOutTime = at;
  record.missingCheckOut = false;
  await record.save();

  return success(res, 200, record, 'Checked out');
});

/**
 * @route   GET /api/attendance
 * @desc    Attendance history, filterable by ?user, ?role, ?location, and an
 *          optional ?from/?to date range. Populates the user for display.
 * @access  Private/Admin
 */
export const getAttendance = asyncHandler(async (req, res) => {
  const { user, role, location, from, to } = req.query;

  const query = {};
  if (req.user.role !== 'admin') {
    query.user = req.user._id;
  } else if (user) {
    query.user = user;
  } else if (role || location) {
    // Resolve the set of users matching the role/work-location filters.
    const userQuery = {};
    if (role) userQuery.role = role;
    if (location) userQuery.workLocation = location;
    const users = await User.find(userQuery).select('_id');
    query.user = { $in: users.map((u) => u._id) };
  }

  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = startOfDay(new Date(from));
    if (to) query.date.$lte = startOfDay(new Date(to));
  }

  const records = await Attendance.find(query)
    .populate('user', 'name email role workLocation')
    .sort('-date');

  return success(res, 200, records, 'Attendance retrieved');
});

/**
 * @route   GET /api/attendance/monthly
 * @desc    Monthly attendance aggregation for active dispatchers and sales agents
 * @access  Private (Admin only)
 */
export const getMonthlyAttendance = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') return error(res, 403, 'Admin access required');

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
  const now = new Date();
  const year = monthMatch ? Number(monthMatch[1]) : now.getFullYear();
  const month = monthMatch ? Number(monthMatch[2]) - 1 : now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 1);
  const userQuery = { role: { $in: ['dispatcher', 'sales_agent'] }, isActive: true };
  if (req.query.role) userQuery.role = req.query.role;
  if (req.query.location) userQuery.workLocation = req.query.location;
  const users = await User.find(userQuery).select('_id name email role workLocation').sort('name');
  const records = await Attendance.find({ user: { $in: users.map((user) => user._id) }, date: { $gte: start, $lt: end } }).select('user date status');

  const byUser = new Map(users.map((user) => [String(user._id), { user, present: 0, late: 0, absent: 0 }]));
  records.forEach((record) => {
    const summary = byUser.get(String(record.user));
    if (!summary) return;
    if (record.status === 'late') summary.late += 1;
    else if (record.status === 'on_time') summary.present += 1;
    else summary.absent += 1;
  });
  return success(res, 200, [...byUser.values()], 'Monthly attendance retrieved');
});

export default { checkIn, checkOut, getAttendance, getMonthlyAttendance, calculateAttendanceStatus };
