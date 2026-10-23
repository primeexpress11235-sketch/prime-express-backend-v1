import express from 'express';
import * as taskController from '../controllers/taskController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, requireRole('admin', 'dispatcher', 'sales_agent'), taskController.getTasks);
router.post('/', protect, adminOnly, taskController.createTask);
router.patch('/:id', protect, requireRole('admin', 'dispatcher', 'sales_agent'), taskController.updateTask);
router.delete('/:id', protect, adminOnly, taskController.deleteTask);

export default router;
