import asyncHandler from 'express-async-handler';
import Truck, {
  EQUIPMENT_TYPES,
  TRUCK_STATUSES,
  NEXT_ACTIONS,
  DEFAULT_ACTION_FOR_STATUS,
} from '../models/Truck.js';
import Carrier from '../models/Carrier.js';
import User from '../models/User.js';
import Load from '../models/Load.js';
import TruckPipelineCard from '../models/TruckPipelineCard.js';
import Notification from '../models/Notification.js';
import { createNotification } from '../utils/notificationHelper.js';
import { success, error } from '../utils/sendResponse.js';
import cloudinary from '../config/cloudinary.js';

const POPULATE = [
  { path: 'carrier', select: 'companyName mcNumber contactName contactPhone contactEmail' },
  { path: 'dispatcher', select: 'name email role' },
  { path: 'currentLoad', select: 'pickupLocation deliveryLocation pickupDate deliveryDate rate status' },
];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function resolveCarrierTruckUpdates(existingTrucks, incomingTrucks = []) {
  const byNumber = new Map(existingTrucks.map((truck) => [String(truck.truckNumber), truck]));
  const incomingNumbers = new Set();
  const updates = [];
  const toCreate = [];
  const toDelete = [];
  const updatedIds = [];

  for (const truckData of incomingTrucks) {
    const truckNumber = Number(truckData?.truckNumber);
    const driverName = String(truckData?.driverName || '').trim();
    if (!truckNumber || !driverName) continue;

    incomingNumbers.add(String(truckNumber));

    const existingTruck = byNumber.get(String(truckNumber));
    if (existingTruck) {
      updatedIds.push(String(existingTruck._id));
      updates.push({
        truckId: String(existingTruck._id),
        truckNumber,
        driverName,
        driverPhone: truckData.driverPhone || '',
        equipmentType: truckData.equipmentType || 'Dry Van',
        dispatcher: truckData.dispatcher || null,
      });
    } else {
      toCreate.push({
        truckNumber,
        driverName,
        driverPhone: truckData.driverPhone || '',
        equipmentType: truckData.equipmentType || 'Dry Van',
        dispatcher: truckData.dispatcher || null,
      });
    }
  }

  for (const truck of existingTrucks) {
    if (!incomingNumbers.has(String(truck.truckNumber))) {
      toDelete.push(String(truck._id));
    }
  }

  return { updates, toCreate, toDelete, updatedIds };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

/** Timeline entry attributed to the acting user (or an automation). */
const entry = (action, req, extra = {}) => ({
  action,
  by: req?.user?._id || null,
  byName: req?.user?.name || 'System',
  at: new Date(),
  ...extra,
});

/**
 * @route   GET /api/trucks
 * @desc    List fleet trucks. Filters stack: dispatcher, equipment, status,
 *          carrier, ZIP, state, empty-today / empty-tomorrow, plus free-text
 *          search across carrier, truck number, MC, ZIP, city and dispatcher.
 * @access  Private/Admin
 */
export const getTrucks = asyncHandler(async (req, res) => {
  const {
    dispatcher, equipmentType, status, carrier, emptyZip, emptyState,
    emptyToday, emptyTomorrow, search, includeInactive,
  } = req.query;

  const query = {};
  if (includeInactive !== 'true') query.isActive = { $ne: false };

  if (req.user?.role === 'dispatcher') {
    query.dispatcher = req.user._id;
    const readyCarriers = await Carrier.find({
      pipelineStage: { $in: ['ready_for_dispatch', 'active_carrier'] },
    }).select('_id');
    query.carrier = { $in: readyCarriers.map((c) => c._id) };
  } else if (dispatcher) {
    query.dispatcher = dispatcher;
  }

  if (equipmentType) query.equipmentType = equipmentType;
  if (status) query.status = status;
  if (carrier) query.carrier = carrier;
  if (emptyZip) query.emptyZip = emptyZip;
  if (emptyState) query.emptyState = String(emptyState).toUpperCase();

  if (emptyToday === 'true') {
    query.emptyAt = { $gte: startOfToday(), $lte: endOfToday() };
  } else if (emptyTomorrow === 'true') {
    query.emptyAt = { $gte: addDays(startOfToday(), 1), $lte: addDays(endOfToday(), 1) };
  }

  if (search && search.trim()) {
    const term = search.trim();
    const re = new RegExp(escapeRegex(term), 'i');

    // Carrier name and MC live on the Carrier record, and dispatcher name on
    // User, so resolve those to ids first rather than trying to $or across
    // collections.
    const [matchedCarriers, matchedDispatchers] = await Promise.all([
      Carrier.find({ $or: [{ companyName: re }, { mcNumber: re }] }).select('_id'),
      User.find({ name: re }).select('_id'),
    ]);

    const or = [{ emptyZip: re }, { emptyCity: re }, { carrierName: re }, { driverName: re }];
    if (matchedCarriers.length) or.push({ carrier: { $in: matchedCarriers.map((c) => c._id) } });
    if (matchedDispatchers.length) or.push({ dispatcher: { $in: matchedDispatchers.map((u) => u._id) } });

    // A bare number is also a truck number ("3" should find Truck #3).
    const asNumber = Number(term);
    if (!Number.isNaN(asNumber)) or.push({ truckNumber: asNumber });

    query.$or = or;
  }

  // Empty trucks first (they are the ones needing a load), oldest-empty first
  // within that, so the most urgent truck sits at the top of the board.
  const trucks = await Truck.find(query).populate(POPULATE).sort({ emptyAt: 1, truckNumber: 1 });

  return success(res, 200, trucks, 'Trucks retrieved');
});

/**
 * @route   GET /api/trucks/stats
 * @desc    Fleet metrics for admin oversight, optionally scoped to one
 *          dispatcher via ?dispatcher=:id
 * @access  Private/Admin
 */
export const getFleetStats = asyncHandler(async (req, res) => {
  const base = { isActive: { $ne: false } };
  if (req.query.dispatcher) base.dispatcher = req.query.dispatcher;

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [totalTrucks, searchingLoads, emptyTrucks, deliveringToday, withIssues, emptyOver24h, perDispatcherAgg] =
    await Promise.all([
      Truck.countDocuments(base),
      Truck.countDocuments({ ...base, status: 'searching_load' }),
      // "Empty" means the truck is available now: either flagged empty, or its
      // empty time has already passed.
      Truck.countDocuments({
        ...base,
        $or: [{ status: 'empty' }, { emptyAt: { $ne: null, $lte: now } }],
      }),
      Truck.countDocuments({ ...base, status: 'delivering' }),
      Truck.countDocuments({ ...base, status: 'issue' }),
      Truck.countDocuments({ ...base, emptyAt: { $ne: null, $lte: dayAgo }, status: { $ne: 'in_transit' } }),
      Truck.aggregate([
        { $match: base },
        {
          $group: {
            _id: '$dispatcher',
            trucks: { $sum: 1 },
            searching: { $sum: { $cond: [{ $eq: ['$status', 'searching_load'] }, 1, 0] } },
            issues: { $sum: { $cond: [{ $eq: ['$status', 'issue'] }, 1, 0] } },
          },
        },
        { $sort: { trucks: -1 } },
      ]),
    ]);

  const ids = perDispatcherAgg.map((r) => r._id).filter(Boolean);
  const users = await User.find({ _id: { $in: ids } }).select('name');
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));

  const perDispatcher = perDispatcherAgg.map((r) => ({
    dispatcherId: r._id,
    name: r._id ? nameById.get(String(r._id)) || 'Unknown' : 'Unassigned',
    trucks: r.trucks,
    searching: r.searching,
    issues: r.issues,
  }));

  return success(
    res,
    200,
    { totalTrucks, searchingLoads, emptyTrucks, deliveringToday, withIssues, emptyOver24h, perDispatcher },
    'Fleet stats retrieved'
  );
});

