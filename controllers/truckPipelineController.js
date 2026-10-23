import asyncHandler from 'express-async-handler';
import TruckPipelineCard, {
  STAGES,
  RESOLVABLE_STAGES,
  STAGE_FLAGS,
  TRANSITIONS,
  COMPLETION_FLAGS,
  REQUIRED_LOAD_FIELDS,
  STAGES_REQUIRING_LOAD,
  flagsForStage,
} from '../models/TruckPipelineCard.js';
import Truck from '../models/Truck.js';
import Carrier from '../models/Carrier.js';
import { recordLoad } from '../services/loadHistory.js';
import { success, error } from '../utils/sendResponse.js';

/**
 * Trucks Management board — the dispatcher's load-cycle board.
 *
 * The checkbox in the UI is a trigger, not a decision: every transition is
 * re-derived here from the card's stored stage. The client never sends a stage,
 * only which flag it wants set, so a stale board or a hand-rolled request
 * cannot push a card into a stage it has not earned.
 */

const POPULATE = [
  {
    path: 'truck',
    select: 'truckNumber equipmentType driverName driverPhone dispatcher carrier carrierName emptyZip emptyCity emptyState isActive',
    populate: [
      { path: 'dispatcher', select: 'name email role' },
      { path: 'carrier', select: 'companyName mcNumber contactName contactPhone' },
    ],
  },
  { path: 'currentLoad', select: 'pickupLocation deliveryLocation pickupDate deliveryDate rate status' },
];

const isAdmin = (user) => String(user?.role || '').trim().toLowerCase() === 'admin';

/** Reads a dotted path off the load details, e.g. 'pickup.location'. */
const readPath = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

/**
 * Which required load fields are still blank. Returned rather than thrown so
 * the UI can highlight exactly what the dispatcher has to fill in before the
 * "Load Booked" checkbox will take.
 */
function missingLoadFields(loadDetails) {
  return REQUIRED_LOAD_FIELDS.filter((path) => {
    const value = readPath(loadDetails, path);
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (typeof value === 'number') return Number.isNaN(value);
    return false;
  });
}

/** Wipes the load off a card without touching its history record. */
function clearLoad(card) {
  card.loadDetails = {
    pickup: { location: '', datetime: null },
    delivery: { location: '', datetime: null },
    commodity: '', weight: '', deadhead: '', trip: '', rate: null,
  };
  card.currentLoad = null;
}

function enterStage(card, stage) {
  if (card.currentStage !== stage) card.stageEnteredAt = new Date();
  card.currentStage = stage;
}

/**
 * Cards appear on the board only when a dispatcher explicitly adds a truck by
 * selecting it in the "Ready for Dispatch" queue. Automatic creation on read is
 * intentionally disabled to prevent stale trucks from appearing without a manual
 * selection step.
 */
async function provisionCards() {
  return;
}

export const shouldAutoAddReadyDispatchTruck = ({ pipelineStage, truckCount }) => {
  const stage = String(pipelineStage || '').trim();
  const count = Number(truckCount || 0);
  return stage === 'ready_for_dispatch' && count === 1;
};

export const autoAddReadyDispatchTruckIfNeeded = async (carrier) => {
  if (!carrier || !shouldAutoAddReadyDispatchTruck({
    pipelineStage: carrier.pipelineStage,
    truckCount: carrier.numberOfTrucks,
  })) {
    return [];
  }

  const truck = await Truck.findOne({
    carrier: carrier._id,
    isActive: { $ne: false },
  }).sort({ truckNumber: 1 }).select('_id carrier emptyZip emptyCity emptyState');

  if (!truck) return [];

  let card = await TruckPipelineCard.findOne({ truck: truck._id });
  if (!card) {
    card = await TruckPipelineCard.create({
      truck: truck._id,
      carrier: truck.carrier,
      currentStage: 'empty',
      location: {
        zip: truck.emptyZip || '',
        city: truck.emptyCity || '',
        state: truck.emptyState || '',
      },
    });
  } else if (card.currentStage !== 'empty') {
    card.currentStage = 'empty';
    card.stageEnteredAt = new Date();
    clearLoad(card);
    const flags = flagsForStage('empty');
    STAGE_FLAGS.forEach((f) => { card.stageFlags[f] = flags[f]; });
    await card.save();
  }

  await TruckPipelineCard.populate(card, POPULATE);
  return [card];
};

/**
 * @route   GET /api/truck-pipeline
 * @desc    All cards the caller may see. Dispatchers get their own trucks;
 *          admins default to the same and can ask for ?scope=all.
 * @access  Private (admin, dispatcher)
 */
