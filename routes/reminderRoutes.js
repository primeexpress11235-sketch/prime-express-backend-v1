import express from 'express';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';
import {
  createReminder,
  getMyReminders,
  getAdminReminders,
  toggleReminderResolve,
  deleteReminder,
  getUnresolvedRemindersCount,
} from '../controllers/reminderController.js';

const router = express.Router();

// Create follow-up reminder on any lead
router.post('/', protect, createReminder);

// Get unresolved count for sidebar badge
router.get('/unresolved-count', protect, getUnresolvedRemindersCount);

// Sales agent reminders page
router.get('/my', protect, requireRole('sales_agent', 'admin'), getMyReminders);

// Admin dashboard follow-up reminders oversight
router.get('/admin', protect, adminOnly, getAdminReminders);

// Toggle resolve status
router.patch('/:id/resolve', protect, toggleReminderResolve);
router.delete('/:id', protect, deleteReminder);

export default router;
