import mongoose from 'mongoose';

/**
 * Carrier Schema
 * A trucking carrier/owner-operator managed by DKR. Carriers move through the
 * leads pipeline and, once active, accumulate loads and documents. The current
 * pipeline stage plus a per-transition history (for "days in current stage")
 * live directly on this record — there is no separate lead model.
 */

/**
 * The seven stages a carrier moves through, in board order. A carrier is
 * sourced by a sales agent (new_lead), handed to a dispatcher
 * (dispatcher_assigned), reached (contacted), documented (qualification),
 * approved (ready_for_dispatch), booked (active_carrier), or lost
 * (inactive_churned).
 */
export const PIPELINE_STAGES = [
  'new_lead',
  'dispatcher_assigned',
  'contacted',
  'qualification',
  'ready_for_dispatch',
  'active_carrier',
  'inactive_churned',
];

// Stages that precede active work — booking a load promotes out of any of them.
export const PRE_ACTIVE_STAGES = PIPELINE_STAGES.slice(0, PIPELINE_STAGES.indexOf('active_carrier'));

// Stages where the carrier is actively being worked by a dispatcher, so a
// pending follow-up still means something. Moving anywhere else clears it.
export const FOLLOW_UP_STAGES = ['contacted', 'qualification'];

// Renamed stage keys from the original 6-stage pipeline. Used by the migration
// script and to coerce any stale value still arriving from a client.
export const LEGACY_STAGE_MAP = {
  assigned_to_dispatcher: 'dispatcher_assigned',
  documents_vetting: 'qualification',
};

export const normalizeStage = (stage) => LEGACY_STAGE_MAP[stage] || stage;

const documentSchema = new mongoose.Schema(
  {
    originalFileName: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    cloudinaryPublicId: { type: String, default: '' },
    resourceType: { type: String, default: 'raw' },
    type: {
      type: String,
      enum: ['rate_confirmation', 'bol', 'insurance', 'w9', 'mc_authority', 'other'],
      default: 'other',
    },
    mimeType: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual properties for backwards compatibility with existing UI references
documentSchema.virtual('label').get(function () {
  return this.originalFileName;
});
documentSchema.virtual('url').get(function () {
  return this.cloudinaryUrl;
});

// One entry per stage transition, used to compute days-in-current-stage.
const stageHistorySchema = new mongoose.Schema(
  {
    stage: { type: String, enum: PIPELINE_STAGES, required: true },
    enteredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const preferencesSchema = new mongoose.Schema(
  {
    operationPreference: { type: String, enum: ['OTR', 'Regional', 'Both', 'Both, but OTR only for better-paying loads', ''], default: '' },
    distancePreference: { type: String, enum: ['Under 200 miles', '200–300 miles', '300–500 miles', '500–750 miles', '750+ miles', 'Flexible', ''], default: '' },
    minRatePerMile: { type: String, default: '' },
    minRatePerMileCustom: { type: Number, default: null },
    lanePreference: { type: String, enum: ['Any Lane', 'Specific States', 'Specific Region', 'Custom', ''], default: '' },
    lanePreferenceStates: { type: [String], default: [] },
    lanePreferenceRegion: { type: String, default: '' },
    lanePreferenceCustom: { type: String, default: '' },
    schedulePreference: { type: String, enum: ['Daily Home', 'Mon–Fri', 'Mon–Sunday', 'Flexible', ''], default: '' },
  },
  { _id: false }
);

const onboardingDocumentFlagsSchema = new mongoose.Schema(
  {
    mcLetter: { type: Boolean, default: false },
    coi: { type: Boolean, default: false },
    w9: { type: Boolean, default: false },
    noa: { type: Boolean, default: false },
  },
  { _id: false }
);

const carrierSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, 'Please provide a company name'],
      trim: true,
    },
    // MC / DOT authority numbers. Sparse-unique so duplicates are rejected but
    // records without a number yet are still allowed.
    mcNumber: { type: String, trim: true },
    dotNumber: { type: String, trim: true },
    // Standard DKR trailer types (Dry Van, Reefer, Step Deck, Flat Bed,
    // Power Only, Hot Shot, Box Truck). Free string to stay in sync with the
    // website's configurable truck types.
    truckType: { type: String, trim: true },
    contactName: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    insuranceInfo: { type: String, trim: true },

    // Date the carrier's MC operating authority was granted. Drives the single
    // "new authority" badge on the pipeline card; nothing else derives from it.
    authorityStartDate: { type: Date, default: null },
    // Fleet size, shown on Active Carrier cards.
    numberOfTrucks: { type: Number, default: 0, min: 0 },

    // --- Stage-specific operational state -------------------------------
    // Contacted: when the dispatcher last spoke to the carrier, and whether
    // they flagged it for another attempt.
    lastContactAt: { type: Date, default: null },
    needsFollowUp: { type: Boolean, default: false },
    // Qualification: onboarding paperwork is in. Deliberately a single boolean
    // — per-document tracking stays in `documents` on the detail view.
    documentsReceived: { type: Boolean, default: false },
    preferences: { type: preferencesSchema, default: undefined },
    onboardingDocumentFlags: { type: onboardingDocumentFlagsSchema, default: undefined },
    // Free-text reason a carrier is parked in qualification, e.g. "MC is too
    // new — only 1 month". Intentionally not an enum; the situations vary.
    qualificationNote: { type: String, trim: true },
    // Inactive / Churned: free-text, intentionally not an enum.
    inactiveReason: { type: String, trim: true },

    pipelineStage: {
      type: String,
      enum: PIPELINE_STAGES,
      default: 'new_lead',
    },
    stageHistory: {
      type: [stageHistorySchema],
      default: () => [{ stage: 'new_lead', enteredAt: new Date() }],
    },
    convertedFromLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CarrierLead',
      default: null,
    },
    activatedAt: { type: Date, default: null },
    assignedSalesAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    documents: { type: [documentSchema], default: [] },
    notes: { type: String, trim: true },
    dateAdded: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Sparse-unique so a missing MC/DOT does not collide, but provided ones must be
// unique. Duplicate prevention is also enforced explicitly in the controller
// to return a friendly error before hitting the index.
carrierSchema.index({ mcNumber: 1 }, { unique: true, sparse: true });
carrierSchema.index({ dotNumber: 1 }, { unique: true, sparse: true });
carrierSchema.index({ pipelineStage: 1 });
carrierSchema.index({ truckType: 1 });

const Carrier = mongoose.model('Carrier', carrierSchema);

export default Carrier;