export const getPipelineCards = asyncHandler(async (req, res) => {
  const admin = isAdmin(req.user);
  const { scope, dispatcher } = req.query;

  let truckIds = [];

  if (!admin) {
    const trucks = await Truck.find({ dispatcher: req.user._id, isActive: { $ne: false } })
      .select('_id');
    truckIds = trucks.map((t) => t._id);
  } else if (dispatcher) {
    const dispatchId = String(dispatcher);
    const trucks = await Truck.find({
      dispatcher: dispatchId,
      isActive: { $ne: false },
    }).select('_id');

    truckIds = trucks.map((t) => t._id);
  } else if (scope !== 'all') {
    const trucks = await Truck.find({ dispatcher: req.user._id, isActive: { $ne: false } })
      .select('_id');
    truckIds = trucks.map((t) => t._id);
  } else {
    const trucks = await Truck.find({ isActive: { $ne: false } }).select('_id');
    truckIds = trucks.map((t) => t._id);
  }

  if (!truckIds.length) return success(res, 200, [], 'Pipeline cards retrieved');

  await provisionCards();

  const cards = await TruckPipelineCard.find({ truck: { $in: truckIds } })
    .populate(POPULATE)
    .sort({ stageEnteredAt: 1 });

  return success(res, 200, cards, 'Pipeline cards retrieved');
});

/**
 * Loads a card and confirms the caller is allowed to touch it. Dispatchers may
 * only act on cards for trucks assigned to them.
 */
async function loadOwnedCard(req, res) {
  const card = await TruckPipelineCard.findById(req.params.id).populate(POPULATE);
  if (!card) {
    error(res, 404, 'Card not found');
    return null;
  }
  if (!isAdmin(req.user)) {
    const owner = card.truck?.dispatcher?._id || card.truck?.dispatcher;
    if (String(owner || '') !== String(req.user._id)) {
      error(res, 403, 'This truck is assigned to another dispatcher');
      return null;
    }
  }
  return card;
}

const respond = async (res, card, message) => {
  await card.save();
  await card.populate(POPULATE);
  return success(res, 200, card, message);
};

/**
 * @route   PATCH /api/truck-pipeline/:id/location
 * @desc    Set where the truck is sitting empty. Only meaningful in the two
 *          stages that display it.
 * @access  Private (admin, dispatcher)
 */
export const updateLocation = asyncHandler(async (req, res) => {
  const card = await loadOwnedCard(req, res);
  if (!card) return undefined;

  const { zip, city, state } = req.body;
  if (zip !== undefined) card.location.zip = String(zip).trim();
  if (city !== undefined) card.location.city = String(city).trim();
  if (state !== undefined) card.location.state = String(state).trim().toUpperCase().slice(0, 2);

  return respond(res, card, 'Location updated');
});

/**
 * @route   PATCH /api/truck-pipeline/:id/load-details
 * @desc    Save the structured load details. Allowed before the card is booked
 *          (that is how the dispatcher fills them in) and after, so a rate or
 *          appointment correction does not require unwinding the stage.
 * @access  Private (admin, dispatcher)
 */
export const updateLoadDetails = asyncHandler(async (req, res) => {
  const card = await loadOwnedCard(req, res);
  if (!card) return undefined;

  if (card.currentStage === 'issue') {
    return error(res, 400, 'Resolve the issue before editing load details');
  }

  const { pickup, delivery, commodity, weight, deadhead, trip, rate } = req.body;

  if (pickup) {
    if (pickup.location !== undefined) card.loadDetails.pickup.location = String(pickup.location).trim();
    if (pickup.datetime !== undefined) card.loadDetails.pickup.datetime = pickup.datetime || null;
  }
  if (delivery) {
    if (delivery.location !== undefined) card.loadDetails.delivery.location = String(delivery.location).trim();
    if (delivery.datetime !== undefined) card.loadDetails.delivery.datetime = delivery.datetime || null;
  }
  if (commodity !== undefined) card.loadDetails.commodity = String(commodity).trim();
  if (weight !== undefined) card.loadDetails.weight = String(weight).trim();
  if (deadhead !== undefined) card.loadDetails.deadhead = String(deadhead).trim();
  if (trip !== undefined) card.loadDetails.trip = String(trip).trim();
  if (rate !== undefined) {
    const parsed = rate === '' || rate === null ? null : Number(rate);
    if (parsed !== null && Number.isNaN(parsed)) return error(res, 400, 'Rate must be a number');
    card.loadDetails.rate = parsed;
  }

  return respond(res, card, 'Load details saved');
});

/**
 * Books the load into the carrier's history. Runs exactly once per cycle — a
 * re-tick of "Load Booked" after an accidental untick reuses the record that is
 * already there rather than writing a duplicate.
 */
