import express from 'express';
import * as cmsController from '../controllers/cmsController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { uploadAny } from '../middleware/uploadMiddleware.js';

// Helper to only run multer when the incoming request is multipart/form-data
const maybeUploadAny = () => (req, res, next) => {
	const ct = (req.headers['content-type'] || '').toLowerCase();
	if (ct.startsWith('multipart/form-data')) {
		return uploadAny.any()(req, res, next);
	}
	return next();
};

const router = express.Router();

// @route   GET /api/cms/:section
// @desc    Get CMS content for a section
// @access  Public
router.get('/:section', cmsController.getCMSBySection);

// @route   POST /api/cms/:section
// @desc    Create CMS content
// @access  Private/Admin
router.post('/:section', protect, adminOnly, maybeUploadAny(), cmsController.createCMSContent);

// @route   PUT /api/cms/:section/:id
// @desc    Update CMS content
// @access  Private/Admin
router.put('/:section/:id', protect, adminOnly, maybeUploadAny(), cmsController.updateCMSContent);

// @route   DELETE /api/cms/:section/:id
// @desc    Delete CMS content
// @access  Private/Admin
router.delete('/:section/:id', protect, adminOnly, cmsController.deleteCMSContent);

export default router;
