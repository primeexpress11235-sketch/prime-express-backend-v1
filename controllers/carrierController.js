import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import Carrier, { PIPELINE_STAGES, FOLLOW_UP_STAGES, normalizeStage } from '../models/Carrier.js';
import User from '../models/User.js';
import Load from '../models/Load.js';
import Truck, { EQUIPMENT_TYPES } from '../models/Truck.js';
import TruckPipelineCard from '../models/TruckPipelineCard.js';
import Notification from '../models/Notification.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';
import { autoAddReadyDispatchTruckIfNeeded } from './truckPipelineController.js';
import cloudinary from '../config/cloudinary.js';
import {
  uploadDocToCloudinary,
  deleteDocFromCloudinary,
  streamDocDownload,
} from '../services/cloudinaryDocService.js';

const DISPATCH_POPULATE = [
  { path: 'assignedSalesAgent', select: 'name email role isActive' },
];

// Escapes user input before using it in a RegExp so search text like "a+b" is
// treated literally.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const uploadFilesWithConcurrency = async (files, uploadFn, concurrency = 3) => {
  if (!Array.isArray(files) || files.length === 0) return [];

  const results = new Array(files.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (index < files.length) {
      const currentIndex = index++;
      const file = files[currentIndex];

      try {
        const value = await uploadFn(file, currentIndex);
        results[currentIndex] = { status: 'fulfilled', value };
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error };
        console.error('Carrier document upload failed:', error);
      } finally {
        if (file && file.buffer) {
          file.buffer = Buffer.alloc(0);
        }
      }
    }
  });

  await Promise.all(workers);
  return results.filter(Boolean);
};

/**
 * Applies the timestamp/flag side effects a stage entry implies, so the
 * pipeline cards always have the data they render without the admin having to
 * fill anything in manually. Mutates the carrier document; the caller saves.
 */
function applyStageEntryEffects(carrier, stage, now = new Date()) {
  carrier.pipelineStage = stage;
  carrier.stageHistory.push({ stage, enteredAt: now });

  if (stage === 'dispatcher_assigned') {
    // This stage is a carrier pipeline lifecycle marker; it is not a truck
    // operational dispatcher assignment and no longer stores a separate timestamp.
  }
  if (stage === 'contacted') {
    // Entering the stage *is* the contact event.
    carrier.lastContactAt = now;
  }
  // `documentsReceived` is deliberately NOT touched here — it reflects what a
  // dispatcher actually verified, so only an explicit edit may set or clear it.
  if (!FOLLOW_UP_STAGES.includes(stage)) {
    // Only meaningful while the carrier is still being worked; a pending
    // follow-up carries over from Contacted into Qualification.
    carrier.needsFollowUp = false;
  }
}

/**
 * Manual selection only: trucks are added to the board only when a dispatcher
 * explicitly chooses them. No automatic provisioning happens here.
 */

/**
 * Per-carrier load rollups (count + most recent load date) for the given ids.
 * Returned as a Map so callers can attach them without an N+1 query.
 */
async function loadStatsFor(carrierIds) {
  if (carrierIds.length === 0) return new Map();

  const rows = await Load.aggregate([
    { $match: { carrier: { $in: carrierIds } } },
    {
      $group: {
        _id: '$carrier',
        loadsBooked: { $sum: 1 },
        lastLoadAt: { $max: { $ifNull: ['$pickupDate', '$createdAt'] } },
      },
    },
  ]);

  return new Map(rows.map((r) => [String(r._id), { loadsBooked: r.loadsBooked, lastLoadAt: r.lastLoadAt }]));
}

// Merges load rollups onto a plain carrier object for the client.
const withLoadStats = (carrier, stats) => ({
  ...(carrier.toObject ? carrier.toObject() : carrier),
  loadsBooked: stats?.loadsBooked || 0,
  lastLoadAt: stats?.lastLoadAt || null,
});

/**
 * @route   GET /api/carriers
 * @desc    List carriers, filterable by truckType and pipelineStage, plus a
 *          free-text search across company/contact/MC/truck type.
 * @access  Private/Admin
 */
