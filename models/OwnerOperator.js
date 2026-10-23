import mongoose from 'mongoose';

/**
 * Owner Operator Schema
 * Manages owner-operator 75/25 split applications from the public website.
 * Applicants submit CDL, resume, insurance cert, and other qualification details.
 */

export const TRUCK_EQUIPMENT_TYPES = [
  'Dry Van',
  'Flatbed',
  'Reefer',
  'Step Deck',
  'Hotshot',
  'Power Only',
];

export const CDL_CLASS_EXPERIENCE = [
  'Class A - 5+ Years',
  'Class A - 3-5 Years',
  'Class A - 1-3 Years',
  'Class A - Less than 1 Year',
  'Class B',
  'Other',
];

export const INSURANCE_COVERAGE_STATUS = [
  'Active - Current',
  'Active - Expired Soon',
  'Not Active',
  'In Process',
];

const documentSchema = new mongoose.Schema(
  {
    originalFileName: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    cloudinaryPublicId: { type: String, default: '' },
    resourceType: { type: String, default: 'raw' },
    documentType: {
      type: String,
      enum: ['cdl_license', 'resume', 'insurance_cert'],
      required: true,
    },
    mimeType: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtuals for backwards compatibility
documentSchema.virtual('label').get(function () {
  return this.originalFileName;
});
documentSchema.virtual('url').get(function () {
  return this.cloudinaryUrl;
});

const ownerOperatorSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please provide full name'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Please provide phone number'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide email'],
      lowercase: true,
      trim: true,
    },
    truckEquipmentType: {
      type: String,
      enum: TRUCK_EQUIPMENT_TYPES,
      required: true,
    },
    truckYear: { type: String, trim: true, default: '' },
    truckMake: { type: String, trim: true, default: '' },
    truckModel: { type: String, trim: true, default: '' },
    cdlLicenseNumber: {
      type: String,
      trim: true,
      default: '',
    },
    cdlClassAExperience: {
      type: String,
      enum: CDL_CLASS_EXPERIENCE,
      default: 'Class A - 1-3 Years',
    },
    insuranceCoverageStatus: {
      type: String,
      enum: INSURANCE_COVERAGE_STATUS,
      default: 'Not Active',
    },
    smsConsent: {
      type: Boolean,
      default: false,
    },
    smsConsentTimestamp: { type: Date, default: null },
    // Documents: CDL License, Resume/CV, Insurance Certificate
    documents: [documentSchema],
    // Admin tracking
    status: {
      type: String,
      enum: ['new', 'approved', 'rejected', 'active', 'inactive'],
      default: 'new',
    },
    internalNotes: { type: String, trim: true, default: '' },
    assignedManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

ownerOperatorSchema.index({ createdAt: -1 });
ownerOperatorSchema.index({ status: 1 });
ownerOperatorSchema.index({ truckEquipmentType: 1 });
ownerOperatorSchema.index({ cdlClassAExperience: 1 });
ownerOperatorSchema.index({ insuranceCoverageStatus: 1 });
ownerOperatorSchema.index({ email: 1 });
ownerOperatorSchema.index({ cdlLicenseNumber: 1 });

const OwnerOperator = mongoose.model('OwnerOperator', ownerOperatorSchema);

export default OwnerOperator;