/**
 * @route   GET /api/trucks/:id
 * @desc    Full truck detail, including the carrier's load history.
 * @access  Private/Admin
 */
export const getTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id).populate(POPULATE);
  if (!truck) return error(res, 404, 'Truck not found');

  // Load history is per-carrier — Load has no truck reference of its own.
  const loadHistory = truck.carrier
    ? await Load.find({ carrier: truck.carrier._id || truck.carrier })
        .select('pickupLocation deliveryLocation pickupDate deliveryDate rate status')
        .sort('-pickupDate')
        .limit(25)
    : [];

  return success(res, 200, { ...truck.toObject(), loadHistory }, 'Truck retrieved');
});

// Shared write-path validation.
function validateEnums({ equipmentType, status, nextAction }) {
  if (equipmentType && !EQUIPMENT_TYPES.includes(equipmentType)) return 'Invalid equipment type';
  if (status && !TRUCK_STATUSES.includes(status)) return 'Invalid truck status';
  if (nextAction && !NEXT_ACTIONS.includes(nextAction)) return 'Invalid next action';
  return null;
}

/**
 * @route   POST /api/trucks
 * @access  Private/Admin
 */
export const createTruck = asyncHandler(async (req, res) => {
  const {
    carrier, truckNumber, equipmentType, driverName, driverPhone, dispatcher,
    status, nextAction, emptyZip, emptyCity, emptyState, emptyAt,
    pickupZip, pickupCity, pickupState, pickupAppointment,
    destinationZip, destinationCity, destinationState, eta, arrivedAt,
    preferredLanes, notes, maxLoadCapacity, trailerLength,
  } = req.body;

  if (!truckNumber) return error(res, 400, 'A truck number is required');

  const invalid = validateEnums({ equipmentType, status, nextAction });
  if (invalid) return error(res, 400, invalid);

  let carrierName;
  if (carrier) {
    const carrierDoc = await Carrier.findById(carrier).select('companyName');
    if (!carrierDoc) return error(res, 404, 'Carrier not found');
    carrierName = carrierDoc.companyName;
  }

  // Enforce the compound index with a friendly message rather than a raw
  // duplicate-key error.
  const duplicate = await Truck.findOne({ carrier: carrier || null, truckNumber: Number(truckNumber) });
  if (duplicate) return error(res, 409, `Truck #${truckNumber} already exists for this carrier`);

  const resolvedStatus = status || 'empty';

  const truck = await Truck.create({
    carrier: carrier || null,
    carrierName,
    truckNumber: Number(truckNumber),
    equipmentType: equipmentType || 'Dry Van',
    driverName,
    driverPhone,
    dispatcher: dispatcher || null,
    status: resolvedStatus,
    nextAction: nextAction || DEFAULT_ACTION_FOR_STATUS[resolvedStatus] || 'find_load',
    emptyZip,
    emptyCity,
    emptyState,
    emptyAt: emptyAt || null,
    pickupZip,
    pickupCity,
    pickupState,
    pickupAppointment: pickupAppointment || null,
    destinationZip,
    destinationCity,
    destinationState,
    eta: eta || null,
    arrivedAt: arrivedAt || null,
    preferredLanes,
    notes,
    maxLoadCapacity: maxLoadCapacity ?? null,
    trailerLength: trailerLength || null,
    createdBy: req.user?._id || null,
    timeline: [entry('created', req, { note: 'Truck added to fleet' })],
  });

  await truck.populate(POPULATE);
  return success(res, 201, truck, 'Truck created');
});