export const getCarriers = asyncHandler(async (req, res) => {
  const { truckType, pipelineStage, search, assignedSalesAgent } = req.query;

  const query = {};
  if (truckType) query.truckType = truckType;
  if (pipelineStage) query.pipelineStage = normalizeStage(pipelineStage);
  
  if (req.user?.role === 'sales_agent') {
    query.assignedSalesAgent = req.user._id;
  } else if (req.user?.role === 'dispatcher') {
    const assignedTruckCarriers = await Truck.find({ dispatcher: req.user._id, isActive: { $ne: false } }).distinct('carrier');
    query.$or = [
      { _id: { $in: assignedTruckCarriers } },
      { pipelineStage: { $in: ['ready_for_dispatch', 'active_carrier'] } },
    ];
  } else if (assignedSalesAgent) {
    query.assignedSalesAgent = assignedSalesAgent;
  }

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    const searchOr = [
      { companyName: re },
      { contactName: re },
      { mcNumber: re },
      { dotNumber: re },
      { contactEmail: re },
      { truckType: re },
    ];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }

  const carriers = await Carrier.find(query)
    .populate(DISPATCH_POPULATE)
    .sort('-createdAt');

  // Active Carrier cards show loads booked / last load, so roll those up here
  // rather than making the board fetch loads per card.
  const stats = await loadStatsFor(carriers.map((c) => c._id));

  return success(
    res,
    200,
    carriers.map((c) => withLoadStats(c, stats.get(String(c._id)))),
    'Carriers retrieved'
  );
});

/**
 * @route   GET /api/carriers/:id
 * @desc    Get a single carrier
 * @access  Private/Admin
 */
export const getCarrier = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id).populate(DISPATCH_POPULATE);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const stats = await loadStatsFor([carrier._id]);
  return success(res, 200, withLoadStats(carrier, stats.get(String(carrier._id))), 'Carrier retrieved');
});

// Rejects a create/update that would duplicate an existing MC or DOT number.
async function findDuplicateAuthority({ mcNumber, dotNumber, excludeId }) {
  const clauses = [];
  if (mcNumber) clauses.push({ mcNumber });
  if (dotNumber) clauses.push({ dotNumber });
  if (clauses.length === 0) return null;

  const q = { $or: clauses };
  if (excludeId) q._id = { $ne: excludeId };
  return Carrier.findOne(q);
}

async function syncSalesAgentMetricsForIds(...ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  for (const userId of uniqueIds) {
    const carrierIds = await Carrier.find({ assignedSalesAgent: userId }).select('_id');
    const carrierIdList = carrierIds.map((carrier) => carrier._id);

    const [leadsSubmittedCount, activeCarrierCount] = await Promise.all([
      Carrier.countDocuments({ assignedSalesAgent: userId }),
      carrierIdList.length
        ? Load.distinct('carrier', {
            carrier: { $in: carrierIdList },
            status: 'booked',
          }).then((idsForLoads) => idsForLoads.length)
        : Promise.resolve(0),
    ]);

    await User.findByIdAndUpdate(userId, {
      leadsSubmittedCount,
      activeCarrierCount,
    });
  }
}

// Shared helper to validate and persist individual Truck records for a carrier
async function processCarrierTrucks(carrier, trucksList, res) {
  if (!Array.isArray(trucksList) || trucksList.length === 0) return true;

  // Validate maxLoadCapacity for all submitted trucks before creation
  for (let i = 0; i < trucksList.length; i++) {
    const item = trucksList[i];
    const eqType = item.type || item.equipmentType || 'Dry Van';

    const isPowerOnly = String(eqType).trim().toLowerCase() === 'power only';
    const cap = item.maxLoadCapacity !== undefined && item.maxLoadCapacity !== null && item.maxLoadCapacity !== ''
      ? Number(item.maxLoadCapacity)
      : (item.maxPayloadCapacity ? Number(item.maxPayloadCapacity) : null);

    if (isPowerOnly) {
      if (cap !== null && cap > 0) {
        if (res) error(res, 400, `Power Only trucks cannot have a Max Load Capacity declared (Truck #${i + 1}).`);
        return false;
      }
    } else {
      if (cap === null || Number.isNaN(cap) || cap <= 0) {
        if (res) error(res, 400, `Max Load Capacity (lbs) is required and must be a positive number for Truck #${i + 1} (${eqType}).`);
        return false;
      }
    }
  }

  for (let i = 0; i < trucksList.length; i++) {
    const item = trucksList[i];
    const eqType = item.type || item.equipmentType || 'Dry Van';
    const isPowerOnly = String(eqType).trim().toLowerCase() === 'power only';

    // Lowboy / RGN neckType handling
    let neckTypeVal = item.neckType || null;
    if (String(eqType).toLowerCase() === 'lowboy') {
      neckTypeVal = 'fixed';
    } else if (String(eqType).toLowerCase() === 'rgn') {
      neckTypeVal = 'removable';
    }

    const capVal = isPowerOnly
      ? null
      : (item.maxLoadCapacity !== undefined && item.maxLoadCapacity !== null && item.maxLoadCapacity !== ''
          ? Number(item.maxLoadCapacity)
          : (item.maxPayloadCapacity ? Number(item.maxPayloadCapacity) : null));

    await Truck.create({
      carrier: carrier._id,
      carrierName: carrier.companyName,
      truckNumber: i + 1,
      equipmentType: eqType,
      driverName: item.driverName || '',
      driverPhone: item.driverPhone || '',
      status: 'empty',
      maxLoadCapacity: capVal,
      neckType: neckTypeVal,
      doorType: item.doorType || null,
      liftGate: item.liftGate || null,
      trailerLength: item.trailerLength || item.length || null,
      stepDeckSubType: item.stepDeckSubType || item.subType || null,
      trailerConfig: item.trailerConfig || null,
      trailerSize: item.trailerSize || null,
      cargoType: item.cargoType || null,
    });
  }
  return true;
}

