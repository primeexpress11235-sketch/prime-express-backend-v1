import mongoose from 'mongoose';

/**
 * TruckPipelineCard — one truck's position in the Trucks Management board's
 * load cycle.
 *
 * Deliberately its own collection rather than fields on Truck. This is
 * operational, ephemeral state (which checkboxes a dispatcher has ticked on the
 * current load) and it resets every time the truck cycles back to empty; the
 * Truck record is the permanent profile. Keeping them apart means this board
 * cannot disturb the Fleet Board, the Leads Pipeline, or anything that reads
 * `Truck.status` — a card and a truck status are free to disagree, because they
 * answer different questions.
 *
 * A card is created lazily, one per active truck, the first time the board is
 * loaded. There is no "add to board" step: every truck a dispatcher works is on
 * the board by definition.
 */

/** The six stages, in cycle order. `issue` sits outside the cycle. */
export const STAGES = [
  'empty',
  'searching_loads',
  'load_booked',
  'heading_to_pickup',
  'intransit',
  'issue',
];

/** The five stages an issue can be resolved back into. */
export const RESOLVABLE_STAGES = STAGES.filter((s) => s !== 'issue');

/** Every checkbox that can drive a transition, in the order they are ticked. */
export const STAGE_FLAGS = [
  'searchLoad',
  'loadBooked',
  'rateConfirmationSent',
  'loadPicked',
  'loadDelivered',
  'collectPOD',
];

/**
 * The linear part of the machine: ticking `flag` in `from` lands the card in
 * `to`. Untickng it walks the same edge backwards.
 *
 * The last two flags are absent because Intransit does not advance on a single
 * checkbox — it needs `loadDelivered` AND `collectPOD` together, which is
 * expressed by COMPLETION_FLAGS instead.
 */
export const TRANSITIONS = {
  searchLoad: { from: 'empty', to: 'searching_loads' },
  loadBooked: { from: 'searching_loads', to: 'load_booked' },
  rateConfirmationSent: { from: 'load_booked', to: 'heading_to_pickup' },
  loadPicked: { from: 'heading_to_pickup', to: 'intransit' },
};

/** Both must be ticked before an Intransit card closes its cycle. */
export const COMPLETION_FLAGS = ['loadDelivered', 'collectPOD'];

/** Load detail fields that must be filled before "Load Booked" is accepted. */
export const REQUIRED_LOAD_FIELDS = [
  'pickup.location',
  'pickup.datetime',
  'delivery.location',
  'delivery.datetime',
  'commodity',
  'weight',
  'trip',
  'rate',
];

/**
 * The flag set a stage implies. Used to keep the checkboxes honest after any
 * transition the dispatcher did not tick their way into — resolving an issue
 * straight to Intransit, most obviously — so a card never renders with a
 * checkbox that contradicts its column.
 */
export function flagsForStage(stage) {
  const ticked = {
    empty: [],
    searching_loads: ['searchLoad'],
    load_booked: ['searchLoad', 'loadBooked'],
    heading_to_pickup: ['searchLoad', 'loadBooked', 'rateConfirmationSent'],
    intransit: ['searchLoad', 'loadBooked', 'rateConfirmationSent', 'loadPicked'],
    // An issue keeps whatever the dispatcher had ticked; callers handle it.
    issue: [],
  }[stage] || [];

  return STAGE_FLAGS.reduce((acc, flag) => ({ ...acc, [flag]: ticked.includes(flag) }), {});
}

/** Stages that cannot be entered without load details on the card. */
export const STAGES_REQUIRING_LOAD = ['load_booked', 'heading_to_pickup', 'intransit'];

const locationSchema = new mongoose.Schema(
  {
    zip: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, uppercase: true, maxlength: 2, default: '' },
  },
  { _id: false }
);

const stopSchema = new mongoose.Schema(
  {
    location: { type: String, trim: true, default: '' },
    datetime: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * The booked load as the dispatcher entered it. Structured, never one blob:
 * Heading to Pickup and Intransit re-render these same fields rather than
 * asking for them again, and the same values are what get written into the
 * carrier's load history.
 */
const loadDetailsSchema = new mongoose.Schema(
  {
    pickup: { type: stopSchema, default: () => ({}) },
    delivery: { type: stopSchema, default: () => ({}) },
    commodity: { type: String, trim: true, default: '' },
    weight: { type: String, trim: true, default: '' },
    deadhead: { type: String, trim: true, default: '' },
    trip: { type: String, trim: true, default: '' },
    rate: { type: Number, default: null },
  },
  { _id: false }
);

// One entry per raised issue, closed out when the dispatcher resolves it. Kept
// after resolution rather than discarded — a carrier that generates six issues
// a month is a pattern worth being able to see.
const issueHistorySchema = new mongoose.Schema(
  {
    note: { type: String, trim: true, default: '' },
    raisedFromStage: { type: String, enum: STAGES, default: null },
    raisedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    resolvedToStage: { type: String, enum: RESOLVABLE_STAGES, default: null },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    raisedByName: { type: String, trim: true },
  },
  { _id: true }
);

const truckPipelineCardSchema = new mongoose.Schema(
  {
    // One card per truck — the unique index is what makes lazy provisioning
    // safe against two dispatchers opening the board at the same moment.
    truck: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Truck',
      required: true,
      unique: true,
    },
    // Denormalized off the truck so the load-history write and the carrier
    // filter do not need a second lookup. Refreshed whenever the board loads.
    carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'Carrier', default: null },

    currentStage: { type: String, enum: STAGES, default: 'empty' },

    // Where the truck sits empty. Seeded from the truck's empty fields when the
    // card is created, then owned by this board: the dispatcher retypes it each
    // cycle and it must not write back over what the Fleet Board is showing.
    location: { type: locationSchema, default: () => ({}) },

    loadDetails: { type: loadDetailsSchema, default: () => ({}) },
    // The history record written when this load was booked, so the card can
    // point at it without the load details themselves being the history.
    currentLoad: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', default: null },

    stageFlags: {
      searchLoad: { type: Boolean, default: false },
      loadBooked: { type: Boolean, default: false },
      rateConfirmationSent: { type: Boolean, default: false },
      loadPicked: { type: Boolean, default: false },
      loadDelivered: { type: Boolean, default: false },
      collectPOD: { type: Boolean, default: false },
    },

    issue: {
      active: { type: Boolean, default: false },
      note: { type: String, trim: true, default: '' },
      history: { type: [issueHistorySchema], default: [] },
    },

    // Recorded for reference only. Resolving an issue is a deliberate choice
    // from a dropdown — nothing reads this to send a card back automatically.
    preIssueStage: { type: String, enum: [...STAGES, null], default: null },

    // Completed Empty → … → Empty loops, i.e. loads run off this board.
    cyclesCompleted: { type: Number, default: 0 },
    lastCycleAt: { type: Date, default: null },
    stageEnteredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

truckPipelineCardSchema.index({ currentStage: 1 });
truckPipelineCardSchema.index({ carrier: 1 });

const TruckPipelineCard = mongoose.model('TruckPipelineCard', truckPipelineCardSchema);

export default TruckPipelineCard;