/**
 * @route   PATCH /api/trucks/:id
 * @desc    Update a truck. Status and next-action changes are recorded on the
 *          timeline so the detail panel can show who changed what.
 * @access  Private/Admin
 */
export const updateTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id);
  if (!truck) return error(res, 404, 'Truck not found');

  const {
    carrier, truckNumber, equipmentType, driverName, driverPhone, dispatcher,
    status, nextAction, emptyZip, emptyCity, emptyState, emptyAt,
    pickupZip, pickupCity, pickupState, pickupAppointment,
    destinationZip, destinationCity, destinationState, eta, arrivedAt,
    preferredLanes, notes, currentLoad, isActive, maxLoadCapacity, trailerLength,
  } = req.body;

  const invalid = validateEnums({ equipmentType, status, nextAction });
  if (invalid) return error(res, 400, invalid);

  if (carrier !== undefined) {
    if (carrier) {
      const carrierDoc = await Carrier.findById(carrier).select('companyName');
      if (!carrierDoc) return error(res, 404, 'Carrier not found');
      truck.carrier = carrierDoc._id;
      truck.carrierName = carrierDoc.companyName;
    } else {
      truck.carrier = null;
    }
  }

  if (truckNumber !== undefined) truck.truckNumber = Number(truckNumber);

  // Re-check uniqueness whenever the carrier/number pair moves.
  if (carrier !== undefined || truckNumber !== undefined) {
    const clash = await Truck.findOne({
      _id: { $ne: truck._id },
      carrier: truck.carrier || null,
      truckNumber: truck.truckNumber,
    });
    if (clash) return error(res, 409, `Truck #${truck.truckNumber} already exists for this carrier`);
  }

  if (equipmentType !== undefined) truck.equipmentType = equipmentType;
  if (driverName !== undefined) truck.driverName = driverName;
  if (driverPhone !== undefined) truck.driverPhone = driverPhone;
  if (dispatcher !== undefined) {
    const prevDispatcher = truck.dispatcher ? String(truck.dispatcher) : null;
    const nextDispatcher = dispatcher ? String(dispatcher) : null;
    truck.dispatcher = dispatcher || null;
    if (nextDispatcher && nextDispatcher !== prevDispatcher) {
      createNotification({
        recipientId: nextDispatcher,
        type: 'truck_assigned',
        title: 'Truck assigned to you',
        message: `Truck #${truck.truckNumber} (${truck.carrierName || 'Fleet'}) has been assigned to you by Admin.`,
        relatedModel: 'Truck',
        relatedId: truck._id,
      });
    }
  }
  if (pickupZip !== undefined) truck.pickupZip = pickupZip;
  if (pickupCity !== undefined) truck.pickupCity = pickupCity;
  if (pickupState !== undefined) truck.pickupState = pickupState;
  if (pickupAppointment !== undefined) truck.pickupAppointment = pickupAppointment || null;
  if (destinationZip !== undefined) truck.destinationZip = destinationZip;
  if (destinationCity !== undefined) truck.destinationCity = destinationCity;
  if (destinationState !== undefined) truck.destinationState = destinationState;
  if (eta !== undefined) truck.eta = eta || null;
  if (arrivedAt !== undefined) truck.arrivedAt = arrivedAt || null;
  if (preferredLanes !== undefined) truck.preferredLanes = preferredLanes;
  if (notes !== undefined) truck.notes = notes;
  if (maxLoadCapacity !== undefined) truck.maxLoadCapacity = maxLoadCapacity === '' ? null : maxLoadCapacity;
  if (trailerLength !== undefined) truck.trailerLength = trailerLength || null;
  if (currentLoad !== undefined) truck.currentLoad = currentLoad || null;
  if (isActive !== undefined) truck.isActive = !!isActive;

  // A change of empty location or time is worth recording — it is the field
  // dispatchers act on.
  const emptyChanged =
    (emptyZip !== undefined && emptyZip !== truck.emptyZip) ||
    (emptyAt !== undefined && String(emptyAt || '') !== String(truck.emptyAt || ''));
  if (emptyZip !== undefined) truck.emptyZip = emptyZip;
  if (emptyCity !== undefined) truck.emptyCity = emptyCity;
  if (emptyState !== undefined) truck.emptyState = emptyState;
  if (emptyAt !== undefined) truck.emptyAt = emptyAt || null;
  if (emptyChanged) {
    truck.timeline.push(entry('empty_updated', req, {
      note: [truck.emptyZip, truck.emptyCity].filter(Boolean).join(' · ') || 'Empty details updated',
    }));
  }

  if (status !== undefined && status !== truck.status) {
    const from = truck.status;
    truck.status = status;
    truck.timeline.push(entry('status_changed', req, { from, to: status }));

    // Keep the card's next action meaningful after a status move unless the
    // same request set one explicitly.
    if (nextAction === undefined) {
      truck.nextAction = DEFAULT_ACTION_FOR_STATUS[status] || truck.nextAction;
    }

    // Stamp the timestamp the new stage is read by. Dragging a card on the
    // Truck Operations Pipeline sends nothing but a status, so these have to
    // maintain themselves or every card would show a stale time. An explicit
    // value in the same request always wins, and nothing is ever cleared —
    // the rest of the truck's information is preserved as-is.
    const now = new Date();
    if (status === 'empty' && emptyAt === undefined) truck.emptyAt = now;
    if (status === 'delivering' && arrivedAt === undefined) truck.arrivedAt = now;
  }

  if (nextAction !== undefined && nextAction !== truck.nextAction) {
    const from = truck.nextAction;
    truck.nextAction = nextAction;
    truck.timeline.push(entry('action_changed', req, { from, to: nextAction }));
  }

  await truck.save();
  await truck.populate(POPULATE);
  return success(res, 200, truck, 'Truck updated');
});