/**
 * @route   POST /api/carriers
 * @desc    Create a carrier (Admin or Sales Agent)
 * @access  Private/Admin
 */
export const createCarrier = asyncHandler(async (req, res) => {
  const {
    companyName, mcNumber, dotNumber, truckType, contactName, contactPhone,
    contactEmail, insuranceInfo, pipelineStage, assignedSalesAgent,
    notes, authorityStartDate, numberOfTrucks, trucks: rawTrucks,
  } = req.body;

  if (typeof companyName !== 'string' || !companyName.trim()) {
    return error(res, 400, 'Company name is required');
  }

  const dup = await findDuplicateAuthority({ mcNumber, dotNumber });
  if (dup) {
    return error(res, 409, 'A carrier with this MC or DOT number already exists');
  }

  let trucksList = [];
  if (rawTrucks) {
    try {
      trucksList = typeof rawTrucks === 'string' ? JSON.parse(rawTrucks) : rawTrucks;
    } catch (e) {
      console.warn('Failed to parse trucks field in createCarrier:', e);
    }
  }

  const summaryTypes = Array.isArray(trucksList) && trucksList.length > 0
    ? [...new Set(trucksList.map((t) => t.type || t.equipmentType || 'Dry Van'))].join(', ')
    : (truckType?.trim() || 'Dry Van');

  const calcNumTrucks = Array.isArray(trucksList) && trucksList.length > 0 ? trucksList.length : (Number(numberOfTrucks) || 0);

  const requested = normalizeStage(pipelineStage);
  const stage = PIPELINE_STAGES.includes(requested) ? requested : 'new_lead';

  // If created by a sales agent, automatically set assignedSalesAgent to submitting agent
  const finalSalesAgent = req.user?.role === 'sales_agent' ? req.user._id : (assignedSalesAgent || null);

  const carrier = await Carrier.create({
    companyName: companyName.trim(),
    mcNumber: mcNumber?.trim() || undefined,
    dotNumber: dotNumber?.trim() || undefined,
    truckType: summaryTypes,
    contactName,
    contactPhone,
    contactEmail,
    insuranceInfo,
    authorityStartDate: authorityStartDate || null,
    numberOfTrucks: calcNumTrucks,
    pipelineStage: stage,
    stageHistory: [{ stage, enteredAt: new Date() }],
    assignedSalesAgent: finalSalesAgent,
    notes,
  });

  const ok = await processCarrierTrucks(carrier, trucksList, res);
  if (!ok) return;

  await carrier.populate(DISPATCH_POPULATE);
  await syncSalesAgentMetricsForIds(carrier.assignedSalesAgent?._id || carrier.assignedSalesAgent);

  // Trigger 6th Admin Notification Category when Sales Agent submits a lead
  if (req.user?.role === 'sales_agent') {
    await createNotification({
      type: 'sales_agent_lead',
      title: 'Sales Agent submitted a Carrier lead',
      message: `${req.user.name || 'Sales Agent'} submitted lead: ${carrier.companyName} (${carrier.contactName || 'No contact'})`,
      referenceId: carrier._id,
      relatedModel: 'Carrier',
    });
  }

  return success(res, 201, carrier, 'Carrier created');
});