async function bookLoadHistory(card) {
  if (card.currentLoad) return card.currentLoad;

  const carrierId = card.carrier || card.truck?.carrier?._id || card.truck?.carrier;
  if (!carrierId) return null; // Truck has no carrier — nothing to write against.

  const carrierDoc = await Carrier.findById(carrierId);
  if (!carrierDoc) return null;

  const d = card.loadDetails;
  const load = await recordLoad({
    carrierDoc,
    dispatcher: card.truck?.dispatcher?._id || card.truck?.dispatcher || null,
    truck: card.truck?._id || card.truck,
    status: 'booked',
    details: {
      pickupLocation: d.pickup?.location,
      deliveryLocation: d.delivery?.location,
      pickupDate: d.pickup?.datetime,
      deliveryDate: d.delivery?.datetime,
      rate: d.rate ?? 0,
      commodity: d.commodity,
      weight: d.weight,
      deadhead: d.deadhead,
      trip: d.trip,
    },
  });

  return load?._id || null;
}

/**
 * @route   PATCH /api/truck-pipeline/:id/flag
 * @desc    Tick or untick one checkbox and apply whatever transition that
 *          implies. Body: { flag, value }.
 * @access  Private (admin, dispatcher)
 */
export const setFlag = asyncHandler(async (req, res) => {
  const card = await loadOwnedCard(req, res);
  if (!card) return undefined;

  const { flag } = req.body;
  const value = !!req.body.value;

  if (!STAGE_FLAGS.includes(flag)) return error(res, 400, 'Unknown checkbox');
  if (card.currentStage === 'issue') {
    return error(res, 400, 'Resolve the issue before moving this card');
  }

  // --- Intransit: the two completion checkboxes ------------------------
  if (COMPLETION_FLAGS.includes(flag)) {
    if (card.currentStage !== 'intransit') {
      return error(res, 400, 'That checkbox only applies while the load is in transit');
    }

    card.stageFlags[flag] = value;

    // Partial state is persisted as-is; only both together close the cycle.
    const done = COMPLETION_FLAGS.every((f) => card.stageFlags[f]);
    if (!done) return respond(res, card, value ? 'Checked' : 'Unchecked');

    // Cycle complete. The load survives in the carrier's history; what leaves
    // is the card's working copy, and the empty location resets to blank so the
    // dispatcher enters where the truck actually is now.
    clearLoad(card);
    card.location = { zip: '', city: '', state: '' };
    STAGE_FLAGS.forEach((f) => { card.stageFlags[f] = false; });
    card.cyclesCompleted += 1;
    card.lastCycleAt = new Date();
    enterStage(card, 'empty');

    return respond(res, card, 'Load closed out — truck is empty');
  }

  // --- The linear stages ------------------------------------------------
  const edge = TRANSITIONS[flag];

  if (value) {
    if (card.currentStage !== edge.from) {
      return error(res, 400, `That checkbox only applies in the ${edge.from.replace(/_/g, ' ')} stage`);
    }

    // Booking is the one transition with a precondition and a side effect.
    if (flag === 'loadBooked') {
      const missing = missingLoadFields(card.loadDetails);
      if (missing.length) {
        return res.status(400).json({
          success: false,
          message: 'Fill in the load details before marking this load booked',
          missingFields: missing,
        });
      }
      card.currentLoad = await bookLoadHistory(card);
    }

    card.stageFlags[flag] = true;
    enterStage(card, edge.to);
    return respond(res, card, 'Card moved');
  }

  // Unticking walks the same edge backwards — dispatchers misclick, and a
  // checkbox that cannot be undone would strand the card.
  if (card.currentStage !== edge.to) {
    return error(res, 400, 'That checkbox cannot be unchecked from this stage');
  }

  card.stageFlags[flag] = false;
  // Everything downstream of the flag being cleared is no longer true either.
  const from = STAGE_FLAGS.indexOf(flag);
  STAGE_FLAGS.slice(from).forEach((f) => { card.stageFlags[f] = false; });
  enterStage(card, edge.from);

  return respond(res, card, 'Card moved back');
});

/**
 * @route   POST /api/truck-pipeline/:id/issue
 * @desc    Flag a problem from any stage, or update the note on an open one.
 *          Body: { note }.
 * @access  Private (admin, dispatcher)
 */
