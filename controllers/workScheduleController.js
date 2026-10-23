import asyncHandler from 'express-async-handler';
import WorkSchedule from '../models/WorkSchedule.js';
import { success, error } from '../utils/sendResponse.js';

/**
 * @route   POST /api/work-schedules
 * @desc    Create or update a user's work schedule (admin config). Upserts so
 *          there is exactly one schedule per user.
 * @access  Private/Admin
 */
export const upsertWorkSchedule = asyncHandler(async (req, res) => {
  const { user, startTime, endTime, lateThresholdMinutes, absentThresholdMinutes, workLocation } = req.body;

  if (!user) return error(res, 400, 'A user is required');

  const update = {};
  if (startTime !== undefined) update.startTime = startTime;
  if (endTime !== undefined) update.endTime = endTime;
  if (lateThresholdMinutes !== undefined) update.lateThresholdMinutes = Number(lateThresholdMinutes);
  if (absentThresholdMinutes !== undefined) update.absentThresholdMinutes = Number(absentThresholdMinutes);
  if (workLocation !== undefined) update.workLocation = workLocation;

  const schedule = await WorkSchedule.findOneAndUpdate(
    { user },
    { $set: update, $setOnInsert: { user } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return success(res, 200, schedule, 'Work schedule saved');
});

/**
 * @route   GET /api/work-schedules/:userId
 * @desc    Get a user's work schedule
 * @access  Private/Admin
 */
export const getWorkSchedule = asyncHandler(async (req, res) => {
  const targetId = req.params.userId === 'me' || req.user.role !== 'admin' ? req.user._id : req.params.userId;
  const schedule = await WorkSchedule.findOne({ user: targetId });
  // Not an error if none exists yet — default thresholds will apply.
  return success(res, 200, schedule, schedule ? 'Work schedule retrieved' : 'No schedule set');
});

export default { upsertWorkSchedule, getWorkSchedule };