/**
 * @route   POST /api/carriers/public-setup
 * @desc    Public website carrier setup form submission
 * @access  Public
 */
export const publicCreateCarrier = asyncHandler(async (req, res) => {
  const {
    companyName,
    name,
    contactName,
    email,
    phone,
    truckType,
    authorityAge,
    mcNumber,
    dotNumber,
    trucks: rawTrucks,
    preferences: rawPreferences,
    onboardingDocumentFlags: rawDocumentFlags,
  } = req.body;

  if (!companyName || !companyName.trim()) {
    return error(res, 400, 'Company name is required');
  }
  const finalContactName = String(name || contactName || '').trim();
  const finalMcNumber = String(mcNumber || '').trim();
  const finalDotNumber = String(dotNumber || '').trim();
  const finalEmail = String(email || '').trim().toLowerCase();
  const finalPhone = String(phone || '').trim();
  if (!finalContactName || !finalMcNumber || !finalDotNumber || !finalEmail || !finalPhone) {
    return error(res, 400, 'Contact name, MC Number, DOT Number, email, and phone are required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
    return error(res, 400, 'Please provide a valid email address');
  }

  const files = Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
  const requiredDocumentFields = ['mcLetter', 'coi', 'w9'];
  const missingDocument = requiredDocumentFields.find((field) => !files.some((file) => file.fieldname === field && file.buffer?.length));
  if (missingDocument) {
    const labels = { mcLetter: 'MC Authority Letter', coi: 'COI', w9: 'W-9' };
    return error(res, 400, `${labels[missingDocument]} document is required`);
  }

  let trucksList = [];
  try {
    trucksList = typeof rawTrucks === 'string' ? JSON.parse(rawTrucks) : rawTrucks;
  } catch {
    return error(res, 400, 'Truck details must be valid JSON');
  }
  if (!Array.isArray(trucksList) || trucksList.length === 0 || trucksList.length > 10) {
    return error(res, 400, 'Provide between 1 and 10 trucks');
  }

  let preferences = {};
  try {
    preferences = rawPreferences
      ? (typeof rawPreferences === 'string' ? JSON.parse(rawPreferences) : rawPreferences)
      : {};
  } catch {
    return error(res, 400, 'Carrier preferences must be valid JSON');
  }
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return error(res, 400, 'Carrier preferences must be an object');
  }
  const preferenceOptions = {
    operationPreference: ['OTR', 'Regional', 'Both', 'Both, but OTR only for better-paying loads', ''],
    distancePreference: ['Under 200 miles', '200–300 miles', '300–500 miles', '500–750 miles', '750+ miles', 'Flexible', ''],
    lanePreference: ['Any Lane', 'Specific States', 'Specific Region', 'Custom', ''],
    schedulePreference: ['Daily Home', 'Mon–Fri', 'Mon–Sunday', 'Flexible', ''],
  };
  for (const [field, allowed] of Object.entries(preferenceOptions)) {
    if (preferences[field] !== undefined && !allowed.includes(preferences[field])) {
      return error(res, 400, `Invalid ${field}`);
    }
  }
  for (const field of ['minRatePerMile', 'lanePreferenceRegion', 'lanePreferenceCustom']) {
    if (preferences[field] !== undefined && typeof preferences[field] !== 'string') {
      return error(res, 400, `${field} must be a string`);
    }
  }
  if (preferences.lanePreferenceStates !== undefined && !Array.isArray(preferences.lanePreferenceStates)) {
    return error(res, 400, 'lanePreferenceStates must be an array');
  }
  if (Array.isArray(preferences.lanePreferenceStates) && preferences.lanePreferenceStates.some((state) => typeof state !== 'string')) {
    return error(res, 400, 'lanePreferenceStates must contain only strings');
  }
  if (preferences.minRatePerMileCustom !== undefined && preferences.minRatePerMileCustom !== null
      && (!Number.isFinite(Number(preferences.minRatePerMileCustom)) || Number(preferences.minRatePerMileCustom) <= 0)) {
    return error(res, 400, 'Custom minimum rate per mile must be a positive number');
  }

  let requestedDocumentFlags = {};
  try {
    requestedDocumentFlags = rawDocumentFlags
      ? (typeof rawDocumentFlags === 'string' ? JSON.parse(rawDocumentFlags) : rawDocumentFlags)
      : {};
  } catch {
    return error(res, 400, 'Document-received flags must be valid JSON');
  }
  if (!requestedDocumentFlags || typeof requestedDocumentFlags !== 'object' || Array.isArray(requestedDocumentFlags)) {
    return error(res, 400, 'Document-received flags must be an object');
  }
  for (const flag of ['mcLetter', 'coi', 'w9', 'noa']) {
    if (requestedDocumentFlags[flag] !== undefined && typeof requestedDocumentFlags[flag] !== 'boolean') {
      return error(res, 400, `Document flag ${flag} must be a boolean`);
    }
  }

  const duplicate = await findDuplicateAuthority({ mcNumber: finalMcNumber, dotNumber: finalDotNumber });
  if (duplicate) return error(res, 409, 'A carrier with this MC or DOT number already exists');

  for (let index = 0; index < trucksList.length; index++) {
    const item = trucksList[index] || {};
    const equipmentType = String(item.type || item.equipmentType || 'Dry Van').trim();
    if (!EQUIPMENT_TYPES.includes(equipmentType)) {
      return error(res, 400, `Invalid equipment type for Truck #${index + 1}`);
    }
    const isPowerOnly = equipmentType.toLowerCase() === 'power only';
    const rawCapacity = item.maxLoadCapacity !== undefined && item.maxLoadCapacity !== null && item.maxLoadCapacity !== ''
      ? item.maxLoadCapacity
      : (item.maxPayloadCapacity || null);
    const capacity = rawCapacity === null ? null : Number(rawCapacity);
    if (isPowerOnly && capacity !== null && capacity > 0) {
      return error(res, 400, `Power Only trucks cannot have a Max Load Capacity declared (Truck #${index + 1}).`);
    }
    if (!isPowerOnly && (capacity === null || !Number.isFinite(capacity) || capacity <= 0)) {
      return error(res, 400, `Max Load Capacity (lbs) is required and must be a positive number for Truck #${index + 1} (${equipmentType}).`);
    }
    const neckType = equipmentType.toLowerCase() === 'lowboy' ? 'fixed'
      : equipmentType.toLowerCase() === 'rgn' ? 'removable'
        : (item.neckType || null);
    const validationTruck = new Truck({
      truckNumber: index + 1,
      equipmentType,
      status: 'empty',
      maxLoadCapacity: isPowerOnly ? null : capacity,
      neckType,
      doorType: item.doorType || null,
      liftGate: item.liftGate || null,
      trailerLength: item.trailerLength || item.length || null,
      stepDeckSubType: item.stepDeckSubType || item.subType || null,
      trailerConfig: item.trailerConfig || null,
      trailerSize: item.trailerSize || null,
      cargoType: item.cargoType || null,
    });
    try {
      await validationTruck.validate();
    } catch (validationError) {
      return error(res, 400, `Invalid Truck #${index + 1}: ${validationError.message}`);
    }
  }

  const summaryTypes = Array.isArray(trucksList) && trucksList.length > 0
    ? [...new Set(trucksList.map((t) => t.type || t.equipmentType || 'Dry Van'))].join(', ')
    : (truckType?.trim() || 'Dry Van');

  const numberOfTrucks = trucksList.length;
  const documentFlags = {
    ...requestedDocumentFlags,
    mcLetter: files.some((file) => file.fieldname === 'mcLetter') || requestedDocumentFlags.mcLetter === true,
    coi: files.some((file) => file.fieldname === 'coi') || requestedDocumentFlags.coi === true,
    w9: files.some((file) => file.fieldname === 'w9') || requestedDocumentFlags.w9 === true,
    noa: files.some((file) => file.fieldname === 'factoringNoa') || requestedDocumentFlags.noa === true,
  };

  const carrier = await Carrier.create({
    companyName: companyName.trim(),
    contactName: finalContactName,
    contactEmail: finalEmail,
    contactPhone: finalPhone,
    truckType: summaryTypes,
    numberOfTrucks,
    mcNumber: finalMcNumber,
    dotNumber: finalDotNumber,
    pipelineStage: 'new_lead',
    stageHistory: [{ stage: 'new_lead', enteredAt: new Date() }],
    notes: authorityAge ? `Authority Age: ${authorityAge}` : '',
    documents: [],
    preferences,
    onboardingDocumentFlags: documentFlags,
  });

  try {
    const ok = await processCarrierTrucks(carrier, trucksList, res);
    if (!ok) {
      await Truck.deleteMany({ carrier: carrier._id });
      await Carrier.deleteOne({ _id: carrier._id });
      return;
    }
  } catch (writeError) {
    await Truck.deleteMany({ carrier: carrier._id }).catch(() => {});
    await Carrier.deleteOne({ _id: carrier._id }).catch(() => {});
    throw writeError;
  }

  // Handle uploaded files if any (e.g., mcLetter, coi, w9, factoringNoa)
  if (files.length) {
    const settled = await uploadFilesWithConcurrency(files, async (file) => {
      if (!file || !file.buffer) return null;

      const docType = file.fieldname === 'mcLetter'
        ? 'mc_authority'
        : file.fieldname === 'coi'
          ? 'insurance'
          : file.fieldname === 'w9'
            ? 'w9'
            : 'other';

      const uploaded = await uploadDocToCloudinary(file.buffer, file.originalname, 'dkr/carrier-documents');

      carrier.documents.push({
        originalFileName: uploaded.originalFileName,
        cloudinaryUrl: uploaded.cloudinaryUrl,
        cloudinaryPublicId: uploaded.cloudinaryPublicId,
        resourceType: uploaded.resourceType,
        type: docType,
        mimeType: uploaded.fileType,
        uploadedAt: new Date(),
      });

      return uploaded;
    });

    const successfullyUploadedFields = new Set(settled.flatMap((entry, index) => (
      entry?.status === 'fulfilled' && entry.value ? [files[index]?.fieldname] : []
    )));
    carrier.onboardingDocumentFlags = {
      ...carrier.onboardingDocumentFlags?.toObject?.() || carrier.onboardingDocumentFlags || {},
      mcLetter: successfullyUploadedFields.has('mcLetter'),
      coi: successfullyUploadedFields.has('coi'),
      w9: successfullyUploadedFields.has('w9'),
      noa: successfullyUploadedFields.has('factoringNoa'),
    };

    const uploadedDocs = settled
      .filter((entry) => entry?.status === 'fulfilled' && entry.value)
      .map((entry) => entry.value);

    if (carrier.documents.length > 0 || uploadedDocs.length > 0) {
      await carrier.save();
    }
  }

  // Trigger admin notification for new carrier setup request
  await createNotification({
    type: 'carrier_setup',
    title: 'New Carrier Setup Request',
    message: `${carrier.companyName} (${carrier.contactName || 'No contact'}) - ${carrier.truckType || 'N/A'} (${numberOfTrucks} truck${numberOfTrucks === 1 ? '' : 's'})`,
    referenceId: carrier._id,
    relatedModel: 'Carrier',
  });

  return success(res, 201, carrier, 'Carrier setup packet received');
});

