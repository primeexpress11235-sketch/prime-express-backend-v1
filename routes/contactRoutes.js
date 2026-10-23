import express from 'express';
import * as contactController from '../controllers/contactController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router = express.Router();

// @route   POST /api/inquiries
// @desc    Public website lead/contact form submission
// @access  Public
router.post('/', contactController.createInquiry);

// @route   GET /api/inquiries
// @desc    List website inquiries
// @access  Private/Admin
router.get('/', protect, adminOnly, contactController.getInquiries);

// @route   GET /api/inquiries/:id
// @desc    Get single inquiry
// @access  Private/Admin
router.get('/:id', protect, adminOnly, contactController.getInquiryById);

export default router;
