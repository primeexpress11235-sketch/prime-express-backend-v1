import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';
import logger from '../utils/logger.js';

/**
 * Upload Middleware with Cloudinary
 * Handles image and document uploads with automatic organization into folders
 */

// Image upload (JPEG, PNG, WebP, GIF - max 5MB)
export const uploadImage = multer({
  storage: new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      let folder = 'avencix/misc';
      if (req.baseUrl.includes('avatar') || req.path.includes('avatar')) folder = 'avencix/avatars';
      if (req.baseUrl.includes('cms')) folder = 'avencix/cms';
      if (req.baseUrl.includes('blogs') || req.baseUrl.includes('blog')) folder = 'dkr-trucking/blogs';
      if (req.baseUrl.includes('academy')) folder = 'dkr/academy';

      const safeName = file.originalname
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'blog-image';

      return {
        folder: folder,
        resource_type: 'image',
        public_id: `${Date.now()}-${safeName}`,
      };
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Document upload (PDF, DOC, DOCX, XLS, XLSX - max 20MB)
export const uploadDocument = multer({
  storage: new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      let folder = 'avencix/documents';
      if (req.baseUrl.includes('invoice')) folder = 'avencix/invoices';
      if (req.baseUrl.includes('deliverable')) folder = 'avencix/deliverables';
      if (req.baseUrl.includes('academy')) folder = 'dkr/academy';
      if (req.baseUrl.includes('lead') || req.path.includes('lead')) folder = 'dkr/lead-documents';

      return {
        folder: folder,
        resource_type: 'auto',
        public_id: `${Date.now()}-${file.originalname}`,
      };
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only document files are allowed'));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Any file upload (images + documents - max 20MB)
export const uploadAny = multer({
  storage: new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      let folder = 'avencix/uploads';
      if (req.baseUrl.includes('chat') || req.path.includes('chat')) folder = 'dkr/chat';
      else if (req.baseUrl.includes('message')) folder = 'avencix/messages';
      else if (req.baseUrl.includes('project')) folder = 'avencix/projects';

      // Use 'image' for images and 'raw' for documents like PDFs
      const isImage = (file.mimetype || '').startsWith('image/');
      const resourceType = isImage ? 'image' : 'raw';

      return {
        folder: folder,
        resource_type: resourceType,
        public_id: `${Date.now()}-${file.originalname}`,
      };
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

/**
 * Delete File from Cloudinary
 * Helper function to delete files using their public ID
 */
export const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (err) {
    logger?.error?.('Failed to delete from Cloudinary:', err);
    return false;
  }
};

export default { uploadImage, uploadDocument, uploadAny, deleteFromCloudinary };