/**
 * @route   PATCH /api/carriers/:id
 * @desc    Update a carrier. A pipelineStage change appends to stageHistory.
 * @access  Private/Admin
 */
export const updateCarrier = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const previousAssignedSalesAgent = carrier.assignedSalesAgent ? String(carrier.assignedSalesAgent) : null;

  const {
    companyName, mcNumber, dotNumber, truckType, contactName, contactPhone,
    contactEmail, insuranceInfo, pipelineStage, assignedSalesAgent,
    notes, authorityStartDate, numberOfTrucks, lastContactAt,
    needsFollowUp, documentsReceived, preferences, onboardingDocumentFlags,
    inactiveReason, qualificationNote,
  } = req.body;

  // Guard against MC/DOT collisions with a different carrier.
  if (mcNumber !== undefined || dotNumber !== undefined) {
    const dup = await findDuplicateAuthority({
      mcNumber: mcNumber ?? carrier.mcNumber,
      dotNumber: dotNumber ?? carrier.dotNumber,
      excludeId: carrier._id,
    });
    if (dup) return error(res, 409, 'A carrier with this MC or DOT number already exists');
  }

  if (companyName !== undefined) carrier.companyName = companyName;
  if (mcNumber !== undefined) carrier.mcNumber = mcNumber?.trim() || undefined;
  if (dotNumber !== undefined) carrier.dotNumber = dotNumber?.trim() || undefined;
  if (truckType !== undefined) carrier.truckType = truckType;
  if (contactName !== undefined) carrier.contactName = contactName;
  if (contactPhone !== undefined) carrier.contactPhone = contactPhone;
  if (contactEmail !== undefined) carrier.contactEmail = contactEmail;
  if (insuranceInfo !== undefined) carrier.insuranceInfo = insuranceInfo;
  if (notes !== undefined) carrier.notes = notes;
  if (assignedSalesAgent !== undefined) carrier.assignedSalesAgent = assignedSalesAgent || null;
  if (authorityStartDate !== undefined) carrier.authorityStartDate = authorityStartDate || null;
  if (numberOfTrucks !== undefined) carrier.numberOfTrucks = Number(numberOfTrucks) || 0;
  if (lastContactAt !== undefined) carrier.lastContactAt = lastContactAt || null;
  if (needsFollowUp !== undefined) carrier.needsFollowUp = !!needsFollowUp;
  if (documentsReceived !== undefined) carrier.documentsReceived = !!documentsReceived;
  if (preferences !== undefined) carrier.preferences = preferences;
  if (onboardingDocumentFlags !== undefined) carrier.onboardingDocumentFlags = onboardingDocumentFlags;
  if (qualificationNote !== undefined) carrier.qualificationNote = qualificationNote;
  if (inactiveReason !== undefined) carrier.inactiveReason = inactiveReason;

  // Record a stage transition so days-in-stage and the stage-specific card
  // fields stay accurate.
  const oldStage = carrier.pipelineStage;
  const nextStage = pipelineStage === undefined ? undefined : normalizeStage(pipelineStage);
  
  if (nextStage !== undefined && nextStage !== carrier.pipelineStage) {
    if (!PIPELINE_STAGES.includes(nextStage)) {
      return error(res, 400, 'Invalid pipeline stage');
    }
    applyStageEntryEffects(carrier, nextStage);
    // An explicit needsFollowUp in the same request wins over the reset above.
    if (needsFollowUp !== undefined) carrier.needsFollowUp = !!needsFollowUp;
  }

  await carrier.save();

  if (nextStage === 'ready_for_dispatch') {
    await autoAddReadyDispatchTruckIfNeeded(carrier);
  }

  await carrier.populate(DISPATCH_POPULATE);
  await syncSalesAgentMetricsForIds(previousAssignedSalesAgent, carrier.assignedSalesAgent?._id || carrier.assignedSalesAgent);

  const stats = await loadStatsFor([carrier._id]);
  return success(res, 200, withLoadStats(carrier, stats.get(String(carrier._id))), 'Carrier updated');
});

