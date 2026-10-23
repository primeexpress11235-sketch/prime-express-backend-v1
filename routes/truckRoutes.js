import express from 'express';
import multer from 'multer';
import * as truckController from '../controllers/truckController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

// Memory storage so the controller can stream the buffer to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

const router = express.Router();

// The Dispatcher Fleet Board is admin-only this phase, consistent with the
// other dashboard modules.
router.use(protect, adminOnly);

router.get('/', truckController.getTrucks);
router.post('/', truckController.createTruck);
// Declared before /:id so "stats" is never read as an id.
router.get('/stats', truckController.getFleetStats);

// Carrier-specific truck management
router.get('/carrier/:carrierId', truckController.getCarrierTrucks);
router.post('/carrier/:carrierId/manage', truckController.manageCarrierTrucks);

router.get('/:id', truckController.getTruck);
router.patch('/:id', truckController.updateTruck);
router.delete('/:id', truckController.deleteTruck);
router.post('/:id/documents', upload.single('document'), truckController.addTruckDocument);

export default router;
