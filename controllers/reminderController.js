import asyncHandler from 'express-async-handler';
import Reminder from '../models/Reminder.js';
import CarrierLead from '../models/CarrierLead.js';
import User from '../models/User.js';
import { dateBucket, dateBucketStart, today } from '../utils/performanceDates.js';

function sortAndClassifyReminders(reminders) {
  const todayKey = today();
  const priority = { overdue: 0, today: 1, future: 2, completed: 3 };

  return reminders
    .map((reminder) => {
      const dateKey = dateBucket(reminder.reminderDate);
      const dateStatus = reminder.resolved
        ? 'completed'
        : dateKey < todayKey
        ? 'overdue'
        : dateKey === todayKey
        ? 'today'
        : 'future';
      return { ...reminder.toObject(), dateStatus };
    })
    .sort((left, right) => {
      const statusDifference = priority[left.dateStatus] - priority[right.dateStatus];
      if (statusDifference) return statusDifference;
      const dateDifference = new Date(left.reminderDate) - new Date(right.reminderDate);
      return dateDifference || String(left.reminderTime).localeCompare(String(right.reminderTime));
    });
}

function nextLocalDayStart(dateKey) {
  const nextDate = new Date(`${dateKey}T12:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return dateBucketStart(nextDate);
}

/**
 * @desc    Create a new follow-up reminder on any carrier lead
 * @route   POST /api/reminders
 * @access  Private
 */
export const createReminder = asyncHandler(async (req, res) => {
  const { carrierId, agentId, reminderDate, reminderTime, message } = req.body;

  if (!carrierId || !reminderDate || !message) {
    res.status(400);
    throw new Error('carrierId, reminderDate, and message are required');
  }

  const carrier = await CarrierLead.findById(carrierId);
  if (!carrier) {
    res.status(404);
    throw new Error('Carrier lead not found');
  }

  // Target agent is specified agentId or logged-in user
  const targetAgentId = req.user.role === 'admin' ? (agentId || req.user._id) : req.user._id;

  const reminder = await Reminder.create({
    carrierId,
    agentId: targetAgentId,
    createdBy: req.user._id,
    reminderDate: new Date(reminderDate),
    reminderTime: reminderTime || '18:00',
    message: message.trim(),
    resolved: false,
    notifiedAt: null,
  });

  const populated = await Reminder.findById(reminder._id)
    .populate('carrierId', 'companyName mcNumber phone email currentStatus')
    .populate('agentId', 'name email');

  res.status(201).json({
    success: true,
    data: populated,
    message: 'Reminder scheduled successfully',
  });
});

/**
 * @desc    Get logged-in sales agent's reminders
 * @route   GET /api/reminders/my
 * @access  Private/SalesAgent
 */
export const getMyReminders = asyncHandler(async (req, res) => {
  const reminders = await Reminder.find({ agentId: req.user._id })
    .populate('carrierId', 'companyName mcNumber phone email currentStatus')
    .populate('createdBy', 'name');
  const orderedReminders = sortAndClassifyReminders(reminders);

  res.json({
    success: true,
    count: orderedReminders.length,
    data: orderedReminders,
  });
});

/**
 * @desc    Get all reminders across all agents (Admin view)
 * @route   GET /api/reminders/admin
 * @access  Private/Admin
 */
export const getAdminReminders = asyncHandler(async (req, res) => {
  const { date, agentId, resolved } = req.query;

  const query = {};

  if (date) {
    const start = dateBucketStart(new Date(`${date}T12:00:00.000Z`));
    const end = nextLocalDayStart(date);
    query.reminderDate = { $gte: start, $lt: end };
  }

  if (agentId) {
    query.agentId = agentId;
  }

  if (resolved !== undefined && resolved !== '') {
    query.resolved = resolved === 'true';
  }

  const reminders = await Reminder.find(query)
    .populate('carrierId', 'companyName mcNumber phone email currentStatus')
    .populate('agentId', 'name email')
    .populate('createdBy', 'name');
  const orderedReminders = sortAndClassifyReminders(reminders);

  res.json({
    success: true,
    count: orderedReminders.length,
    data: orderedReminders,
  });
});

/**
 * @desc    Toggle reminder resolved status
 * @route   PATCH /api/reminders/:id/resolve
 * @access  Private
 */
export const toggleReminderResolve = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const reminder = await Reminder.findById(id);
  if (!reminder) {
    res.status(404);
    throw new Error('Reminder not found');
  }

  if (req.user.role !== 'admin' && String(reminder.agentId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only update your own reminders');
  }

  reminder.resolved = !reminder.resolved;
  await reminder.save();

  res.json({
    success: true,
    data: reminder,
    message: `Reminder marked as ${reminder.resolved ? 'resolved' : 'unresolved'}`,
  });
});

export const deleteReminder = asyncHandler(async (req, res) => {
  const reminder = await Reminder.findById(req.params.id);
  if (!reminder) {
    res.status(404);
    throw new Error('Reminder not found');
  }

  if (req.user.role !== 'admin' && String(reminder.agentId) !== String(req.user._id)) {
    res.status(403);
    throw new Error('You can only delete your own reminders');
  }

  await reminder.deleteOne();
  res.json({ success: true, message: 'Reminder deleted successfully' });
});

/**
 * @desc    Get count of unresolved reminders for sidebar badge
 * @route   GET /api/reminders/unresolved-count
 * @access  Private
 */
export const getUnresolvedRemindersCount = asyncHandler(async (req, res) => {
  const todayKey = today();
  const query = {
    resolved: false,
    reminderDate: { $lt: nextLocalDayStart(todayKey) },
  };
  if (req.user.role !== 'admin') {
    query.agentId = req.user._id;
  }
  const count = await Reminder.countDocuments(query);
  res.json({
    success: true,
    count,
  });
});
