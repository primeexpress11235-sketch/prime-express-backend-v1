import asyncHandler from 'express-async-handler';
import CMSContent from '../models/CMSContent.js';
import { success, error } from '../utils/sendResponse.js';

/**
 * @route   GET /api/cms/:section
 * @desc    Get all CMS content for a section
 * @access  Public
 */
export const getCMSBySection = asyncHandler(async (req, res) => {
  const { section } = req.params;
  const { isVisible = true } = req.query;

  const query = { section };
  if (isVisible === 'true') {
    query.isVisible = true;
  }

  const content = await CMSContent.find(query).sort('order');

  return success(res, 200, content, 'CMS content retrieved');
});

/**
 * @route   POST /api/cms/:section
 * @desc    Create new CMS content
 * @access  Private/Admin
 */
export const createCMSContent = asyncHandler(async (req, res) => {
  const { section } = req.params;
  const { title, subtitle, description, image, tags, order, isVisible, metadata } = req.body;

  // Parse metadata when sent as JSON string (from multipart/form-data)
  let parsedMetadata = metadata;
  if (metadata && typeof metadata === 'string') {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch (err) {
      parsedMetadata = metadata;
    }
  }

  // If files were uploaded (uploadAny.any()), attach them into metadata or image
  if (req.files && req.files.length > 0) {
    parsedMetadata = parsedMetadata || {};
    for (const file of req.files) {
      // multer-storage-cloudinary exposes `path` with the URL
      const url = file.path || file.location || file.url;
      if (!url) continue;
      if (file.fieldname === 'cardImage') parsedMetadata.cardImage = url;
      else if (file.fieldname === 'coverImage') parsedMetadata.coverImage = url;
      else if (file.fieldname === 'image') parsedMetadata.image = url;
    }
  }

  // Normalize common metadata fields to proper types
  if (parsedMetadata) {
    if (parsedMetadata.businessesServed && typeof parsedMetadata.businessesServed === 'string') {
      parsedMetadata.businessesServed = parsedMetadata.businessesServed.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (parsedMetadata.features && typeof parsedMetadata.features === 'string') {
      parsedMetadata.features = parsedMetadata.features.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Do not accept 'problems' field from CMS metadata — removed per product decision
    if (parsedMetadata.problems) {
      delete parsedMetadata.problems;
    }
    if (parsedMetadata.outcomes && typeof parsedMetadata.outcomes === 'string') {
      try {
        parsedMetadata.outcomes = JSON.parse(parsedMetadata.outcomes);
      } catch (err) {
        parsedMetadata.outcomes = [];
      }
    }
  }

  const cms = new CMSContent({
    section,
    title,
    subtitle,
    description,
    // prefer parsedMetadata.image (from uploadAny.any()), then single-file path, then explicit image field
    image: parsedMetadata?.image || req.file?.path || image,
    tags,
    order: order || 0,
    isVisible: (typeof isVisible !== 'undefined') ? (isVisible === 'true' || isVisible === true || isVisible === '1') : true,
    metadata: parsedMetadata,
  });

  await cms.save();

  return success(res, 201, cms, 'CMS content created');
});

/**
 * @route   PUT /api/cms/:section/:id
 * @desc    Update CMS content
 * @access  Private/Admin
 */
export const updateCMSContent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, subtitle, description, image, tags, order, isVisible, metadata } = req.body;

  // Find existing to avoid overwriting fields unintentionally
  const existing = await CMSContent.findById(id);
  if (!existing) return error(res, 404, 'CMS content not found');

  // Parse metadata when sent as JSON string (from multipart/form-data)
  let parsedMetadata = metadata;
  if (metadata && typeof metadata === 'string') {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch (err) {
      parsedMetadata = metadata;
    }
  }
  // If files were uploaded (uploadAny.any()), attach them into metadata or image
  if (req.files && req.files.length > 0) {
    parsedMetadata = parsedMetadata || {};
    for (const file of req.files) {
      const url = file.path || file.location || file.url;
      if (!url) continue;
      if (file.fieldname === 'cardImage') parsedMetadata.cardImage = url;
      else if (file.fieldname === 'coverImage') parsedMetadata.coverImage = url;
      else if (file.fieldname === 'image') parsedMetadata.image = url;
    }
  }

  // Determine isVisible only when explicitly provided
  let isVisibleValue;
  if (typeof isVisible !== 'undefined') {
    isVisibleValue = (isVisible === 'true' || isVisible === true || isVisible === '1');
  } else {
    isVisibleValue = existing.isVisible;
  }

  const updatePayload = {
    title: title ?? existing.title,
    subtitle: subtitle ?? existing.subtitle,
    description: description ?? existing.description,
    image: req.file?.path || image || existing.image,
    tags: typeof tags !== 'undefined' ? tags : existing.tags,
    order: typeof order !== 'undefined' ? order : existing.order,
    isVisible: isVisibleValue,
    metadata: parsedMetadata ?? existing.metadata,
  };

  const cms = await CMSContent.findByIdAndUpdate(id, updatePayload, { new: true, runValidators: true });

  return success(res, 200, cms, 'CMS content updated');
});

/**
 * @route   DELETE /api/cms/:section/:id
 * @desc    Delete CMS content
 * @access  Private/Admin
 */
export const deleteCMSContent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const cms = await CMSContent.findByIdAndDelete(id);

  if (!cms) {
    return error(res, 404, 'CMS content not found');
  }

  return success(res, 200, null, 'CMS content deleted');
});

export default { getCMSBySection, createCMSContent, updateCMSContent, deleteCMSContent };
