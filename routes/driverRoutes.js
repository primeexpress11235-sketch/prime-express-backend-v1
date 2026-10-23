import express from 'express';
import multer from 'multer';
import {
  createDriver,
  getDrivers,
  getDriverById,
  updateDriver,
  deleteDriver,
  uploadDriverDocument,
  getDriverDocuments,
  deleteDriverDocument,
  viewDriverDocument,
  downloadDriverDocument,
  getDriverDQF,
  updateDriverDQFItem,
  deleteDriverDQFItem,
  viewDriverDQFItem,
  downloadDriverDQFItem,
} from '../controllers/driverController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

const router = express.Router();

router
  .route('/')
  .post(upload.array('documents', 10), createDriver)
  .get(protect, adminOnly, getDrivers);

router
  .route('/:id')
  .get(protect, adminOnly, getDriverById)
  .put(protect, adminOnly, updateDriver)
  .delete(protect, adminOnly, deleteDriver);

router
  .route('/:id/documents')
  .get(protect, adminOnly, getDriverDocuments)
  .post(upload.array('documents', 10), uploadDriverDocument);

router
  .route('/:id/documents/:documentId')
  .delete(protect, adminOnly, deleteDriverDocument);

router
  .route('/:id/documents/:documentId/view')
  .get(protect, adminOnly, viewDriverDocument);

router
  .route('/:id/documents/:documentId/download')
  .get(protect, adminOnly, downloadDriverDocument);

// DQF / Compliance Routes
router
  .route('/:id/dqf')
  .get(protect, adminOnly, getDriverDQF);

router
  .route('/:id/dqf/:itemKey')
  .put(protect, adminOnly, upload.single('file'), updateDriverDQFItem)
  .delete(protect, adminOnly, deleteDriverDQFItem);

router
  .route('/:id/dqf/:itemKey/view')
  .get(protect, adminOnly, viewDriverDQFItem);

router
  .route('/:id/dqf/:itemKey/download')
  .get(protect, adminOnly, downloadDriverDQFItem);

export default router;
