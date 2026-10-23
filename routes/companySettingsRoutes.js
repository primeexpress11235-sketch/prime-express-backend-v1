import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getCompanySettings,
  updateCompanySettings,
} from '../controllers/companySettingsController.js';

const router = express.Router();

router.route('/')
  .get(protect, getCompanySettings)
  .put(protect, adminOnly, updateCompanySettings);

export default router;
