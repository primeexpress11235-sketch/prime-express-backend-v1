import express from 'express';
import * as attendanceController from '../controllers/attendanceController.js';
import { protect, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect, requireRole('admin', 'dispatcher', 'sales_agent'));

router.get('/', attendanceController.getAttendance);
router.get('/monthly', attendanceController.getMonthlyAttendance);
router.post('/check-in', attendanceController.checkIn);
router.post('/check-out', attendanceController.checkOut);

export default router;
