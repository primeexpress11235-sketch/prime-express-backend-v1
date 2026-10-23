import express from 'express';
import multer from 'multer';
import * as shipperController from '../controllers/shipperController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public shipper quote form submission
router.post('/public-quote', shipperController.publicCreateShipper);

// All shipper management below is admin-only
router.use(protect, adminOnly);

router.get('/', shipperController.getShippers);
router.post('/', shipperController.createShipper);
router.post('/bulk-delete', shipperController.bulkDeleteShippers);
router.get('/:id', shipperController.getShipper);
router.patch('/:id', shipperController.updateShipper);
router.delete('/:id', shipperController.deleteShipper);

export default router;
