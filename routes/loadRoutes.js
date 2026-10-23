import express from 'express';
import * as loadController from '../controllers/loadController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', loadController.getLoads);
router.get('/kpis', loadController.getLoadKPIs);
router.post('/', loadController.createLoad);
router.patch('/:id', loadController.updateLoad);
router.put('/:id', loadController.updateLoad);
router.delete('/:id', loadController.deleteLoad);

export default router;