export const raiseIssue = asyncHandler(async (req, res) => {
  const card = await loadOwnedCard(req, res);
  if (!card) return undefined;

  const note = String(req.body.note || '').trim();
  const wasOpen = card.issue.active;

  if (!card.issue.active) {
    card.preIssueStage = card.currentStage;
    card.issue.active = true;
    card.issue.history.push({
      note,
      raisedFromStage: card.currentStage,
      raisedAt: new Date(),
      raisedBy: req.user?._id || null,
      raisedByName: req.user?.name || '',
    });
    enterStage(card, 'issue');
  } else {
    // Editing the note on an issue that is already open.
    const open = card.issue.history[card.issue.history.length - 1];
    if (open && !open.resolvedAt) open.note = note;
  }

  card.issue.note = note;
  return respond(res, card, wasOpen ? 'Issue note updated' : 'Issue raised');
});

/**
 * @route   POST /api/truck-pipeline/:id/resolve-issue
 * @desc    Close the issue and send the card to an explicitly chosen stage.
 *          Body: { stage }.
 * @access  Private (admin, dispatcher)
 */
export const resolveIssue = asyncHandler(async (req, res) => {
  const card = await loadOwnedCard(req, res);
  if (!card) return undefined;

  if (card.currentStage !== 'issue') return error(res, 400, 'This card has no open issue');

  const { stage } = req.body;
  // Deliberately no fallback to preIssueStage: the dispatcher picks, always.
  if (!RESOLVABLE_STAGES.includes(stage)) {
    return error(res, 400, `Pick a stage to return this truck to: ${RESOLVABLE_STAGES.join(', ')}`);
  }

  // A stage that renders load details cannot be entered without them.
  if (STAGES_REQUIRING_LOAD.includes(stage)) {
    const missing = missingLoadFields(card.loadDetails);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Load details are incomplete — this truck cannot return to ${stage.replace(/_/g, ' ')}`,
        missingFields: missing,
      });
    }
  }

  const open = card.issue.history[card.issue.history.length - 1];
  if (open && !open.resolvedAt) {
    // The note is kept on the history entry, not discarded — problem carriers
    // are only spottable if the record survives the fix.
    open.resolvedAt = new Date();
    open.resolvedToStage = stage;
  }

  card.issue.active = false;
  card.issue.note = '';
  card.preIssueStage = null;

  // Re-derive the checkboxes so they agree with wherever the card landed.
  const flags = flagsForStage(stage);
  STAGE_FLAGS.forEach((f) => { card.stageFlags[f] = flags[f]; });
  if (stage === 'empty') clearLoad(card);

  enterStage(card, stage);
  return respond(res, card, 'Issue resolved');
});

/**
 * @route   POST /api/truck-pipeline/add-from-dispatch
 * @desc    Add trucks to the Trucks Management board in the Empty stage.
 *          Called from the Carrier Detail Modal when dispatcher selects which trucks to add.
 * @access  Private/Admin
 */
export const addFromDispatch = asyncHandler(async (req, res) => {
  const { carrierId, truckIds = [] } = req.body;

  if (!carrierId || !Array.isArray(truckIds) || truckIds.length === 0) {
    return error(res, 400, 'carrierId and truckIds array are required');
  }

  // Fetch trucks to get their data for card creation
  const trucks = await Truck.find({ _id: { $in: truckIds }, carrier: carrierId }).select(
    '_id carrier emptyZip emptyCity emptyState'
  );

  if (trucks.length === 0) {
    return error(res, 404, 'No valid trucks found for this carrier');
  }

  // Create or update cards for each truck
  const created = [];
  for (const truck of trucks) {
    try {
      // Try to find existing card
      let card = await TruckPipelineCard.findOne({ truck: truck._id });

      if (!card) {
        // Create new card in Empty stage
        card = await TruckPipelineCard.create({
          truck: truck._id,
          carrier: truck.carrier,
          currentStage: 'empty',
          location: {
            zip: truck.emptyZip || '',
            city: truck.emptyCity || '',
            state: truck.emptyState || '',
          },
        });
        created.push(card);
      } else if (card.currentStage !== 'empty') {
        // Move existing card to Empty stage
        card.currentStage = 'empty';
        card.stageEnteredAt = new Date();
        clearLoad(card);
        const flags = flagsForStage('empty');
        STAGE_FLAGS.forEach((f) => { card.stageFlags[f] = flags[f]; });
        await card.save();
        created.push(card);
      }
      // If already in Empty stage, skip (already on board)
    } catch (err) {
      // Duplicate key error (card already exists) is harmless — the truck is already on the board
      if (err?.code !== 11000) throw err;
    }
  }

  await TruckPipelineCard.populate(created, POPULATE);
  return success(res, 200, created, `Added ${created.length} truck(s) to the board`);
});

export default {
  getPipelineCards,
  updateLocation,
  updateLoadDetails,
  setFlag,
  raiseIssue,
  resolveIssue,
  addFromDispatch,
  shouldAutoAddReadyDispatchTruck,
  autoAddReadyDispatchTruckIfNeeded,
};
