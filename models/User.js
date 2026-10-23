import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

/**
 * User Schema
 * Represents all internal user accounts: admin plus the team roles.
 * Only admin gets full UI this phase; the other roles exist so RBAC and
 * assignment references are in place for later phases.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 6,
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: ['admin', 'dispatcher', 'sales_agent', 'carrier'],
      default: 'dispatcher',
    },
    // Applicable to dispatcher / sales_agent. Drives attendance rules and
    // work-location filtering. Left unset for admin/carrier.
    workLocation: {
      type: String,
      enum: ['remote', 'onsite'],
    },
    isFirstLogin: {
      type: Boolean,
      default: true,
    },
    // Soft-delete/deactivate flag. Removed team members are deactivated, not
    // hard-deleted, so historical references (loads, attendance) stay intact.
    isActive: {
      type: Boolean,
      default: true,
    },
    // `avatar` serves as the user's profile picture (Cloudinary URL), reusing
    // the existing field name already wired through the frontend.
    avatar: {
      type: String,
      default: '',
    },
    leadsSubmittedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeCarrierCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    cnic: {
      type: String,
      trim: true,
      default: '',
    },
    agreementAcceptedAt: {
      type: Date,
      default: null,
    },
    contractRequest: {
      status: { type: String, enum: ['not_sent', 'pending', 'signed'], default: 'not_sent' },
      sentAt: { type: Date, default: null },
      version: { type: Number, default: 0 },
    },
    contractVersions: {
      type: [{
        version: { type: Number, required: true },
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
        signedAt: { type: Date, required: true },
        cnic: { type: String, trim: true, required: true },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcryptjs.genSalt(10);
    this.password = await bcryptjs.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcryptjs.compare(candidatePassword, this.password);
};

// Note: `email` is already indexed via `unique: true` above, so no explicit
// index declaration is needed here.

const User = mongoose.model('User', userSchema);

export default User;
