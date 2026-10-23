import mongoose from 'mongoose';

/**
 * Truck — one unit of a carrier's fleet, as tracked on the Dispatcher Fleet
 * Board.
 *
 * The board is truck-centric, not task-centric: a card is a truck, and it
 * exists to answer "where is it, when is it empty, which ZIP do I search, and
 * what do I do next?" without the dispatcher opening anything.
 */

// Fleet equipment. Deliberately its own list rather than reusing the website's
// TRUCK_TYPES — that list is marketing copy ("Flat Bed", "Hot Shot") while this
// is operational. Exactly 7 standardized types.
export const EQUIPMENT_TYPES = [
  'Dry Van',
  'Flatbed',
  'FlatBed',
  'Reefer',
  'Step Deck',
  'Hotshot',
  'HotShot',
  'Power Only',
  'Box Truck',
  'Lowboy',
  'lowboy',
  'RGN',
  'Conestoga',
  'Tanker',
  'Auto/Car Hauler',
];

/**
 * Where the truck is in its cycle. Ordered as the cycle actually runs, which is
 * also the order a future automation would walk:
 *   searching_load -> load_booked -> heading_to_pickup -> loaded
 *                  -> in_transit -> delivering -> empty -> (searching_load)
 * `issue` sits outside the cycle and can be entered from anywhere.
 */
export const TRUCK_STATUSES = [
  'searching_load',
  'load_booked',
  'heading_to_pickup',
  'loaded',
  'in_transit',
  'delivering',
  'empty',
  'issue',
];

/**
 * The natural next status for each point in the cycle. Nothing reads this yet —
 * it exists so a later automation ("a load was booked for this truck") can
 * advance a truck without hard-coding the sequence at the call site.
 */
export const STATUS_FLOW = {
  searching_load: 'load_booked',
  load_booked: 'heading_to_pickup',
  heading_to_pickup: 'loaded',
  loaded: 'in_transit',
  in_transit: 'delivering',
  delivering: 'empty',
  empty: 'searching_load',
};

export const NEXT_ACTIONS = [
  'find_load',
  'call_broker',
  'negotiate_rate',
  'send_rate_confirmation',
  'update_driver',
  'collect_pod',
  'send_invoice',
  'resolve_issue',
];

/**
 * The action a dispatcher should take at each status. Used as a sensible
 * default when a status changes and nobody set an action explicitly, so a card
 * is never left without a next action.
 */
export const DEFAULT_ACTION_FOR_STATUS = {
  searching_load: 'find_load',
  load_booked: 'send_rate_confirmation',
  heading_to_pickup: 'update_driver',
  loaded: 'update_driver',
  in_transit: 'update_driver',
  delivering: 'collect_pod',
  empty: 'find_load',
  issue: 'resolve_issue',
};

const documentSchema = new mongoose.Schema(
  {
    label: String,
    url: { type: String, required: true }, // Cloudinary URL
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Append-only trail powering the Timeline on the truck detail panel.
const timelineSchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // 'created' | 'status_changed' | 'action_changed' | 'empty_updated' | 'updated' | 'document_added'
    from: String,
    to: String,
    note: String,
    // Null when an automation moved the truck rather than a person.
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const truckSchema = new mongoose.Schema(
  {
    // Nullable + name snapshot so deleting a carrier leaves the truck readable
    // instead of orphaned, matching how Load and Carrier already relate.
    carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'Carrier', default: null },
    carrierName: { type: String, trim: true },
    sourceLeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'CarrierLead', default: null },
    sourceLeadTruckIndex: { type: Number, default: null },

    truckNumber: { type: Number, required: [true, 'A truck number is required'], min: 1 },
    equipmentType: { type: String, enum: EQUIPMENT_TYPES, default: 'Dry Van' },

    driverName: { type: String, trim: true },
    driverPhone: { type: String, trim: true },

    dispatcher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    status: { type: String, enum: TRUCK_STATUSES, default: 'empty' },
    nextAction: { type: String, enum: NEXT_ACTIONS, default: 'find_load' },

    // --- The operational core of the card ------------------------------
    // The ZIP is what a dispatcher types into DAT/Truckstop, so it is the most
    // important field on the record and is never buried in a detail view.
    emptyZip: { type: String, trim: true },
    emptyCity: { type: String, trim: true },
    emptyState: { type: String, trim: true, uppercase: true, maxlength: 2 },
    // When the truck becomes (or became) available.
    emptyAt: { type: Date, default: null },

    // The shipper side of the booked load. Only meaningful once a load exists,
    // and only shown while the truck has not yet picked up.
    pickupZip: { type: String, trim: true },
    pickupCity: { type: String, trim: true },
    pickupState: { type: String, trim: true, uppercase: true, maxlength: 2 },
    // When the truck is due at the shipper.
    pickupAppointment: { type: Date, default: null },

    // The receiver side of the booked load. Named "destination" because these
    // fields predate the pipeline; they are the delivery location.
    destinationZip: { type: String, trim: true },
    destinationCity: { type: String, trim: true },
    destinationState: { type: String, trim: true, uppercase: true, maxlength: 2 },
    // When the truck is expected at the receiver, while it is rolling.
    eta: { type: Date, default: null },
    // When the truck actually reached the receiver. Stamped automatically the
    // moment the truck enters the delivering status.
    arrivedAt: { type: Date, default: null },

    currentLoad: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', default: null },

    preferredLanes: { type: String, trim: true },
    notes: { type: String, trim: true },

    // --- Dynamic Equipment Type Attributes & Universal Max Load Capacity ---
    maxLoadCapacity: { type: Number, default: null }, // Universal max load capacity in lbs (required for all types except Power Only)
    neckType: { type: String, enum: ['fixed', 'removable', null], default: null },
    doorType: { type: String, enum: ['Swing', 'Roll-up', null], default: null },
    liftGate: { type: String, enum: ['Yes', 'No', null], default: null },
    trailerLength: { type: String, enum: ['48ft', '53ft', null], default: null },
    stepDeckSubType: { type: String, enum: ['Extendable', 'With Loading Ramps', 'Over-Dimension Loads', null], default: null },
    trailerConfig: { type: String, enum: ['Gooseneck', 'Bumper Pull', null], default: null },
    trailerSize: { type: String, enum: ['20ft', '25ft', '30ft', '35ft', '40ft', null], default: null },
    cargoType: { type: String, enum: ['Food Grade', 'Liquid', 'Bulk', null], default: null },

    documents: { type: [documentSchema], default: [] },
    timeline: { type: [timelineSchema], default: [] },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Extension point: lets a future automation record that it, not a person,
    // last advanced this truck.
    lastAutomationAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One truck number per carrier — "Truck #3" must be unambiguous within a fleet.
truckSchema.index({ carrier: 1, truckNumber: 1 }, { unique: true });
truckSchema.index({ dispatcher: 1 });
truckSchema.index({ status: 1 });
truckSchema.index({ emptyZip: 1 });
truckSchema.index({ emptyState: 1 });
truckSchema.index({ equipmentType: 1 });

const Truck = mongoose.model('Truck', truckSchema);

export default Truck;