/**
 * @route   POST /api/trucks/:id/documents
 * @access  Private/Admin
 */
export const addTruckDocument = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id);
  if (!truck) return error(res, 404, 'Truck not found');
  if (!req.file) return error(res, 400, 'No file uploaded');

  const uploadFromBuffer = (buffer, opts = {}) =>
    new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
      stream.end(buffer);
    });

  const result = await uploadFromBuffer(req.file.buffer, {
    folder: 'dkr/trucks',
    resource_type: 'auto',
  });
  const url = result?.secure_url || result?.url;
  if (!url) return error(res, 500, 'Failed to upload document');

  truck.documents.push({ label: req.body.label || req.file.originalname, url });
  truck.timeline.push(entry('document_added', req, { note: req.file.originalname }));
  await truck.save();

  return success(res, 201, truck.documents, 'Document uploaded');
});

/**
 * @route   DELETE /api/trucks/:id
 * @access  Private/Admin
 */
export const deleteTruck = asyncHandler(async (req, res) => {
  const truck = await Truck.findById(req.params.id);
  if (!truck) return error(res, 404, 'Truck not found');

  await TruckPipelineCard.deleteMany({ truck: truck._id });
  await Load.deleteMany({ truck: truck._id });
  await Notification.deleteMany({
    $or: [
      { relatedModel: 'Truck', relatedId: truck._id },
      { relatedModel: 'Load', relatedId: { $in: await Load.find({ truck: truck._id }).distinct('_id') } },
    ],
  });

  await truck.deleteOne();
  return success(res, 200, null, 'Truck deleted');
});

