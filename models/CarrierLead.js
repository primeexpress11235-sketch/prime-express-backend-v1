import mongoose from 'mongoose';

export const CARRIER_LEAD_STATUS_ENUM = [
  'Untouched',
  'Not Picked Up',
  'Voicemail Sent',
  'Not Interested',
  'Follow Up/Busy',
  'Interested',
  'Very Serious',
  'Spanish',
  'Asked for Email',
  'Asked for Text Msg',
];

export const MC_STATUS_ENUM = ['New', 'Growing', 'Veteran'];

const assignmentSchema = new mongoose.Schema(
  {
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedDate: { type: Date, default: Date.now },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const preferencesSchema = new mongoose.Schema(
  {
    operationPreference: {
      type: String,
      enum: ['OTR', 'Regional', 'Both', 'Both, but OTR only for better-paying loads', ''],
      default: '',
    },
    distancePreference: {
      type: String,
      enum: ['Under 200 miles', '200–300 miles', '300–500 miles', '500–750 miles', '750+ miles', 'Flexible', ''],
      default: '',
    },
    minRatePerMile: { type: String, default: '' },
    minRatePerMileCustom: { type: Number, default: null },
    lanePreference: {
      type: String,
      enum: ['Any Lane', 'Specific States', 'Specific Region', 'Custom', ''],
      default: '',
    },
    lanePreferenceStates: { type: [String], default: [] },
    lanePreferenceRegion: { type: String, default: '' },
    lanePreferenceCustom: { type: String, default: '' },
    schedulePreference: {
      type: String,
      enum: ['Daily Home', 'Mon–Fri', 'Mon–Sunday', 'Flexible', ''],
      default: '',
    },
  },
  { _id: false }
);

const documentsReceivedSchema = new mongoose.Schema(
  {
    mcLetter: { type: Boolean, default: false },
    coi: { type: Boolean, default: false },
    w9: { type: Boolean, default: false },
    noa: { type: Boolean, default: false },
  },
  { _id: false }
);

const truckDetailsSchema = new mongoose.Schema(
  {
    truckType: { type: String, default: '' },
    trailerLength: { type: String, default: '' },
    trailerLengthValue: { type: Number, default: null },
    trailerLengthUnit: { type: String, default: 'ft' },
    isCustomTrailerLength: { type: Boolean, default: false },

    maxWeightCapacity: { type: Number, default: null },
    maxCargoCapacityValue: { type: Number, default: null },
    maxCargoCapacityUnit: { type: String, default: 'lb' },
    isCustomMaxCargoCapacity: { type: Boolean, default: false },

    currentZip: { type: String, default: '' },
    availability: {
      type: String,
      enum: ['Empty Today', 'Empty Tomorrow', 'Empty This Week', 'Empty Next Week', 'Empty Next Month', 'Custom Date', ''],
      default: '',
    },
    availabilityCustomDate: {
      type: Date,
      default: null,
      set: (v) => (!v || v === '' || v === 'null' || v === 'undefined' ? null : v),
    },
    equipment: { type: [String], default: [] },
    documentsReceived: { type: documentsReceivedSchema, default: () => ({}) },
    preferences: { type: preferencesSchema, default: () => ({}) },
    notes: { type: String, default: '' },

    // Driver & Dispatcher assignment
    driverName: { type: String, default: '', trim: true },
    driverPhone: { type: String, default: '', trim: true },
    assignedDispatcherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      set: (v) => (!v || v === '' || v === 'null' || v === 'undefined' ? null : v),
    },

    // Dynamic specialized fields
    trailerTypesPullable: { type: [String], default: [] },
    powerUnitCapability: { type: String, default: '' },
    temperatureType: { type: String, default: '' },
    tankerType: { type: String, default: '' },
    tankCapacityValue: { type: Number, default: null },
    tankCapacityUnit: { type: String, default: 'gal' },
    isCustomTankCapacity: { type: Boolean, default: false },
    vehicleCapacityValue: { type: Number, default: null },
    isCustomVehicleCapacity: { type: Boolean, default: false },
  },
  { _id: false }
);

const carrierLeadSchema = new mongoose.Schema(
  {
    mcNumberDigits: { type: String, default: '' },
    dotNumberDigits: { type: String, default: '' },
    phoneDigits: { type: String, default: '' },
    mcNumber: { type: String, trim: true },
    dotNumber: { type: String, trim: true },
    companyName: {
      type: String,
      required: [true, 'Please provide a company name'],
      trim: true,
    },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
    powerUnits: { type: Number, default: 0 },
    mcAge: { type: String, default: '' },
    mcStatus: {
      type: String,
      enum: MC_STATUS_ENUM,
      default: 'New',
    },
    currentStatus: {
      type: String,
      enum: CARRIER_LEAD_STATUS_ENUM,
      default: 'Untouched',
    },
    assignments: {
      type: [assignmentSchema],
      default: [],
    },
    detailsAdded: {
      type: Boolean,
      default: false,
    },
    truckDetails: {
      type: truckDetailsSchema,
      default: () => ({}),
    },
    // Multi-truck support
    trucks: {
      type: [truckDetailsSchema],
      default: [],
    },
    // Cloudinary document uploads
    documents: [
      {
        originalFileName: String,
        cloudinaryUrl: String,
        cloudinaryPublicId: String,
        resourceType: { type: String, default: 'raw' },
        type: { type: String, default: 'other' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    // Conversion & Submission Traceability Fields
    convertedToCarrierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Carrier',
      default: null,
      set: (v) => (!v || v === '' || v === 'null' || v === 'undefined' ? null : v),
    },
    submittedAt: {
      type: Date,
      default: null,
      set: (v) => (!v || v === '' || v === 'null' || v === 'undefined' ? null : v),
    },
    submittedByAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      set: (v) => (!v || v === '' || v === 'null' || v === 'undefined' ? null : v),
    },
    isSubmitted: {
      type: Boolean,
      default: false,
    },
    quickMessageSentAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

carrierLeadSchema.pre('save', async function () {
  this.mcNumberDigits = String(this.mcNumber || '').replace(/\D/g, '');
  this.dotNumberDigits = String(this.dotNumber || '').replace(/\D/g, '');
  this.phoneDigits = String(this.phone || '').replace(/\D/g, '');
});

carrierLeadSchema.index({ createdAt: 1 });
carrierLeadSchema.index({ state: 1 });
carrierLeadSchema.index({ mcNumber: 1 }, { unique: true, sparse: true });
carrierLeadSchema.index({ dotNumber: 1 }, { unique: true, sparse: true });
carrierLeadSchema.index({ currentStatus: 1 });
carrierLeadSchema.index({ 'assignments.agentId': 1 });
carrierLeadSchema.index({ 'assignments.agentId': 1, currentStatus: 1 });
carrierLeadSchema.index({ 'assignments.assignedDate': 1 });
carrierLeadSchema.index({ companyName: 1 });
carrierLeadSchema.index({ mcNumberDigits: 1 });
carrierLeadSchema.index({ dotNumberDigits: 1 });
carrierLeadSchema.index({ phoneDigits: 1 });
carrierLeadSchema.index({ submittedByAgentId: 1 });

const CarrierLead = mongoose.model('CarrierLead', carrierLeadSchema);

export default CarrierLead;
