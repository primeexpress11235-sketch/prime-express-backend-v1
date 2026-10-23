import express from 'express';
import multer from 'multer';
import * as ownerOperatorController from '../controllers/ownerOperatorController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

// Memory storage so the controller can stream the buffer to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

const router = express.Router();

// Public owner-operator application form submission with file uploads
router.post('/public-apply', upload.any(), ownerOperatorController.publicCreateOwnerOperator);

// All owner-operator management below is admin-only
router.use(protect, adminOnly);

router.get('/', ownerOperatorController.getOwnerOperators);
router.post('/', upload.any(), ownerOperatorController.createOwnerOperator);
router.post('/bulk-delete', ownerOperatorController.bulkDeleteOwnerOperators);
router.get('/:id', ownerOperatorController.getOwnerOperator);
router.patch('/:id', upload.any(), ownerOperatorController.updateOwnerOperator);
router.delete('/:id', ownerOperatorController.deleteOwnerOperator);
router.post('/:id/documents', upload.single('document'), ownerOperatorController.addOwnerOperatorDocument);
router.delete('/:id/documents/:documentId', ownerOperatorController.deleteOwnerOperatorDocument);
router.get('/:id/documents/:documentId/download', ownerOperatorController.downloadOwnerOperatorDocument);

export default router;
