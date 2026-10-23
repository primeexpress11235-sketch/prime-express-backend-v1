import mongoose from 'mongoose';

/**
 * Driver Schema
 * Manages DKR Trucking's CDL Driver Recruiting & Hiring Pipeline.
 */
export const DRIVER_STATUSES = [
  'New',
  'Interviewed',
  'Qualified',
  'Hired',
  'Not Interested'
];

export const DRIVER_SOURCES = [
  'Facebook Group',
  'Indeed',
  'TruckersReport',
  'Referral',
  'Trucking School',
  'Social Media Video',
  'Google Search',
  'Other',
  'Website',
];

export const EQUIPMENT_OPTIONS = ['Flatbed', 'Step Deck', 'Dry Van', 'Hotshot'];
export const ENDORSEMENT_OPTIONS = ['TWIC', 'Hazmat'];

const driverDocumentSchema = new mongoose.Schema(
  {
    originalFileName: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    cloudinaryPublicId: { type: String, default: '' },
    resourceType: { type: String, default: 'raw' },
    fileType: {
      type: String,
      enum: ['CDL License', 'Medical Card', 'MVR', 'Resume', 'Other'],
      default: 'Other',
    },
    mimeType: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual properties for backwards compatibility with existing UI references
driverDocumentSchema.virtual('fileName').get(function () {
  return this.originalFileName;
});
driverDocumentSchema.virtual('fileUrl').get(function () {
  return this.cloudinaryUrl;
});

export const DQF_ITEMS_CONFIG = [
  { itemKey: 'cdlLicense', title: 'CDL License', autoPopulateType: 'CDL License', hasExpiration: true },
  { itemKey: 'medicalCard', title: "Medical Examiner's Certificate (Medical Card)", autoPopulateType: 'Medical Card', hasExpiration: true },
  { itemKey: 'mvr', title: 'MVR (Motor Vehicle Record)', autoPopulateType: 'MVR', hasExpiration: true },
  { itemKey: 'resume', title: 'Employment Application / Resume', autoPopulateType: 'Resume', hasExpiration: false },
  { itemKey: 'roadTestCert', title: 'Road Test Certificate', autoPopulateType: null, hasExpiration: false },
  { itemKey: 'annualViolationReview', title: 'Annual Violation Review (self-reported)', autoPopulateType: null, hasExpiration: false },
  { itemKey: 'certOfViolations', title: 'Certificate of Violations Review (employer-signed)', autoPopulateType: null, hasExpiration: false },
  { itemKey: 'drugAlcoholTest', title: 'Drug/Alcohol Test Results', autoPopulateType: null, hasExpiration: true },
];

const dqfItemSchema = new mongoose.Schema(
  {
    itemKey: {
      type: String,
      required: true,
      enum: [
        'cdlLicense',
        'medicalCard',
        'mvr',
        'resume',
        'roadTestCert',
        'annualViolationReview',
        'certOfViolations',
        'drugAlcoholTest',
      ],
    },
    title: { type: String, required: true },
    hasExpiration: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['Missing', 'Uploaded', 'Expiring Soon', 'Expired', 'Valid'],
      default: 'Missing',
    },
    cloudinaryUrl: { type: String, default: '' },
    cloudinaryPublicId: { type: String, default: '' },
    originalFileName: { type: String, default: '' },
    resourceType: { type: String, default: 'raw' },
    mimeType: { type: String, default: '' },
    expirationDate: { type: Date, default: null },
    uploadedAt: { type: Date, default: null },
    uploadedBy: { type: String, default: '' },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

const driverSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Driver name is required'], trim: true },
    phone: { type: String, required: [true, 'Phone number is required'], trim: true },
    email: { type: String, required: [true, 'Email address is required'], trim: true, lowercase: true },
    homeState: { type: String, required: [true, 'Home state is required'], trim: true },
    yearsExperience: { type: Number, required: [true, 'Years of experience is required'], min: 0 },
    
    equipmentExperience: {
      type: [String],
      enum: EQUIPMENT_OPTIONS,
      default: [],
    },
    manualTransmission: { type: Boolean, default: false },
    endorsements: {
      type: [String],
      enum: ENDORSEMENT_OPTIONS,
      default: [],
    },
    currentEmployer: { type: String, trim: true, default: '' },
    earliestAvailableDate: { type: Date, default: null },
    payExpectation: { type: String, trim: true, default: '' },
    
    status: {
      type: String,
      enum: DRIVER_STATUSES,
      default: 'New',
    },
    source: {
      type: String,
      enum: DRIVER_SOURCES,
      default: 'Facebook Group',
    },
    referredBy: { type: String, trim: true, default: '' },
    lastContactedDate: { type: Date, default: Date.now },
    
    screeningAnswers: {
      cdlYearsExperience: { type: String, default: '' },
      flatbedExperience: { type: String, default: '' },
      comfortableManualTransmission: { type: String, default: '' },
      accidentsLast3Years: { type: String, default: '' },
      movingViolations: { type: String, default: '' },
      canStayOutAsRequired: { type: String, default: '' },
      expectedWeeklyIncome: { type: String, default: '' },
      reasonLeavingCurrentCompany: { type: String, default: '' },
    },
    
    smsConsent: { type: Boolean, default: false },
    smsConsentTimestamp: { type: Date, default: null },
    
    documents: { type: [driverDocumentSchema], default: [] },
    dqfChecklist: { type: [dqfItemSchema], default: [] },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual for calculating compliance status of Hired drivers
driverSchema.virtual('complianceStatus').get(function () {
  if (this.status !== 'Hired') return null;
  if (!this.dqfChecklist || this.dqfChecklist.length === 0) return 'Non-Compliant';

  let hasMissingOrExpired = false;
  let hasExpiringSoon = false;

  for (const itemConfig of DQF_ITEMS_CONFIG) {
    const item = this.dqfChecklist.find((i) => i.itemKey === itemConfig.itemKey);
    if (!item || !item.cloudinaryUrl || item.status === 'Missing' || item.status === 'Expired') {
      hasMissingOrExpired = true;
      break;
    }
    if (item.status === 'Expiring Soon') {
      hasExpiringSoon = true;
    }
  }

  if (hasMissingOrExpired) return 'Non-Compliant';
  if (hasExpiringSoon) return 'Expiring Soon';
  return 'Compliant';
});

driverSchema.index({ status: 1 });
driverSchema.index({ source: 1 });
driverSchema.index({ email: 1 });
driverSchema.index({ phone: 1 });

const Driver = mongoose.model('Driver', driverSchema);

export default Driver;
