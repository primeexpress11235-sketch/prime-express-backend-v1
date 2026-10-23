import express from 'express';
import multer from 'multer';
import * as carrierController from '../controllers/carrierController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

// Memory storage so the controller can stream the buffer to Cloudinary.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

const router = express.Router();

// Public carrier onboarding setup form submission
router.post('/public-setup', upload.any(), carrierController.publicCreateCarrier);

router.get('/', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.getCarriers);
router.post('/', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.createCarrier);
// Declared before the /:id routes so "bulk-delete" is never read as an id.
router.post('/bulk-delete', protect, adminOnly, carrierController.bulkDeleteCarriers);
router.get('/:id', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.getCarrier);
router.patch('/:id', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.updateCarrier);
router.get('/:id/documents', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.getCarrierDocuments);
router.post('/:id/documents', protect, requireRole('admin', 'dispatcher', 'sales_agent'), upload.single('document'), carrierController.addCarrierDocument);
router.delete('/:id/documents/:documentId', protect, adminOnly, carrierController.deleteCarrierDocument);
router.get('/:id/documents/:documentId/view', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.viewCarrierDocument);
router.get('/:id/documents/:documentId/download', protect, requireRole('admin', 'dispatcher', 'sales_agent'), carrierController.downloadCarrierDocument);
router.delete('/:id', protect, adminOnly, carrierController.deleteCarrier);

export default router;