/**
 * @route   POST /api/trucks/carrier/:carrierId/manage
 * @desc    Create or update trucks for a carrier based on dynamic form submission.
 *          Receives array of truck objects with driver info and equipment type.
 * @access  Private/Admin
 */
export const manageCarrierTrucks = asyncHandler(async (req, res) => {
  const { carrierId } = req.params;
  const { trucks } = req.body;  // Array of { truckId?, truckNumber, driverName, driverPhone, equipmentType, dispatcher }

  if (!carrierId || !Array.isArray(trucks)) {
    return error(res, 400, 'carrierId and trucks array are required');
  }

  const carrier = await Carrier.findById(carrierId);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const existingTrucks = await Truck.find({ carrier: carrierId }).sort({ truckNumber: 1 });
  const { updates, toCreate, toDelete } = resolveCarrierTruckUpdates(existingTrucks, trucks);
  const savedTrucks = [];

  try {
    for (const update of updates) {
      const truck = await Truck.findById(update.truckId);
      if (!truck) continue;
      truck.truckNumber = update.truckNumber;
      truck.driverName = update.driverName;
      truck.driverPhone = update.driverPhone || '';
      truck.equipmentType = update.equipmentType || 'Dry Van';
      truck.dispatcher = update.dispatcher || null;
      await truck.save();
      savedTrucks.push(truck);
    }

    for (const truckData of toCreate) {
      const truck = new Truck({
        carrier: carrierId,
        carrierName: carrier.companyName,
        truckNumber: truckData.truckNumber,
        driverName: truckData.driverName,
        driverPhone: truckData.driverPhone || '',
        equipmentType: truckData.equipmentType || 'Dry Van',
        dispatcher: truckData.dispatcher || null,
        status: 'empty',
      });
      await truck.save();
      savedTrucks.push(truck);
    }

    if (toDelete.length > 0) {
      await Truck.deleteMany({ _id: { $in: toDelete } });
    }

    const finalTrucks = await Truck.find({ carrier: carrierId }).populate(POPULATE);

    return success(res, 200, finalTrucks, `Managed ${savedTrucks.length} truck(s) for carrier`);
  } catch (err) {
    return error(res, 500, `Error managing trucks: ${err.message}`);
  }
});

/**
 * @route   GET /api/trucks/carrier/:carrierId
 * @desc    Get all trucks for a specific carrier
 * @access  Private/Admin
 */
export const getCarrierTrucks = asyncHandler(async (req, res) => {
  const { carrierId } = req.params;

  const trucks = await Truck.find({ carrier: carrierId }).populate(POPULATE).sort({ truckNumber: 1 });
  return success(res, 200, trucks, 'Carrier trucks retrieved');
});

export default {
  getTrucks,
  getFleetStats,
  getTruck,
  createTruck,
  updateTruck,
  addTruckDocument,
  deleteTruck,
  manageCarrierTrucks,
  getCarrierTrucks,
};