/**
 * @route   POST /api/carriers/:id/documents
 * @desc    Upload a document (rate confirmation, BOL, insurance, etc.)
 * @access  Private/Admin
 */
export const addCarrierDocument = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');
  if (!req.file) return error(res, 400, 'No file uploaded');

  const uploaded = await uploadDocToCloudinary(req.file.buffer, req.file.originalname, 'dkr/carrier-documents');

  carrier.documents.push({
    originalFileName: uploaded.originalFileName,
    cloudinaryUrl: uploaded.cloudinaryUrl,
    cloudinaryPublicId: uploaded.cloudinaryPublicId,
    resourceType: uploaded.resourceType,
    type: req.body.type || 'other',
    mimeType: uploaded.fileType,
    uploadedAt: new Date(),
  });
  await carrier.save();

  return success(res, 201, carrier.documents, 'Document uploaded');
});

/**
 * Permanently removes the given carriers and cleans up everything that points
 * at them, so no page is left holding a dangling reference:
 *
 *  - Documents live embedded on the carrier, so they go with the record.
 *  - Loads are financial history and are KEPT. Their `carrier` ref is cleared
 *    and the company name is snapshotted onto `carrierName` (+ `carrierDeleted`)
 *    so load history still reads correctly.
 *  - Notifications deep-linking to the carrier are removed, since clicking one
 *    would open a detail view that no longer exists.
 *  - Dispatcher/sales-agent assignments live on the carrier itself, so they
 *    disappear with it; no User record needs touching.
 *
 * Returns the number of carriers actually deleted.
 */
