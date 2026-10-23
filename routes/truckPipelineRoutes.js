import express from 'express';
import * as truckPipelineController from '../controllers/truckPipelineController.js';
import { protect, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// Unlike the other fleet modules this board is a dispatcher's own workspace, so
// it opens up beyond adminOnly. Scoping is enforced per-request in the
// controller: a dispatcher only ever sees and moves their own trucks, while an
// admin can switch to the whole operation with ?scope=all.
router.use(protect, requireRole('admin', 'dispatcher'));

router.get('/', truckPipelineController.getPipelineCards);

router.post('/add-from-dispatch', truckPipelineController.addFromDispatch);
router.patch('/:id/flag', truckPipelineController.setFlag);
router.patch('/:id/location', truckPipelineController.updateLocation);
router.patch('/:id/load-details', truckPipelineController.updateLoadDetails);
router.post('/:id/issue', truckPipelineController.raiseIssue);
router.post('/:id/resolve-issue', truckPipelineController.resolveIssue);

export default router;
