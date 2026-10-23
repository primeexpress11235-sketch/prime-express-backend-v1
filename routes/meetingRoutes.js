import express from 'express';
import * as meetingController from '../controllers/meetingController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, requireRole('admin', 'dispatcher', 'sales_agent'), meetingController.getMeetings);
router.post('/', protect, adminOnly, meetingController.createMeeting);
router.patch('/:id', protect, adminOnly, meetingController.updateMeeting);
router.delete('/:id', protect, adminOnly, meetingController.deleteMeeting);

export default router;
