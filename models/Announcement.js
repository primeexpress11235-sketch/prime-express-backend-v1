import mongoose from 'mongoose';

/**
 * Announcement Schema
 * An internal announcement posted by the admin, optionally scoped to specific
 * roles via `visibleToRoles` (empty array = visible to all roles).
 */
const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a title'],
      trim: true,
    },
    body: { type: String, trim: true },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    visibleToRoles: {
      type: [String],
      enum: ['admin', 'dispatcher', 'sales_agent', 'carrier'],
      default: [],
    },
  },
  { timestamps: true }
);

announcementSchema.index({ createdAt: -1 });

const Announcement = mongoose.model('Announcement', announcementSchema);

export default Announcement;