async function purgeCarriers(carriers) {
  if (carriers.length === 0) return { deletedCount: 0, loadsRemoved: 0, trucksRemoved: 0, cardsRemoved: 0 };

  const ids = carriers.map((c) => c._id);
  const truckIds = await Truck.find({ carrier: { $in: ids } }).distinct('_id');

  // Delete all Cloudinary assets associated with these carriers
  for (const c of carriers) {
    if (c.documents && c.documents.length > 0) {
      await Promise.all(
        c.documents.map((doc) =>
          doc.cloudinaryPublicId
            ? deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType || 'raw')
            : Promise.resolve()
        )
      );
    }
  }

  const cardResult = await TruckPipelineCard.deleteMany({
    $or: [{ carrier: { $in: ids } }, { truck: { $in: truckIds } }],
  });

  const truckResult = await Truck.deleteMany({ carrier: { $in: ids } });
  const loadResult = await Load.deleteMany({ carrier: { $in: ids } });

  await Notification.deleteMany({
    $or: [
      { relatedModel: 'Carrier', relatedId: { $in: ids } },
      { relatedModel: 'Truck', relatedId: { $in: truckIds } },
    ],
  });

  const { deletedCount } = await Carrier.deleteMany({ _id: { $in: ids } });

  return {
    deletedCount,
    loadsRemoved: loadResult?.deletedCount || 0,
    trucksRemoved: truckResult?.deletedCount || 0,
    cardsRemoved: cardResult?.deletedCount || 0,
  };
}

