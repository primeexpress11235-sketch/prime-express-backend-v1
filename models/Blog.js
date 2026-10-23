import mongoose from 'mongoose';

/**
 * Blog Schema
 * Represents blog posts published via Website CMS
 */
const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    body: {
      type: String,
      required: true,
    },
    author: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    imagePublicId: {
      type: String,
    },
  },
  { timestamps: true }
);

blogSchema.index({ date: -1 });
blogSchema.index({ category: 1 });
blogSchema.index({ slug: 1 });

blogSchema.pre('validate', function setSlug(next) {
  if (!this.slug && this.title) {
    this.slug = this.title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

const Blog = mongoose.model('Blog', blogSchema);

export default Blog;
