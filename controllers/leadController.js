import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import * as xlsx from 'xlsx';
import CarrierLead, { CARRIER_LEAD_STATUS_ENUM, MC_STATUS_ENUM } from '../models/CarrierLead.js';
import CarrierActivityLog from '../models/CarrierActivityLog.js';
import Carrier from '../models/Carrier.js';
import Truck, { EQUIPMENT_TYPES } from '../models/Truck.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { getEquipmentConfig } from '../config/equipmentTypesConfig.js';
import { uploadDocToCloudinary } from '../services/cloudinaryDocService.js';
import {
  aggregateCallCounts,
  getActiveCarrierEvents,
  getLeadSubmissionEvents,
  populateActivityLogs,
} from '../services/salesAgentPerformanceService.js';
import { createAdminNotification } from '../utils/adminNotificationHelper.js';
import { emitSocketEvent } from '../utils/chatSocketEmitter.js';
import { formatMc } from '../utils/formatMc.js';
import { selectUnseenLeadTrucks } from '../utils/leadTruckDedupe.js';
import { buildLeadFilter, getLeadPagination } from '../utils/leadQuery.js';
import {
  TIME_ZONE,
  calendarMonthBounds,
  dateBucket,
  dateBucketWindow,
  today,
} from '../utils/performanceDates.js';

const LEAD_LIST_PROJECTION = [
  'mcNumber dotNumber companyName phone email address city state zip powerUnits mcAge mcStatus currentStatus',
  'assignments detailsAdded isSubmitted convertedToCarrierId submittedAt submittedByAgentId quickMessageSentAt createdAt updatedAt',
].join(' ');

export const normalizeHeaderKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

export const resolveLeadRowValues = (row) => {
  const findValue = (...keys) => {
    const normalizedKeys = keys.map(normalizeHeaderKey);
    for (const key of Object.keys(row)) {
      if (normalizedKeys.includes(normalizeHeaderKey(key))) {
        return row[key] === null || row[key] === undefined ? '' : String(row[key]).trim();
      }
    }
    return '';
  };

  const mcNumber = findValue(
    'MC Number', 'MC', 'mcNumber', 'MC#', 'MC No', 'MC No.', 'MC_Number', 'MC_NO',
    'MC/FF Number', 'MC/FF', 'MC / FF Number', 'MC / FF', 'MC_FF_NUMBER', 'MC_MX_FF_NUMBER',
    'MC/MX/FF Number', 'MC/MX/FF', 'Motor Carrier Number', 'Operating Authority',
    'Operating Authority Number', 'Operating Authority #', 'Authority Number', 'Authority #',
    'Docket Number', 'Docket', 'Docket#', 'MC/DOT', 'MC/DOT#', 'USDOT/MC',
    'ICC/MC', 'ICC MC', 'ICC/MC#', 'ICC/MC Number', 'MC_NUM', 'Motor Carrier',
    'Motor Carrier #', 'Motor Carrier No'
  );
  const dotNumber = findValue(
    'DOT Number', 'DOT', 'dotNumber', 'DOT#', 'DOT No', 'DOT No.', 'USDOT',
    'USDOT Number', 'US DOT Number', 'US DOT', 'USDOT#', 'DOT_NUMBER', 'DOT_NO',
    'USDOT_ID', 'DOT ID'
  );
  const companyName = findValue(
    'Company Name', 'Company', 'companyName', 'Carrier Name', 'Carrier',
    'Legal Name', 'LEGAL_NAME', 'DBA Name', 'DBA_NAME', 'Business Name', 'Name'
  );
  const phone = findValue(
    'Phone', 'Phone Number', 'contactPhone', 'Telephone', 'Cell', 'TEL',
    'PHONE_NUMBER', 'TELEPHONE_NUMBER', 'Cell Phone', 'Mobile', 'Mobile Phone', 'Business Phone'
  );
  const email = findValue('Email', 'Email Address', 'contactEmail', 'EMAIL_ADDRESS', 'E-mail', 'E-Mail Address');
  const address = findValue('Address', 'Street Address', 'Location', 'PHY_STREET', 'PHYSICAL_STREET', 'Street', 'Physical Address');
  const city = findValue('City', 'PHY_CITY', 'PHYSICAL_CITY', 'Physical City');
  const state = findValue('State', 'ST', 'PHY_STATE', 'PHYSICAL_STATE', 'Physical State');
  const zip = findValue('Zip', 'Zip Code', 'Zipcode', 'Postal Code', 'PHY_ZIP', 'PHYSICAL_ZIP', 'Physical Zip', 'ZIP_CODE');
  const powerUnitsRaw = findValue(
    'No. of Power Units', 'No of Power Units', 'Number of Power Units', 'No. of PowerUnits', 'No of PowerUnits',
    'Power Units', 'Power Unit', 'powerUnits', 'powerUnit', 'POWER_UNITS', 'POWER_UNIT', 'POWER UNITS', 'POWER UNIT',
    'TOTAL_POWER_UNITS', 'TOTAL POWER UNITS', 'Total Power Units', 'Total Power Unit',
    'NBR_POWER_UNIT', 'NBR POWER UNIT', 'NBR_POWER_UNITS', 'NBR POWER UNITS',
    'PowerUnitCount', 'Power Units Count', 'Power Unit Count', 'Power Unit(s)', 'Power Units (PU)',
    'PU', 'PUs', 'Truck Count', 'Fleet Size', 'Fleet', 'Units', 'Total Units', 'Trucks', 'Total Trucks',
    'Tractors', 'Tractor Count', 'Equipment Count', 'Vehicles', 'Total Vehicles'
  );
  const mcAge = findValue('MC Age', 'Age', 'mcAge', 'Authority Age', 'AUTHORITY_AGE', 'Years Active', 'Years in Business');
  const mcStatusRaw = findValue('MC Status', 'mcStatus', 'Status', 'MC_STATUS', 'Authority Status');

  const parsedPowerUnits = (() => {
    if (powerUnitsRaw === null || powerUnitsRaw === undefined || powerUnitsRaw === '') return 0;
    const cleaned = String(powerUnitsRaw).replace(/,/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : Math.round(parsed);
  })();

  return {
    valid: Boolean(companyName || mcNumber || dotNumber),
    data: {
      companyName: companyName || `MC-${mcNumber || dotNumber}`,
      mcNumber,
      dotNumber,
      phone,
      email,
      address,
      city,
      state,
      zip,
      powerUnits: parsedPowerUnits,
      mcAge,
      mcStatus: deriveMcStatus(mcAge, mcStatusRaw),
      currentStatus: 'Untouched',
      assignments: [],
      detailsAdded: false,
      _powerUnitsProvided: powerUnitsRaw !== '',
    },
  };
};

export const buildLeadInsertDocument = (row) => {
  const { _powerUnitsProvided, ...lead } = row;
  return {
    ...lead,
    mcNumber: lead.mcNumber || undefined,
    dotNumber: lead.dotNumber || undefined,
    mcNumberDigits: String(lead.mcNumber || '').replace(/\D/g, ''),
    dotNumberDigits: String(lead.dotNumber || '').replace(/\D/g, ''),
    phoneDigits: String(lead.phone || '').replace(/\D/g, ''),
  };
};

const combineLeadFilters = (...filters) => {
  const activeFilters = filters.filter((filter) => filter && Object.keys(filter).length > 0);
  if (activeFilters.length === 0) return {};
  return activeFilters.length === 1 ? activeFilters[0] : { $and: activeFilters };
};

async function getAdminLeadPageIds(filter, skip, limit) {
  const rows = await CarrierLead.aggregate([
    { $match: filter },
    { $sort: { createdAt: 1, _id: 1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]);
  return rows.map((row) => row._id);
}

async function loadProjectedLeads(ids) {
  if (ids.length === 0) return [];
  const query = CarrierLead.find({ _id: { $in: ids } })
    .select(LEAD_LIST_PROJECTION)
    .populate('assignments.agentId', 'name');
  const rows = await query.lean();
  const order = new Map(ids.map((id, index) => [String(id), index]));
  return rows.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
}

/**
 * Helper to derive MC status bucket ('New', 'Growing', 'Veteran')
 */
export const deriveMcStatus = (mcAgeStr, mcStatusRaw = '') => {
  if (MC_STATUS_ENUM.includes(mcStatusRaw)) return mcStatusRaw;
  if (!mcAgeStr) return 'New';
  const str = String(mcAgeStr).toLowerCase().trim();

  if (str === 'new') return 'New';
  if (str === 'growing') return 'Growing';
  if (str === 'veteran') return 'Veteran';

  const yrMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:yr|year)/);
  if (yrMatch) {
    const yrs = parseFloat(yrMatch[1]);
    if (yrs > 1) return 'Veteran';
    const moMatch = str.match(/(?:yr|year)s?\s*(\d+)\s*(?:mo|month)/);
    if (moMatch && parseInt(moMatch[1], 10) > 0) return 'Veteran';
    if (yrs === 1) return 'Growing';
  }

  const moMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:mo|month)/);
  if (moMatch) {
    const mos = parseFloat(moMatch[1]);
    if (mos <= 6) return 'New';
    if (mos <= 12) return 'Growing';
    return 'Veteran';
  }

  const numMatch = str.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (num <= 6) return 'New';
    if (num <= 12) return 'Growing';
    return 'Veteran';
  }

  return 'New';
};

