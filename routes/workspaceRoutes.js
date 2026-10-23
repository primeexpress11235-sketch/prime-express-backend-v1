import express from 'express';
import {
  getNotes,
  createNote,
  updateNote,
  deleteNote,
} from '../controllers/workspaceController.js';
import { protect, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect, requireRole('admin', 'dispatcher', 'sales_agent'));

router.get('/notes', getNotes);
router.post('/notes', createNote);
router.put('/notes/:id', updateNote);
router.delete('/notes/:id', deleteNote);

export default router;
