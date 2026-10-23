import asyncHandler from 'express-async-handler';
import Blog from '../models/Blog.js';
import { success, error } from '../utils/sendResponse.js';
import { deleteFromCloudinary } from '../middleware/uploadMiddleware.js';
import logger from '../utils/logger.js';

const slugify = (value) => String(value)
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/**
 * @route   GET /api/blogs
 * @desc    Get all blog posts (sorted by date, newest first)
 * @access  Public
 */
export const getBlogs = asyncHandler(async (req, res) => {
  const blogs = await Blog.find({}).sort({ date: -1, createdAt: -1 });
  return success(res, 200, blogs, 'Blog posts retrieved successfully');
});

/**
 * @route   GET /api/blogs/:id
 * @desc    Get single blog post by ID
 * @access  Public
 */
export const getBlogById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let blog = null;

  // Try finding by ID
  if (id.match(/^[0-9a-fA-F]{24}$/)) {
    blog = await Blog.findById(id);
  }

  // Fallback search by title or slug-like matching if not matched by Mongo ObjectId
  if (!blog) {
    blog = await Blog.findOne({
      $or: [
        { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null },
        { slug: id.toLowerCase() },
        { title: new RegExp(`^${id.replace(/-/g, ' ')}$`, 'i') },
      ].filter(Boolean),
    });
  }

  if (!blog) {
    return error(res, 404, 'Blog post not found');
  }

  return success(res, 200, blog, 'Blog post retrieved successfully');
});

/**
 * Alias for getBlogById to support /:slug or /:id queries
 */
export const getBlogBySlug = getBlogById;

/**
 * @route   POST /api/blogs
 * @desc    Create a blog post
 * @access  Private/Admin
 */
export const createBlog = asyncHandler(async (req, res) => {
  const { title, body, content, author, date, category, imageUrl: bodyImageUrl } = req.body;

  const resolvedBody = body || content;

  if (!title || !resolvedBody || !author || !category) {
    return error(res, 400, 'Title, body, author, and category are required');
  }

  // Image source: uploaded file or explicit URL
  const imageUrl = req.file?.path || bodyImageUrl;
  const imagePublicId = req.file?.filename || req.file?.public_id || '';

  if (!imageUrl) {
    return error(res, 400, 'Blog image is required');
  }

  logger?.info?.('[blogController] Creating blog post:', { title, author, category, imageUrl });

  const blog = new Blog({
    title,
    slug: slugify(title),
    body: resolvedBody,
    author,
    date: date ? new Date(date) : new Date(),
    category,
    imageUrl,
    imagePublicId,
  });

  await blog.save();

  return success(res, 201, blog, 'Blog post created successfully');
});

/**
 * @route   PUT /api/blogs/:id
 * @desc    Update a blog post
 * @access  Private/Admin
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, body, content, author, date, category, imageUrl: bodyImageUrl } = req.body;

  const existing = await Blog.findById(id);
  if (!existing) {
    return error(res, 404, 'Blog post not found');
  }

  let imageUrl = existing.imageUrl;
  let imagePublicId = existing.imagePublicId;

  // If a new file is uploaded, replace the image and remove old Cloudinary image if present
  if (req.file) {
    if (existing.imagePublicId) {
      await deleteFromCloudinary(existing.imagePublicId);
    }
    imageUrl = req.file.path;
    imagePublicId = req.file.filename || req.file.public_id || '';
  } else if (bodyImageUrl) {
    imageUrl = bodyImageUrl;
  }

  const resolvedBody = body || content || existing.body;

  existing.title = title ?? existing.title;
  if (title) existing.slug = slugify(title);
  existing.body = resolvedBody;
  existing.author = author ?? existing.author;
  existing.date = date ? new Date(date) : existing.date;
  existing.category = category ?? existing.category;
  existing.imageUrl = imageUrl;
  existing.imagePublicId = imagePublicId;

  await existing.save();

  return success(res, 200, existing, 'Blog post updated successfully');
});

/**
 * @route   DELETE /api/blogs/:id
 * @desc    Delete a blog post & remove its image from Cloudinary
 * @access  Private/Admin
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const blog = await Blog.findById(id);

  if (!blog) {
    return error(res, 404, 'Blog post not found');
  }

  // Delete image from Cloudinary if imagePublicId is stored
  if (blog.imagePublicId) {
    await deleteFromCloudinary(blog.imagePublicId);
  }

  await Blog.findByIdAndDelete(id);

  return success(res, 200, null, 'Blog post deleted successfully');
});

export default { getBlogs, getBlogById, getBlogBySlug, createBlog, updateBlog, deleteBlog };