/**
 * @route   DELETE /api/carriers/:id
 * @desc    Permanently delete a carrier (see purgeCarriers for what is cleaned
 *          up and what is deliberately retained).
 * @access  Private/Admin
 */
export const deleteCarrier = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const result = await purgeCarriers([carrier]);

  return success(res, 200, result, 'Carrier deleted');
});

/**
 * @route   POST /api/carriers/bulk-delete
 * @desc    Permanently delete many carriers in one request. Body: { ids: [] }
 * @access  Private/Admin
 */
export const bulkDeleteCarriers = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(res, 400, 'Provide an array of carrier ids to delete');
  }

  const validIds = [...new Set(ids.filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  if (validIds.length === 0) return error(res, 400, 'No valid carrier ids provided');

  const carriers = await Carrier.find({ _id: { $in: validIds } }).select('_id companyName');
  if (carriers.length === 0) return error(res, 404, 'No matching carriers found');

  const result = await purgeCarriers(carriers);

  return success(
    res,
    200,
    { ...result, requestedCount: validIds.length },
    `${result.deletedCount} carrier${result.deletedCount === 1 ? '' : 's'} deleted`
  );
});

/**
 * @route   GET /api/carriers/:id/documents
 * @desc    List carrier documents
 * @access  Private/Admin
 */
export const getCarrierDocuments = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');
  return success(res, 200, carrier.documents, 'Carrier documents retrieved');
});

/**
 * @route   DELETE /api/carriers/:id/documents/:documentId
 * @desc    Delete a carrier document
 * @access  Private/Admin
 */
export const deleteCarrierDocument = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const doc = carrier.documents.id(req.params.documentId);
  if (!doc) return error(res, 404, 'Document not found');

  if (doc.cloudinaryPublicId) {
    await deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType || 'raw');
  }

  carrier.documents.pull(req.params.documentId);
  await carrier.save();

  return success(res, 200, carrier.documents, 'Document deleted');
});

/**
 * @route   GET /api/carriers/:id/documents/:documentId/view
 * @desc    View carrier document inline
 * @access  Private/Admin
 */
export const viewCarrierDocument = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const doc = carrier.documents.id(req.params.documentId);
  const targetUrl = doc?.cloudinaryUrl || doc?.url;

  if (!doc || !targetUrl) return error(res, 404, 'Document not found');

  return res.redirect(targetUrl);
});

/**
 * @route   GET /api/carriers/:id/documents/:documentId/download
 * @desc    Download carrier document with original filename
 * @access  Private/Admin
 */
export const downloadCarrierDocument = asyncHandler(async (req, res) => {
  const carrier = await Carrier.findById(req.params.id);
  if (!carrier) return error(res, 404, 'Carrier not found');

  const doc = carrier.documents.id(req.params.documentId);
  const targetUrl = doc?.cloudinaryUrl || doc?.url;
  const fileName = doc?.originalFileName || doc?.label || 'carrier_document';

  if (!doc || !targetUrl) return error(res, 404, 'Document not found');

  return streamDocDownload(res, targetUrl, fileName);
});

export default {
  getCarriers,
  getCarrier,
  createCarrier,
  publicCreateCarrier,
  updateCarrier,
  addCarrierDocument,
  getCarrierDocuments,
  deleteCarrierDocument,
  viewCarrierDocument,
  downloadCarrierDocument,
  deleteCarrier,
  bulkDeleteCarriers,
};
