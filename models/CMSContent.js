import mongoose from 'mongoose';

/**
 * CMS Content Schema
 * Manages website content (hero, services, solutions, etc.)
 */
const cmsContentSchema = new mongoose.Schema(
  {
    section: {
      type: String,
      enum: [
        // Legacy/shared sections
        'hero',
        'services',
        'testimonials',
        'about',
        'stats',
        // DKR Trucking website sections (see frontend site/lib/siteContent.js)
        'faqs',
        'truck_types',
        'truck_images',
        'social_links',
        'how_it_works',
      ],
      required: true,
    },
    title: String,
    subtitle: String,
    description: String,
    image: String, // Cloudinary URL
    tags: [String],
    order: {
      type: Number,
      default: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
    metadata: mongoose.Schema.Types.Mixed, // Flexible section-specific data
  },
  { timestamps: true }
);

// Index for frequently queried fields
cmsContentSchema.index({ section: 1, isVisible: 1 });

const CMSContent = mongoose.model('CMSContent', cmsContentSchema);

export default CMSContent;