/**
 * @desc    Upload Excel sheet and upsert leads by MC Number into CarrierLead collection ONLY (Admin only)
 * @route   POST /api/leads/excel-upload
 * @access  Private/Admin
 */
export const uploadExcelLeads = asyncHandler(async (req, res) => {
  console.log(`[Excel Bulk Upload] Writing to target collection: "${CarrierLead.collection.name}" (Model: CarrierLead)`);

  if (!req.file) {
    res.status(400);
    throw new Error('Please upload an Excel (.xlsx or .xls) file');
  }

  const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    res.status(400);
    throw new Error('Excel file is empty');
  }

  const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!Array.isArray(sheetData) || sheetData.length === 0) {
    res.status(400);
    throw new Error('No rows found in Excel sheet');
  }

  let updatedCount = 0;
  const importedRows = [];
  const seenIdentifiers = new Set();

  for (const row of sheetData) {
    const { valid, data } = resolveLeadRowValues(row);
    if (!valid) continue;
    const { mcNumber, dotNumber } = data;

    const identifiers = [
      mcNumber ? `mc:${String(mcNumber).replace(/\D/g, '')}` : null,
      dotNumber ? `dot:${String(dotNumber).replace(/\D/g, '')}` : null,
    ].filter(Boolean);
    if (identifiers.some((identifier) => seenIdentifiers.has(identifier))) continue;
    identifiers.forEach((identifier) => seenIdentifiers.add(identifier));

    importedRows.push(data);
  }

  const rowsToInsert = [];
  for (const row of importedRows) {
    const identifierFilters = [];
    if (row.mcNumber) identifierFilters.push({ mcNumber: row.mcNumber });
    if (row.dotNumber) identifierFilters.push({ dotNumber: row.dotNumber });
    let existing = identifierFilters.length
      ? await CarrierLead.findOne({ $or: identifierFilters })
      : null;

    if (!existing && row.companyName) {
      const missingStoredIdentifiers = {
        $and: [
          { $or: [{ mcNumber: { $exists: false } }, { mcNumber: null }, { mcNumber: '' }] },
          { $or: [{ dotNumber: { $exists: false } }, { dotNumber: null }, { dotNumber: '' }] },
        ],
      };
      const legacyMatch = {
        companyName: row.companyName,
        ...missingStoredIdentifiers,
      };
      const legacyMatches = await CarrierLead.find(legacyMatch).select('_id').limit(2).lean();
      if (legacyMatches.length === 1) {
        existing = await CarrierLead.findById(legacyMatches[0]._id);
      } else if (legacyMatches.length > 1 && (row.phone || row.email)) {
        const duplicateNameMatch = {
          ...legacyMatch,
          ...(row.phone ? { phone: row.phone } : {}),
          ...(row.email ? { email: { $regex: `^${String(row.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } } : {}),
        };
        const disambiguated = await CarrierLead.find(duplicateNameMatch).select('_id').limit(2).lean();
        if (disambiguated.length === 1) existing = await CarrierLead.findById(disambiguated[0]._id);
      }
    }

    if (!existing) {
      rowsToInsert.push(row);
      continue;
    }

    // Update info fields only; preserve status, assignments, details, and history.
    existing.mcNumber = row.mcNumber || existing.mcNumber;
    existing.dotNumber = row.dotNumber || existing.dotNumber;
    existing.companyName = row.companyName || existing.companyName;
    existing.phone = row.phone || existing.phone;
    existing.email = row.email || existing.email;
    existing.address = row.address || existing.address;
    existing.city = row.city || existing.city;
    existing.state = row.state || existing.state;
    existing.zip = row.zip || existing.zip;
    if (row._powerUnitsProvided) existing.powerUnits = row.powerUnits;
    existing.mcAge = row.mcAge || existing.mcAge;
    existing.mcStatus = row.mcStatus || existing.mcStatus;
    await existing.save();
    updatedCount++;
  }

  if (rowsToInsert.length) {
    const newLeads = rowsToInsert.map((row) => buildLeadInsertDocument(row));
    await CarrierLead.insertMany(newLeads);
  }
  const addedCount = rowsToInsert.length;

  res.json({
    success: true,
    data: {
      targetCollection: CarrierLead.collection.name,
      added: addedCount,
      updated: updatedCount,
      totalProcessed: addedCount + updatedCount,
    },
    message: `Upload complete (${CarrierLead.collection.name}): ${addedCount} new leads added, ${updatedCount} existing updated.`,
  });
});

/**
 * @desc    Get Main Leads List for Admin from CarrierLead collection
 * @route   GET /api/leads/main-leads
 * @access  Private/Admin
 */
export const getMainLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getLeadPagination(req.query);
  const filter = buildLeadFilter(req.query, req.user);
  const kpiFilter = buildLeadFilter(req.query, req.user, { ignoreStatus: true });
  const [total, contactedCount, interestedCount, untouchedCount, ids] = await Promise.all([
    CarrierLead.countDocuments(filter),
    CarrierLead.countDocuments(combineLeadFilters(kpiFilter, { currentStatus: { $ne: 'Untouched' } })),
    CarrierLead.countDocuments(combineLeadFilters(kpiFilter, { currentStatus: 'Interested' })),
    CarrierLead.countDocuments(combineLeadFilters(kpiFilter, { currentStatus: 'Untouched' })),
    getAdminLeadPageIds(filter, skip, limit),
  ]);
  const leads = await loadProjectedLeads(ids);

  const response = {
    success: true,
    count: leads.length,
    data: leads,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    kpis: {
      totalLeads: total,
      contacted: contactedCount,
      interested: interestedCount,
      untouched: untouchedCount,
    },
  };

  res.json(response);
});

/**
 * @desc    Bulk assign carrier leads to an agent in CarrierLead collection
 * @route   POST /api/leads/assign
 * @access  Private/Admin
 */
export const assignLeads = asyncHandler(async (req, res) => {
  const { carrierIds, agentId } = req.body;

  if (!Array.isArray(carrierIds) || carrierIds.length === 0) {
    res.status(400);
    throw new Error('Please provide carrierIds array');
  }

  if (!agentId) {
    res.status(400);
    throw new Error('Target agentId is required');
  }

  const agent = await User.findById(agentId);
  if (!agent) {
    res.status(404);
    throw new Error('Selected sales agent not found');
  }

  const assignmentObj = {
    agentId,
    assignedDate: new Date(),
    assignedBy: req.user._id,
  };

  const previouslyTouchedLeadIds = new Set((await CarrierActivityLog.distinct('carrierId', {
    agentId,
    carrierId: { $in: carrierIds },
  })).map(String));
  const untouchedIds = carrierIds.filter((carrierId) => !previouslyTouchedLeadIds.has(String(carrierId)));

  await CarrierLead.updateMany(
    { _id: { $in: carrierIds } },
    {
      $push: { assignments: assignmentObj },
      ...(untouchedIds.length > 0 ? { $set: { currentStatus: 'Untouched' } } : {}),
    }
  );

  res.json({
    success: true,
    message: `Successfully assigned ${carrierIds.length} leads to ${agent.name}`,
  });
});

export const getBulkAssignAvailable = asyncHandler(async (req, res) => {
  const poolFilter = buildLeadFilter({ currentStatus: 'Untouched', assignedFilter: 'unassigned' }, {});
  const availableCount = await CarrierLead.countDocuments(poolFilter);
  const requestedCount = Number(req.query.count);
  res.json({ success: true, data: { availableCount, requestedCount: Number.isInteger(requestedCount) ? requestedCount : null } });
});

export const bulkAssignLeadsByCount = asyncHandler(async (req, res) => {
  const { agentId, count } = req.body;
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    res.status(400);
    throw new Error('count must be an integer between 1 and 5000');
  }
  if (!mongoose.isValidObjectId(agentId)) {
    res.status(400);
    throw new Error('A valid Sales Agent agentId is required');
  }
  const agent = await User.findOne({ _id: agentId, role: 'sales_agent' });
  if (!agent) {
    res.status(400);
    throw new Error('agentId must identify a Sales Agent');
  }

  const poolFilter = buildLeadFilter({ currentStatus: 'Untouched', assignedFilter: 'unassigned' }, {});
  const candidateIds = await getAdminLeadPageIds(poolFilter, 0, count);

  const assignment = {
    agentId: agent._id,
    assignedDate: new Date(),
    assignedBy: req.user._id,
  };
  let assignedCount = 0;
  if (candidateIds.length) {
    await CarrierLead.updateMany(
      combineLeadFilters(
        { _id: { $in: candidateIds } },
        buildLeadFilter({ currentStatus: 'Untouched', assignedFilter: 'unassigned' }, {})
      ),
      { $push: { assignments: assignment }, $set: { currentStatus: 'Untouched' } }
    );

    assignedCount = await CarrierLead.countDocuments({
      _id: { $in: candidateIds },
      assignments: { $elemMatch: { agentId: agent._id, assignedBy: req.user._id, assignedDate: assignment.assignedDate } },
    });
  }

  const availableAfter = await CarrierLead.countDocuments(poolFilter);
  res.json({
    success: true,
    assignedCount,
    requestedCount: count,
    availableAfter,
  });
});

/**
 * @desc    Bulk unassign carrier leads (remove agent assignments)
 * @route   POST /api/leads/unassign
 * @access  Private/Admin
 */
export const unassignLeads = asyncHandler(async (req, res) => {
  const { carrierIds, agentId } = req.body;

  if (!Array.isArray(carrierIds) || carrierIds.length === 0) {
    res.status(400);
    throw new Error('Please provide carrierIds array');
  }

  const updateQuery = agentId
    ? { $pull: { assignments: { agentId } } }
    : { $set: { assignments: [] } };

  await CarrierLead.updateMany({ _id: { $in: carrierIds } }, updateQuery);

  res.json({
    success: true,
    message: `Successfully unassigned ${carrierIds.length} leads`,
  });
});

/**
 * @desc    Bulk delete carrier leads from CarrierLead collection ONLY
 * @route   POST /api/leads/bulk-delete
 * @access  Private/Admin
 */
export const bulkDeleteLeads = asyncHandler(async (req, res) => {
  const { carrierIds } = req.body;

  if (!Array.isArray(carrierIds) || carrierIds.length === 0) {
    res.status(400);
    throw new Error('Please provide carrierIds array');
  }

  const result = await CarrierLead.deleteMany({ _id: { $in: carrierIds } });

  res.json({
    success: true,
    deletedCount: result.deletedCount,
    message: `Successfully deleted ${result.deletedCount} leads`,
  });
});

/**
 * @desc    Get My Leads for Sales Agent from CarrierLead collection
 * @route   GET /api/leads/my-leads
 * @access  Private/SalesAgent
 */
export const getMyLeads = asyncHandler(async (req, res) => {
  const { search, category } = req.query;
  const { page, limit, skip } = getLeadPagination(req.query);
  const filter = buildLeadFilter({ search, category }, { role: 'sales_agent', _id: req.user._id });

  const [total, leads] = await Promise.all([
    CarrierLead.countDocuments(filter),
    CarrierLead.find(filter)
      .select(LEAD_LIST_PROJECTION)
      .sort({ 'assignments.assignedDate': 1, createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const response = {
    success: true,
    count: leads.length,
    data: leads,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };

  res.json(response);
});

export const getMyLeadStats = asyncHandler(async (req, res) => {
  const rows = await CarrierLead.aggregate([
    { $match: buildLeadFilter({}, req.user) },
    {
      $group: {
        _id: '$currentStatus',
        count: { $sum: 1 },
        submitted: { $sum: { $cond: ['$isSubmitted', 1, 0] } },
        active: { $sum: { $cond: [{ $ne: ['$convertedToCarrierId', null] }, 1, 0] } },
      },
    },
  ]);
  const categoryCounts = { All: 0 };
  let leadsSubmitted = 0;
  let activeCarriers = 0;
  const tabByStatus = {
    'Follow Up/Busy': 'Follow Up',
    'Asked for Email': 'Asked to Email',
  };

  rows.forEach((row) => {
    categoryCounts.All += row.count;
    categoryCounts[tabByStatus[row._id] || row._id] = row.count;
    leadsSubmitted += row.submitted;
    activeCarriers += row.active;
  });
  CARRIER_LEAD_STATUS_ENUM.forEach((status) => {
    const tab = tabByStatus[status] || status;
    if (categoryCounts[tab] === undefined) categoryCounts[tab] = 0;
  });

  res.json({
    success: true,
    data: {
      totalAssigned: categoryCounts.All,
      untouched: categoryCounts.Untouched || 0,
      interested: categoryCounts.Interested || 0,
      verySerious: categoryCounts['Very Serious'] || 0,
      leadsSubmitted,
      activeCarriers,
      categoryCounts,
    },
  });
});

export const getLeadById = asyncHandler(async (req, res) => {
  if (!['admin', 'sales_agent'].includes(req.user.role)) {
    res.status(403);
    throw new Error('You are not allowed to view this lead');
  }
  const lead = await CarrierLead.findById(req.params.id);
  if (!lead) {
    res.status(404);
    throw new Error('Carrier lead not found');
  }

  if (req.user.role === 'sales_agent' && !lead.assignments.some((assignment) => String(assignment.agentId) === String(req.user._id))) {
    res.status(403);
    throw new Error('You are not assigned to this lead');
  }

  res.json({ success: true, data: lead });
});

/**
 * @desc    Update CarrierLead Current Status & Write Activity Log
 * @route   PATCH /api/leads/:id/status
 * @access  Private
 */
export const updateLeadStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { currentStatus } = req.body;

  if (!CARRIER_LEAD_STATUS_ENUM.includes(currentStatus)) {
    res.status(400);
    throw new Error(`Invalid status. Must be one of: ${CARRIER_LEAD_STATUS_ENUM.join(', ')}`);
  }

  const lead = await CarrierLead.findById(id);
  if (!lead) {
    res.status(404);
    throw new Error('Carrier lead not found');
  }

  const statusFrom = lead.currentStatus || 'None';
  if (statusFrom === currentStatus) {
    return res.json({ success: true, data: { lead, logEntry: null } });
  }
  lead.currentStatus = currentStatus;
  await lead.save();

  // Create immutable activity log entry (source of truth for cold calls)
  const logEntry = await CarrierActivityLog.create({
    carrierId: lead._id,
    agentId: req.user._id,
    statusFrom,
    statusTo: currentStatus,
    timestamp: new Date(),
  });

  res.json({
    success: true,
    data: {
      lead,
      logEntry,
    },
  });
});

/**
 * @desc    Upload Lead Document (Cloudinary folder dkr/lead-documents)
 * @route   POST /api/leads/:id/documents
 * @access  Private
 */
export const uploadLeadDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { type = 'other' } = req.body;

  if (!req.file) {
    res.status(400);
    throw new Error('Please choose a document to upload');
  }

  const lead = await CarrierLead.findById(id);
  if (!lead) {
    res.status(404);
    throw new Error('Carrier lead not found');
  }

  const uploaded = await uploadDocToCloudinary(req.file.buffer, req.file.originalname, 'dkr/lead-documents');
  const docEntry = {
    originalFileName: uploaded.originalFileName,
    cloudinaryUrl: uploaded.cloudinaryUrl,
    cloudinaryPublicId: uploaded.cloudinaryPublicId,
    resourceType: uploaded.resourceType || 'raw',
    type: type || 'other',
    mimeType: uploaded.fileType || req.file.mimetype || 'application/octet-stream',
    uploadedAt: new Date(),
  };

  lead.documents = [
    ...lead.documents.filter((doc) => String(doc.type) !== String(docEntry.type)),
    docEntry,
  ];
  lead.detailsAdded = true;
  await lead.save();

  res.json({
    success: true,
    data: docEntry,
    message: 'Lead document uploaded successfully',
  });
});

export const updateLeadDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { truckDetails, trucks, documents } = req.body;

  if (truckDetails !== undefined && (!truckDetails || typeof truckDetails !== 'object')) {
    res.status(400);
    throw new Error('Please provide valid truckDetails object');
  }

  if (trucks !== undefined && !Array.isArray(trucks)) {
    res.status(400);
    throw new Error('Please provide valid trucks array');
  }

  if (documents !== undefined && !Array.isArray(documents)) {
    res.status(400);
    throw new Error('Please provide valid documents array');
  }

  const lead = await CarrierLead.findById(id);
  if (!lead) {
    res.status(404);
    throw new Error('Carrier lead not found');
  }

  if (truckDetails) {
    const rawCustomDate = truckDetails.availabilityCustomDate || null;
    const finalCustomDate = (!rawCustomDate || rawCustomDate === '' || rawCustomDate === 'null' || rawCustomDate === 'undefined') ? null : rawCustomDate;

    const rawDisp = truckDetails.assignedDispatcherId || null;
    const finalDisp = (!rawDisp || rawDisp === '' || rawDisp === 'null' || rawDisp === 'undefined') ? null : rawDisp;

    lead.truckDetails = {
      ...(lead.truckDetails?.toObject?.() || lead.truckDetails || {}),
      ...truckDetails,
      availabilityCustomDate: finalCustomDate,
      assignedDispatcherId: finalDisp,
    };
  }

  if (Array.isArray(trucks)) {
    lead.trucks = trucks.map((truck) => {
      const rawCustomDate = truck.availabilityCustomDate || null;
      const finalCustomDate = (!rawCustomDate || rawCustomDate === '' || rawCustomDate === 'null' || rawCustomDate === 'undefined') ? null : rawCustomDate;

      const rawDisp = truck.assignedDispatcherId || null;
      const finalDisp = (!rawDisp || rawDisp === '' || rawDisp === 'null' || rawDisp === 'undefined') ? null : rawDisp;

      return {
        ...truck,
        currentZip: truck.currentZip || '',
        availability: truck.availability || 'Empty Today',
        availabilityCustomDate: finalCustomDate,
        assignedDispatcherId: finalDisp,
        equipment: Array.isArray(truck.equipment) ? truck.equipment : [],
        notes: truck.notes || '',
        documentsReceived: truck.documentsReceived || {},
        preferences: truck.preferences || {},
      };
    });
  }

  if (Array.isArray(documents)) {
    const normalizedDocs = documents.map((doc) => ({
      originalFileName: doc.originalFileName || doc.originalName || 'uploaded-document',
      cloudinaryUrl: doc.cloudinaryUrl || doc.url || '',
      cloudinaryPublicId: doc.cloudinaryPublicId || doc.publicId || '',
      resourceType: doc.resourceType || 'raw',
      type: doc.type || 'other',
      mimeType: doc.mimeType || doc.fileType || 'application/octet-stream',
      uploadedAt: doc.uploadedAt ? new Date(doc.uploadedAt) : new Date(),
    }));

    const mergedDocs = [...(lead.documents || [])];
    normalizedDocs.forEach((doc) => {
      const key = String(doc.type || 'other');
      const existingIndex = mergedDocs.findIndex((item) => String(item.type || 'other') === key);
      if (existingIndex >= 0) {
        mergedDocs[existingIndex] = doc;
      } else {
        mergedDocs.push(doc);
      }
    });

    lead.documents = mergedDocs;
  }

  lead.detailsAdded = true;
  await lead.save();

  res.json({
    success: true,
    data: lead,
    message: 'Carrier lead details saved successfully',
  });
});

/**
 * @desc    Select Lead IDs within Range (Range-Select across full filtered dataset server-side)
 * @route   POST /api/leads/select-range
 * @access  Private
 */
export const selectLeadRange = asyncHandler(async (req, res) => {
  const { rangeStart, rangeEnd } = req.body;

  const start = Math.max(1, parseInt(rangeStart, 10) || 1);
  const end = Math.max(start, parseInt(rangeEnd, 10) || start);
  const limit = end - start + 1;
  const skip = start - 1;

  const filter = buildLeadFilter(req.body, req.user);
  let leadIds;
  if (req.user.role === 'sales_agent') {
    const leads = await CarrierLead.find(filter)
      .select('_id')
      .sort({ 'assignments.assignedDate': 1, createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
    leadIds = leads.map((lead) => lead._id);
  } else {
    leadIds = await getAdminLeadPageIds(filter, skip, limit);
  }

  if (leadIds.length === 0) {
    res.status(404);
    throw new Error(`No leads found in the specified range (#${start}–#${end})`);
  }

  res.json({
    success: true,
    count: leadIds.length,
    leadIds,
    range: { start, end },
    message: `Successfully selected ${leadIds.length} leads in range #${start}–#${end}`,
  });
});

function parseLeadNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function leadAvailabilityDate(truck, notes, truckNumber) {
  if (truck.availabilityCustomDate) {
    const customDate = new Date(truck.availabilityCustomDate);
    if (!Number.isNaN(customDate.getTime())) return customDate;
    notes.push(`Truck #${truckNumber} availability date could not be parsed: ${truck.availabilityCustomDate}`);
  }

  if (truck.availability === 'Empty Today') return new Date();
  if (truck.availability === 'Empty Tomorrow') return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (truck.availability) {
    notes.push(`Truck #${truckNumber} availability (${truck.availability}) has no exact DKR empty-time equivalent.`);
  }
  return null;
}

function mapLeadTruck(lead, sourceTruck, index, conversionNotes) {
  const truckNumber = index + 1;
  const rawType = String(sourceTruck.truckType || '').trim();
  const normalizedType = {
    'flat bed': 'Flatbed',
    'hot shot': 'Hotshot',
    'auto carrier': 'Auto/Car Hauler',
    'car hauler': 'Auto/Car Hauler',
  }[rawType.toLowerCase()] || rawType;
  const equipment = getEquipmentConfig(normalizedType);
  const equipmentType = equipment?.baseType;

  if (!equipmentType || !EQUIPMENT_TYPES.includes(equipmentType)) {
    const error = `Truck #${truckNumber} has unsupported equipment type "${rawType || 'unspecified'}"; DKR has no matching operational truck type.`;
    conversionNotes.push(error);
    return { error };
  }

  const isPowerOnly = equipmentType.toLowerCase() === 'power only';
  const rawCapacity = sourceTruck.maxWeightCapacity ?? sourceTruck.maxCargoCapacityValue;
  let maxLoadCapacity = parseLeadNumber(rawCapacity);
  const capacityUnit = String(sourceTruck.maxCargoCapacityUnit || 'lb').trim().toLowerCase();
  if (maxLoadCapacity !== null && capacityUnit === 'kg') maxLoadCapacity *= 2.2046226218;
  else if (maxLoadCapacity !== null && !['lb', 'lbs', 'pound', 'pounds'].includes(capacityUnit)) {
    conversionNotes.push(`Truck #${truckNumber} capacity unit "${capacityUnit}" was not converted; the original capacity remains in Carrier notes.`);
    maxLoadCapacity = null;
  }

  if (isPowerOnly) {
    if (maxLoadCapacity !== null) conversionNotes.push(`Truck #${truckNumber} supplied a capacity, but DKR Power Only trucks cannot declare Max Load Capacity.`);
    maxLoadCapacity = null;
  } else if (maxLoadCapacity === null || maxLoadCapacity <= 0) {
    const sourceDetails = {
      truckType: rawType,
      maxLoadCapacity: rawCapacity,
      trailerLength: sourceTruck.trailerLength || sourceTruck.trailerLengthValue || '',
      currentZip: sourceTruck.currentZip || '',
      driverName: sourceTruck.driverName || '',
      notes: sourceTruck.notes || '',
      equipment: sourceTruck.equipment || [],
      preferences: sourceTruck.preferences?.toObject?.() || sourceTruck.preferences || {},
    };
    const warning = `Truck #${truckNumber} (${equipmentType}) skipped: Max Load Capacity (lbs) must be a positive number. Skipped details: ${JSON.stringify(sourceDetails)}`;
    conversionNotes.push(warning);
    return { warning };
  }

  const truckNotes = [];
  if (sourceTruck.notes) truckNotes.push(String(sourceTruck.notes).trim());
  if (Array.isArray(sourceTruck.equipment) && sourceTruck.equipment.length) {
    truckNotes.push(`Lead equipment/preferences: ${sourceTruck.equipment.join(', ')}`);
  }
  if (sourceTruck.powerUnitCapability) truckNotes.push(`Lead power unit capability: ${sourceTruck.powerUnitCapability}`);
  if (sourceTruck.temperatureType) truckNotes.push(`Lead temperature type: ${sourceTruck.temperatureType}`);
  if (sourceTruck.tankCapacityValue) truckNotes.push(`Lead tank capacity: ${sourceTruck.tankCapacityValue} ${sourceTruck.tankCapacityUnit || 'gal'}`);
  if (sourceTruck.vehicleCapacityValue) truckNotes.push(`Lead vehicle capacity: ${sourceTruck.vehicleCapacityValue}`);
  if (Array.isArray(sourceTruck.trailerTypesPullable) && sourceTruck.trailerTypesPullable.length) {
    truckNotes.push(`Lead pullable trailer types: ${sourceTruck.trailerTypesPullable.join(', ')}`);
  }
  const receivedDocuments = sourceTruck.documentsReceived?.toObject?.() || sourceTruck.documentsReceived || {};
  const receivedDocumentTypes = Object.entries(receivedDocuments).filter(([, received]) => Boolean(received)).map(([type]) => type);
  if (receivedDocumentTypes.length) truckNotes.push(`Lead document-received flags: ${receivedDocumentTypes.join(', ')}`);
  const preferences = sourceTruck.preferences?.toObject?.() || sourceTruck.preferences || {};
  const preferenceSummary = Object.entries(preferences)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
  if (preferenceSummary.length) truckNotes.push(`Lead operating preferences: ${preferenceSummary.join('; ')}`);

  const rawLengthValue = sourceTruck.trailerLength || (sourceTruck.trailerLengthValue ? `${sourceTruck.trailerLengthValue}${sourceTruck.trailerLengthUnit || 'ft'}` : '');
  const rawLength = String(rawLengthValue).replace(/\s+/g, '').toLowerCase();
  const trailerLength = ['48ft', '53ft'].includes(rawLength) ? rawLength : null;
  if (rawLengthValue && !trailerLength) {
    truckNotes.push(`Lead trailer length: ${rawLengthValue}`);
  }

  const enumValue = (value, allowed, label) => {
    if (!value) return null;
    if (allowed.includes(value)) return value;
    truckNotes.push(`Lead ${label}: ${value}`);
    return null;
  };

  const truckData = {
    truckNumber,
    equipmentType,
    driverName: sourceTruck.driverName || '',
    driverPhone: sourceTruck.driverPhone || '',
    dispatcher: sourceTruck.assignedDispatcherId || null,
    status: 'empty',
    nextAction: 'find_load',
    emptyZip: sourceTruck.currentZip || lead.zip || '',
    emptyCity: lead.city || '',
    emptyState: /^[a-z]{2}$/i.test(lead.state || '') ? lead.state.toUpperCase() : '',
    emptyAt: leadAvailabilityDate(sourceTruck, truckNotes, truckNumber),
    preferredLanes: sourceTruck.preferences?.lanePreferenceCustom || sourceTruck.preferences?.lanePreferenceRegion || (sourceTruck.preferences?.lanePreferenceStates || []).join(', '),
    maxLoadCapacity,
    neckType: equipmentType === 'lowboy' ? (normalizedType.toLowerCase() === 'rgn' ? 'removable' : 'fixed') : null,
    trailerLength,
    doorType: enumValue(sourceTruck.doorType, ['Swing', 'Roll-up'], 'door type'),
    liftGate: enumValue(sourceTruck.liftGate, ['Yes', 'No'], 'lift gate'),
    stepDeckSubType: enumValue(sourceTruck.stepDeckSubType, ['Extendable', 'With Loading Ramps', 'Over-Dimension Loads'], 'step deck subtype'),
    trailerConfig: enumValue(sourceTruck.trailerConfig, ['Gooseneck', 'Bumper Pull'], 'trailer configuration'),
    trailerSize: enumValue(sourceTruck.trailerSize, ['20ft', '25ft', '30ft', '35ft', '40ft'], 'trailer size'),
    cargoType: enumValue(sourceTruck.cargoType || sourceTruck.tankerType, ['Food Grade', 'Liquid', 'Bulk'], 'cargo type'),
    notes: truckNotes.filter(Boolean).join('\n'),
  };

  if (sourceTruck.assignedDispatcherId && !mongoose.isValidObjectId(sourceTruck.assignedDispatcherId)) {
    conversionNotes.push(`Truck #${truckNumber} dispatcher assignment was not a valid DKR user ID and was left unassigned.`);
    truckData.dispatcher = null;
  }
  if (lead.state && !truckData.emptyState) conversionNotes.push(`Lead state "${lead.state}" has no two-letter DKR truck state equivalent.`);

  return { data: truckData };
}

function leadDocumentsForCarrier(lead, conversionNotes) {
  const typeMap = {
    mcletter: 'mc_authority',
    mc_authority: 'mc_authority',
    coi: 'insurance',
    insurance: 'insurance',
    w9: 'w9',
    bol: 'bol',
    rate_confirmation: 'rate_confirmation',
  };

  return (lead.documents || []).flatMap((document) => {
    if (!document.cloudinaryUrl) {
      conversionNotes.push(`Lead document "${document.originalFileName || 'unnamed'}" had no URL and was not copied to Carrier documents.`);
      return [];
    }
    const typeKey = String(document.type || '').toLowerCase().replace(/[\s-]/g, '_');
    const type = typeMap[typeKey] || 'other';
    if (!typeMap[typeKey] && typeKey && typeKey !== 'other') {
      conversionNotes.push(`Lead document type "${document.type}" was stored as DKR document type "other".`);
    }
    return [{
      originalFileName: document.originalFileName || 'uploaded-document',
      cloudinaryUrl: document.cloudinaryUrl,
      cloudinaryPublicId: document.cloudinaryPublicId || '',
      resourceType: document.resourceType || 'raw',
      type,
      mimeType: document.mimeType || '',
      uploadedAt: document.uploadedAt || new Date(),
    }];
  });
}

function buildCarrierNotes(lead, conversionNotes) {
  const lines = [];
  const originalNotes = [lead.notes, lead.truckDetails?.notes].filter(Boolean);
  if (originalNotes.length) lines.push(`Lead notes: ${originalNotes.join('\n')}`);
  if (lead.address || lead.city || lead.state || lead.zip) {
    lines.push(`Lead address: ${[lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}`);
  }
  if (lead.mcAge || lead.mcStatus) lines.push(`MC age/status: ${[lead.mcAge, lead.mcStatus].filter(Boolean).join(' / ')}`);
  if (lead.powerUnits) lines.push(`Lead reported power units: ${lead.powerUnits}`);

  const preferences = lead.truckDetails?.preferences;
  if (preferences) {
    const summary = Object.entries(preferences.toObject?.() || preferences)
      .filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length))
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    if (summary.length) lines.push(`Lead operating preferences: ${summary.join('; ')}`);
  }

  const received = lead.truckDetails?.documentsReceived;
  if (received) {
    const summary = Object.entries(received.toObject?.() || received)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
    if (summary.length) lines.push(`Lead document-received flags: ${summary.join(', ')}`);
  }

  if (conversionNotes.length) lines.push(`Conversion notes: ${conversionNotes.join(' ')}`);
  return lines.join('\n');
}

export const convertLeadToCarrier = asyncHandler(async (req, res) => {
  const performConversion = async (session = null) => {
    const leadQuery = CarrierLead.findById(req.params.id);
    if (session) leadQuery.session(session);
    const lead = await leadQuery;
    if (!lead) {
      res.status(404);
      throw new Error('Carrier lead not found');
    }
    if (lead.isSubmitted && lead.convertedToCarrierId) {
      res.status(400);
      throw new Error('This lead has already been converted to a carrier');
    }

    const findCarrier = async (filter) => {
      if (!filter) return null;
      const query = Carrier.findOne(filter);
      if (session) query.session(session);
      return query;
    };
    const mcMatch = lead.mcNumber ? await findCarrier({ mcNumber: lead.mcNumber }) : null;
    const dotMatch = !mcMatch && lead.dotNumber ? await findCarrier({ dotNumber: lead.dotNumber }) : null;
    const existingCarrier = mcMatch || dotMatch;
    const conflictingAuthorityMatch = Boolean(mcMatch && lead.dotNumber && await findCarrier({ dotNumber: lead.dotNumber, _id: { $ne: mcMatch._id } }));
    const leadTruckList = [];
    if (lead.truckDetails?.truckType) leadTruckList.push(lead.truckDetails);
    if (Array.isArray(lead.trucks)) leadTruckList.push(...lead.trucks.filter((truck) => truck.truckType));

    const conversionNotes = [];
    const mapped = leadTruckList.map((truck, index) => mapLeadTruck(lead, truck, index, conversionNotes));
    const unsupported = mapped.find((result) => result?.error);
    if (unsupported) {
      res.status(400);
      throw new Error(unsupported.error);
    }

    const existingTrucksQuery = existingCarrier
      ? Truck.find({ carrier: existingCarrier._id }).sort({ truckNumber: 1 })
      : Truck.find({ _id: null });
    if (session) existingTrucksQuery.session(session);
    const existingTrucks = await existingTrucksQuery;
    const incoming = mapped.flatMap((result, index) => result?.data
      ? [{ data: result.data, sourceLeadId: lead._id, sourceLeadTruckIndex: index }]
      : []);
    const { added: unseenTrucks, skipped: duplicateTrucks } = selectUnseenLeadTrucks(existingTrucks, incoming);
    const nextTruckNumber = existingTrucks.reduce((highest, truck) => Math.max(highest, Number(truck.truckNumber) || 0), 0) + 1;
    const submittedAt = new Date();
    const assignedSalesAgent = req.user.role === 'sales_agent'
      ? req.user._id
      : [...(lead.assignments || [])].reverse().find((assignment) => assignment.agentId)?.agentId || null;
    const truckTypes = [...new Set(unseenTrucks.map((item) => item.data.equipmentType))];
    if (conflictingAuthorityMatch) conversionNotes.push('Lead MC and DOT values match different existing carriers; the MC match was used and the existing DOT value was preserved.');
    const mergedFields = [];
    const rawPreferences = lead.truckDetails?.preferences?.toObject?.() || lead.truckDetails?.preferences || {};
    const preferences = {
      operationPreference: 'OTR',
      distancePreference: 'Flexible',
      minRatePerMile: '$2.50',
      minRatePerMileCustom: null,
      lanePreference: 'Any Lane',
      lanePreferenceStates: [],
      lanePreferenceRegion: '',
      lanePreferenceCustom: '',
      schedulePreference: 'Flexible',
      ...rawPreferences,
    };
    const rawDocumentFlags = lead.truckDetails?.documentsReceived?.toObject?.()
      || lead.truckDetails?.documentsReceived || {};
    const documentFlags = {
      mcLetter: false, coi: false, w9: false, noa: false,
      ...rawDocumentFlags,
    };
    const leadDocs = leadDocumentsForCarrier(lead, conversionNotes);
    const carrier = existingCarrier || new Carrier({
      companyName: lead.companyName,
      mcNumber: lead.mcNumber || undefined,
      dotNumber: lead.dotNumber || undefined,
      contactName: lead.contactName || '',
      contactPhone: lead.phone || '',
      contactEmail: lead.email || '',
      truckType: truckTypes.join(', ') || leadTruckList.map((truck) => truck.truckType).filter(Boolean).join(', '),
      numberOfTrucks: existingTrucks.length + unseenTrucks.length,
      pipelineStage: 'new_lead',
      stageHistory: [{ stage: 'new_lead', enteredAt: submittedAt }],
      assignedSalesAgent,
      convertedFromLeadId: lead._id,
      documents: leadDocs,
      preferences,
      onboardingDocumentFlags: documentFlags,
      notes: buildCarrierNotes(lead, conversionNotes),
    });
    const carrierBefore = existingCarrier ? carrier.toObject({ depopulate: true }) : null;

    if (existingCarrier) {
      const fillIfEmpty = (field, value) => {
        const current = carrier[field];
        if ((current === undefined || current === null || current === '') && value !== undefined && value !== null && value !== '') {
          carrier[field] = value;
          mergedFields.push(field);
        }
      };
      fillIfEmpty('companyName', lead.companyName);
      fillIfEmpty('mcNumber', lead.mcNumber);
      fillIfEmpty('dotNumber', conflictingAuthorityMatch ? '' : lead.dotNumber);
      fillIfEmpty('contactName', lead.contactName);
      fillIfEmpty('contactPhone', lead.phone);
      fillIfEmpty('contactEmail', lead.email);
      fillIfEmpty('truckType', truckTypes.join(', ') || leadTruckList.map((truck) => truck.truckType).filter(Boolean).join(', '));
      fillIfEmpty('assignedSalesAgent', assignedSalesAgent);
      fillIfEmpty('convertedFromLeadId', lead._id);
      if (unseenTrucks.length) {
        carrier.numberOfTrucks = Math.max(Number(carrier.numberOfTrucks) || 0, existingTrucks.length) + unseenTrucks.length;
        mergedFields.push('numberOfTrucks');
      } else if (!carrier.numberOfTrucks) {
        carrier.numberOfTrucks = existingTrucks.length;
        mergedFields.push('numberOfTrucks');
      }
      if (!carrier.preferences && Object.keys(rawPreferences).length) {
        carrier.preferences = preferences;
        mergedFields.push('preferences');
      }
      if (!carrier.onboardingDocumentFlags) {
        carrier.onboardingDocumentFlags = documentFlags;
        mergedFields.push('onboardingDocumentFlags');
      }
      if (leadDocs.length) {
        const knownUrls = new Set((carrier.documents || []).map((document) => document.cloudinaryUrl).filter(Boolean));
        const newDocuments = leadDocs.filter((document) => !knownUrls.has(document.cloudinaryUrl));
        carrier.documents.push(...newDocuments);
        if (newDocuments.length) mergedFields.push('documents');
      }
      const skippedDetails = conversionNotes.filter((note) => note.includes('skipped:'));
      if (skippedDetails.length) {
        carrier.notes = [carrier.notes, ...skippedDetails].filter(Boolean).join('\n');
        mergedFields.push('notes');
      } else if (!carrier.notes) {
        const notes = buildCarrierNotes(lead, conversionNotes);
        if (notes) {
          carrier.notes = notes;
          mergedFields.push('notes');
        }
      }
    }

    const truckDocs = unseenTrucks.map((item, index) => new Truck({
      ...item.data,
      truckNumber: nextTruckNumber + index,
      carrier: carrier._id,
      carrierName: carrier.companyName,
      createdBy: req.user._id,
      sourceLeadId: item.sourceLeadId,
      sourceLeadTruckIndex: item.sourceLeadTruckIndex,
      timeline: [{
        action: 'created',
        by: req.user._id,
        byName: req.user.name || 'Sales Agent',
        at: submittedAt,
        note: 'Truck created from a submitted lead',
      }],
    }));

    await carrier.validate({ validateModifiedOnly: Boolean(existingCarrier) });
    await Promise.all(truckDocs.map((truck) => truck.validate()));

    const previousStatus = lead.currentStatus || 'Untouched';
    const leadBefore = {
      convertedToCarrierId: lead.convertedToCarrierId,
      submittedAt: lead.submittedAt,
      submittedByAgentId: lead.submittedByAgentId,
      isSubmitted: lead.isSubmitted,
      currentStatus: lead.currentStatus,
    };
    let carrierSaved = false;
    let leadSaved = false;
    let activityId = null;
    try {
      if (!session && !existingCarrier) {
        await carrier.save();
        carrierSaved = true;
      }
      if (!session && existingCarrier && truckDocs.length) {
        await Truck.insertMany(truckDocs);
      }
      if (!session && existingCarrier) {
        await carrier.save();
        carrierSaved = true;
      }
      if (session) await carrier.save({ session });
      if (truckDocs.length) {
        if (session) await Truck.insertMany(truckDocs, { session });
        else if (!existingCarrier) await Truck.insertMany(truckDocs);
      }

      lead.convertedToCarrierId = carrier._id;
      lead.submittedAt = submittedAt;
      lead.submittedByAgentId = req.user._id;
      lead.isSubmitted = true;
      lead.currentStatus = 'Very Serious';
      await lead.save(session ? { session } : undefined);
      leadSaved = true;

      if (previousStatus !== 'Very Serious') {
        const activity = new CarrierActivityLog({
          carrierId: lead._id,
          agentId: req.user._id,
          statusFrom: previousStatus,
          statusTo: 'Very Serious',
          timestamp: submittedAt,
        });
        await activity.save(session ? { session } : undefined);
        activityId = activity._id;
      }
    } catch (writeError) {
      if (session) throw writeError;
      const truckIds = truckDocs.map((truck) => truck._id);
      const rollback = [];
      if (truckIds.length) rollback.push(() => Truck.deleteMany({ _id: { $in: truckIds } }));
      if (activityId) rollback.push(() => CarrierActivityLog.deleteOne({ _id: activityId }));
      if (leadSaved) rollback.push(async () => {
        Object.assign(lead, leadBefore);
        await lead.save();
      });
      if (existingCarrier && carrierSaved) rollback.push(async () => {
        carrier.set(carrierBefore);
        await carrier.save();
      });
      else if (!existingCarrier && carrierSaved) rollback.push(() => Carrier.deleteOne({ _id: carrier._id }));
      const rollbackResults = await Promise.allSettled(rollback.map((action) => action()));
      const rollbackFailure = rollbackResults.find((result) => result.status === 'rejected');
      if (rollbackFailure) {
        throw new Error(`Lead conversion failed and rollback was incomplete: ${rollbackFailure.reason?.message || 'unknown rollback error'}`, { cause: writeError });
      }
      throw writeError;
    }

    return {
      lead,
      carrier,
      trucks: truckDocs,
      merged: Boolean(existingCarrier),
      addedTruckCount: truckDocs.length,
      skippedTruckCount: mapped.filter((result) => result?.warning).length + duplicateTrucks.length,
      warnings: [
        ...conversionNotes.filter((note) => note.includes('skipped:')),
        ...(conflictingAuthorityMatch ? ['The MC and DOT numbers matched different Carriers; the MC match was used without changing its populated DOT number.'] : []),
        ...duplicateTrucks.map((item) => `Truck #${item.sourceLeadTruckIndex + 1} was not added because a matching truck already exists on this carrier.`),
      ],
      mergedFields,
    };
  };

  let conversion;
  const session = await mongoose.startSession();
  try {
    try {
      await session.withTransaction(async () => {
        conversion = await performConversion(session);
      });
    } catch (transactionError) {
      const unsupported = transactionError?.code === 20
        || transactionError?.codeName === 'IllegalOperation'
        || /Transaction numbers are only allowed|replica set member or mongos/i.test(transactionError?.message || '');
      if (!unsupported) throw transactionError;
      conversion = await performConversion();
    }
  } finally {
    await session.endSession();
  }

  const { lead, carrier, trucks, merged, addedTruckCount, skippedTruckCount, warnings, mergedFields } = conversion;

  const submittedAtLabel = new Date(lead.submittedAt).toLocaleString('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  await createAdminNotification({
    type: 'sales_agent_lead',
    title: 'Sales Agent submitted a lead',
    message: `${req.user.name || 'Sales Agent'} submitted ${lead.companyName || 'a carrier lead'} (${formatMc(lead.mcNumber) || 'MC unavailable'}) at ${submittedAtLabel}`,
    referenceId: carrier._id,
    relatedModel: 'Carrier',
  }).catch((notificationError) => console.error('Failed to notify admins of submitted lead:', notificationError));

  res.json({
    success: true,
    data: { lead, carrier, trucks, merged, mergedFields, addedTruckCount, skippedTruckCount, warnings },
    message: `Lead submitted to ${carrier.companyName}; ${addedTruckCount} truck(s) added${skippedTruckCount ? `, ${skippedTruckCount} skipped` : ''}${merged ? ' and merged into the existing carrier' : ''}.`,
  });
});

export const getSubmittedLeads = asyncHandler(async (req, res) => {
  const agentId = req.user.role === 'sales_agent' ? req.user._id : req.query.agentId || req.user._id;
  const leads = await CarrierLead.find({ submittedByAgentId: agentId, isSubmitted: true })
    .populate('convertedToCarrierId', 'pipelineStage companyName activatedAt')
    .sort({ submittedAt: -1 });
  res.json({ success: true, count: leads.length, data: leads });
});

export const getAgentActivityStats = asyncHandler(async (req, res) => {
  const agentId = req.user.role === 'admin' ? (req.query.agentId || req.user._id) : req.user._id;
  const dateStr = req.query.date || today();
  const dateWindow = dateBucketWindow(dateStr);
  const monthStr = req.query.month || dateStr.slice(0, 7);
  const monthRange = calendarMonthBounds(monthStr);
  const [dayCalls, monthCalls] = await Promise.all([
    aggregateCallCounts({ agentIds: [agentId], start: dateWindow.start, end: dateWindow.end }),
    aggregateCallCounts({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
  ]);
  const logs = await populateActivityLogs(dayCalls.logs, 'companyName mcNumber currentStatus phone city state');
  const groupedByDay = {};
  monthCalls.logs.forEach((log) => {
    const dayKey = dateBucket(log.timestamp);
    groupedByDay[dayKey] = (groupedByDay[dayKey] || 0) + 1;
  });
  const dailyBreakdown = Object.keys(groupedByDay).sort((left, right) => right.localeCompare(left)).map((date) => ({
    date,
    callsCount: groupedByDay[date],
  }));

  res.json({ success: true, data: {
    agentId,
    today: { count: dayCalls.total, logs },
    month: { count: monthCalls.total, dailyBreakdown },
  } });
});

export const getAdminAgentOversight = asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const agent = await User.findById(agentId).select('name email role avatar');
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const assignedLeads = await CarrierLead.find({ 'assignments.agentId': agentId })
    .populate('assignments.agentId', 'name')
    .sort({ updatedAt: -1 });
  const totalAssigned = assignedLeads.length;
  const activeLeads = assignedLeads.filter((lead) => lead.currentStatus !== 'Not Interested').length;
  const closedLeads = assignedLeads.filter((lead) => lead.currentStatus === 'Not Interested').length;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const startOfDay = new Date(`${todayStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${todayStr}T23:59:59.999Z`);
  const monthStr = now.toISOString().slice(0, 7);
  const startOfMonth = new Date(`${monthStr}-01T00:00:00.000Z`);
  const [touchedToday, touchedThisMonth, recentLogs] = await Promise.all([
    CarrierActivityLog.countDocuments({ agentId, timestamp: { $gte: startOfDay, $lte: endOfDay } }),
    CarrierActivityLog.countDocuments({ agentId, timestamp: { $gte: startOfMonth } }),
    CarrierActivityLog.find({ agentId })
      .populate('carrierId', 'companyName mcNumber currentStatus')
      .sort({ timestamp: -1 })
      .limit(50),
  ]);

  res.json({ success: true, data: {
    agent,
    summary: { totalAssigned, activeLeads, closedLeads, touchedToday, touchedThisMonth },
    assignedLeads,
    recentLogs,
  } });
});

export const getDailyWorkReport = asyncHandler(async (req, res) => {
  const agentId = req.user.role === 'admin' ? (req.query.agentId || req.user._id) : req.user._id;
  const dateStr = req.query.date || today();
  const dateWindow = dateBucketWindow(dateStr);
  const [callMetrics, submissions, activations] = await Promise.all([
    aggregateCallCounts({ agentIds: [agentId], start: dateWindow.start, end: dateWindow.end }),
    getLeadSubmissionEvents({ agentIds: [agentId], start: dateWindow.start, end: dateWindow.end }),
    getActiveCarrierEvents({ agentIds: [agentId], start: dateWindow.start, end: dateWindow.end }),
  ]);
  const logs = await populateActivityLogs(callMetrics.logs, 'companyName mcNumber phone city state currentStatus');
  logs.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  logs.sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const statusBreakdown = {};
  logs.forEach((log) => { statusBreakdown[log.statusTo] = (statusBreakdown[log.statusTo] || 0) + 1; });

  res.json({ success: true, data: {
    date: dateStr,
    agentId,
    totalCalls: callMetrics.total,
    leadsSubmitted: submissions.length,
    carriersActivated: activations.length,
    statusBreakdown,
    logs,
  } });
});

export const getMonthlyWorkReport = asyncHandler(async (req, res) => {
  const agentId = req.user.role === 'admin' ? (req.query.agentId || req.user._id) : req.user._id;
  const monthStr = req.query.month || today().slice(0, 7);
  const monthRange = calendarMonthBounds(monthStr);
  const [callMetrics, submissions, activations] = await Promise.all([
    aggregateCallCounts({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
    getLeadSubmissionEvents({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
    getActiveCarrierEvents({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
  ]);
  const statusBreakdown = {};
  const dailyMap = {};
  const getDailyRow = (date) => {
    if (!dailyMap[date]) dailyMap[date] = { date, totalCalls: 0, leadsSubmitted: 0, carriersActivated: 0 };
    return dailyMap[date];
  };
  callMetrics.logs.forEach((log) => {
    statusBreakdown[log.statusTo] = (statusBreakdown[log.statusTo] || 0) + 1;
    getDailyRow(dateBucket(log.timestamp)).totalCalls += 1;
  });
  submissions.forEach((lead) => { getDailyRow(dateBucket(lead.submittedAt)).leadsSubmitted += 1; });
  activations.forEach((carrier) => { getDailyRow(dateBucket(carrier.activatedAt)).carriersActivated += 1; });
  const dailyBreakdown = Object.values(dailyMap).sort((left, right) => right.date.localeCompare(left.date));

  res.json({ success: true, data: {
    month: monthStr,
    agentId,
    totalCalls: callMetrics.total,
    leadsSubmitted: submissions.length,
    carriersActivated: activations.length,
    statusBreakdown,
    dailyBreakdown,
  } });
});

export const getAgentPerformanceReport = asyncHandler(async (req, res) => {
  const { date, startDate, endDate, agentId } = req.query;
  const startWindow = dateBucketWindow(startDate || date || today());
  const endWindow = dateBucketWindow(endDate || startDate || date || today());
  const start = startWindow.start;
  const end = endWindow.end;
  const agentQuery = { role: 'sales_agent', isActive: true };
  if (agentId) agentQuery._id = agentId;
  const agents = await User.find(agentQuery).select('name email role avatar').sort({ name: 1 });
  const agentIds = agents.map((agent) => agent._id);
  const [callMetrics, logs, submissions] = await Promise.all([
    aggregateCallCounts({ agentIds, start, end }),
    CarrierActivityLog.find({ agentId: { $in: agentIds }, timestamp: { $gte: start, $lt: end } })
      .sort({ timestamp: 1, _id: 1 }).lean(),
    getLeadSubmissionEvents({ agentIds, start, end }),
  ]);

  const reportMap = {};
  agents.forEach((agent) => {
    const id = String(agent._id);
    reportMap[id] = {
      agent,
      totalCalls: callMetrics.byAgent.get(id) || 0,
      interestedCount: 0,
      verySeriousCount: 0,
      leadsSubmitted: 0,
      statusBreakdown: {},
    };
  });
  submissions.forEach((lead) => {
    const row = reportMap[String(lead.submittedByAgentId)];
    if (row) row.leadsSubmitted += 1;
  });
  const latestStatuses = new Map();
  logs.forEach((log) => latestStatuses.set(`${log.agentId}:${log.carrierId}`, log));
  latestStatuses.forEach((log) => {
    const row = reportMap[String(log.agentId)];
    if (!row) return;
    if (log.statusTo === 'Interested') row.interestedCount += 1;
    if (log.statusTo === 'Very Serious') row.verySeriousCount += 1;
    row.statusBreakdown[log.statusTo] = (row.statusBreakdown[log.statusTo] || 0) + 1;
  });
  res.json({ success: true, data: Object.values(reportMap) });
});

export const getActivityDrilldown = asyncHandler(async (req, res) => {
  const { agentId, date, startDate, endDate } = req.query;
  if (!agentId) {
    res.status(400);
    throw new Error('agentId is required for drilldown');
  }
  const startWindow = dateBucketWindow(startDate || date || today());
  const endWindow = dateBucketWindow(endDate || startDate || date || today());
  const logs = await CarrierActivityLog.find({ agentId, timestamp: { $gte: startWindow.start, $lt: endWindow.end } })
    .populate('carrierId', 'companyName mcNumber phone city state currentStatus detailsAdded')
    .sort({ timestamp: -1 });
  res.json({ success: true, count: logs.length, data: logs });
});

export const sendQuickLeadMessage = asyncHandler(async (req, res) => {
  const {
    truckType,
    trailerLength,
    emptyZip,
    maxWeightCapacity,
    partialCapacity,
    preferredLanes,
    note,
    alsoSaveToLead = true,
  } = req.body;
  if (!truckType || (!emptyZip && !maxWeightCapacity)) {
    res.status(400);
    throw new Error('Please provide Truck Type and at least one of Empty ZIP or Max Weight Capacity.');
  }

  const lead = await CarrierLead.findById(req.params.id);
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }
  const lines = ['[QUICK LEAD DISPATCH]'];
  if (lead.companyName) lines.push(`Company: ${lead.companyName}`);
  if (lead.mcNumber) lines.push(`MC: ${formatMc(lead.mcNumber)}`);
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (truckType) lines.push(`Truck Type: ${truckType}`);
  if (trailerLength) lines.push(`Trailer Length: ${trailerLength}`);
  if (emptyZip) lines.push(`Empty Location (ZIP): ${emptyZip}`);
  if (maxWeightCapacity) lines.push(`Max Weight: ${maxWeightCapacity} lbs`);
  if (partialCapacity) lines.push(`Partial: ${partialCapacity}`);
  if (preferredLanes) lines.push(`Preferred Lanes: ${preferredLanes}`);
  if (note) lines.push(`Note: ${note}`);
  const content = lines.join('\n');

  const senderId = req.user._id;
  const senderRole = req.user.role;
  let conversation = await Conversation.findOne({ participantId: senderId });
  if (!conversation) {
    conversation = await Conversation.create({
      participantId: senderId,
      lastMessageAt: new Date(),
      lastMessagePreview: content,
      unreadCountAdmin: senderRole === 'admin' ? 0 : 1,
      unreadCountParticipant: senderRole === 'admin' ? 1 : 0,
      deletedFor: [],
    });
  } else {
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = content;
    if (senderRole === 'admin') conversation.unreadCountParticipant = (conversation.unreadCountParticipant || 0) + 1;
    else conversation.unreadCountAdmin = (conversation.unreadCountAdmin || 0) + 1;
    conversation.deletedFor = [];
    await conversation.save();
  }

  const newMessage = await Message.create({
    conversationId: conversation._id,
    senderId,
    type: 'text',
    content,
    status: 'sent',
    reactions: [],
    deletedFor: [],
  });
  const populatedMessage = await Message.findById(newMessage._id)
    .populate('senderId', 'name email avatar role')
    .populate('reactions.userId', 'name avatar role');
  emitSocketEvent(`conversation:${conversation._id}`, 'message:new', populatedMessage);
  emitSocketEvent(`user:${conversation.participantId}`, 'message:new', populatedMessage);
  emitSocketEvent('admin_chat_updates', 'message:new', populatedMessage);
  emitSocketEvent('admin_chat_updates', 'conversation:update', {
    conversationId: conversation._id,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    unreadCountAdmin: conversation.unreadCountAdmin,
    participantId: conversation.participantId,
    message: populatedMessage,
  });

  if (alsoSaveToLead) {
    lead.detailsAdded = true;
    if (truckType) lead.truckDetails.truckType = truckType;
    if (trailerLength) lead.truckDetails.trailerLength = trailerLength;
    if (emptyZip) lead.truckDetails.currentZip = emptyZip;
    if (maxWeightCapacity) lead.truckDetails.maxWeightCapacity = parseLeadNumber(maxWeightCapacity) || lead.truckDetails.maxWeightCapacity;
    if (preferredLanes) {
      lead.truckDetails.preferences.lanePreference = 'Custom';
      lead.truckDetails.preferences.lanePreferenceCustom = preferredLanes;
    }
    if (note) lead.truckDetails.notes = [lead.truckDetails.notes, note].filter(Boolean).join('\n');
  }

  const sentAt = new Date();
  lead.quickMessageSentAt = sentAt;
  await lead.save();
  res.json({
    success: true,
    message: 'Quick lead message sent successfully to DKR Live Chat',
    quickMessageSentAt: sentAt,
    data: { leadId: lead._id, quickMessageSentAt: sentAt, conversationId: conversation._id, messageId: newMessage._id },
  });
});
