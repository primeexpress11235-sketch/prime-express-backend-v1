import express from 'express';
import * as announcementController from '../controllers/announcementController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, requireRole('admin', 'dispatcher', 'sales_agent'), announcementController.getAnnouncements);
router.post('/', protect, adminOnly, announcementController.createAnnouncement);
router.delete('/:id', protect, adminOnly, announcementController.deleteAnnouncement);

export default router;
