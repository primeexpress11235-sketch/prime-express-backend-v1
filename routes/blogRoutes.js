import express from 'express';
import * as blogController from '../controllers/blogController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { uploadImage } from '../middleware/uploadMiddleware.js';

// Helper to handle single image uploads supporting both 'image' and 'coverImage' field names
const handleBlogImageUpload = (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    return uploadImage.fields([
      { name: 'image', maxCount: 1 },
      { name: 'coverImage', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) return next(err);
      if (req.files) {
        if (req.files.image && req.files.image[0]) {
          req.file = req.files.image[0];
        } else if (req.files.coverImage && req.files.coverImage[0]) {
          req.file = req.files.coverImage[0];
        }
      }
      next();
    });
  }
  return next();
};

const router = express.Router();

// @route   GET /api/blogs
// @desc    Get all blog posts (sorted by date, newest first)
// @access  Public
router.get('/', blogController.getBlogs);

// @route   GET /api/blogs/:id
// @desc    Get single blog post by ID or slug
// @access  Public
router.get('/:id', blogController.getBlogById);

// @route   POST /api/blogs
// @desc    Create blog post (admin only)
// @access  Private/Admin
router.post('/', protect, adminOnly, handleBlogImageUpload, blogController.createBlog);

// @route   PUT /api/blogs/:id
// @desc    Update blog post (admin only)
// @access  Private/Admin
router.put('/:id', protect, adminOnly, handleBlogImageUpload, blogController.updateBlog);

// @route   DELETE /api/blogs/:id
// @desc    Delete blog post & Cloudinary image (admin only)
// @access  Private/Admin
router.delete('/:id', protect, adminOnly, blogController.deleteBlog);

export default router;
