import express from 'express';
import * as workScheduleController from '../controllers/workScheduleController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, adminOnly, workScheduleController.upsertWorkSchedule);
router.get('/:userId', protect, requireRole('admin', 'dispatcher', 'sales_agent'), workScheduleController.getWorkSchedule);

export default router;
