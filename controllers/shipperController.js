import asyncHandler from 'express-async-handler';
import Shipper from '../models/Shipper.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';

// Escapes user input before using it in a RegExp so search text like "a+b" is treated literally.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @route   POST /api/shippers/public-quote
 * @desc    Public website shipper quote form submission
 * @access  Public
 */
export const publicCreateShipper = asyncHandler(async (req, res) => {
  const parseLocation = (value) => {
    const text = String(value || '').trim();
    if (!text) return { city: '', state: '' };
    const lastComma = text.lastIndexOf(',');
    if (lastComma === -1) return { city: text, state: '' };
    return {
      city: text.slice(0, lastComma).trim(),
      state: text.slice(lastComma + 1).trim(),
    };
  };

  const rawOrigin = req.body.originCity || req.body.origin;
  const rawDestination = req.body.destinationCity || req.body.destination;
  const origin = parseLocation(rawOrigin);
  const destination = parseLocation(rawDestination);

  const {
    companyName,
    contactName,
    email,
    phone,
    commodity,
    haulingServiceType,
    totalWeight,
    dimensions,
    preferredShipDate,
    specialHandlingNotes,
  } = req.body;

  if (!companyName || !companyName.trim()) {
    return error(res, 400, 'Company name is required');
  }

  if (!contactName || !contactName.trim()) {
    return error(res, 400, 'Contact name is required');
  }

  if (!email || !email.trim()) {
    return error(res, 400, 'Email is required');
  }

  if (!phone || !phone.trim()) {
    return error(res, 400, 'Phone is required');
  }

  const shipper = await Shipper.create({
    companyName: companyName.trim(),
    contactName: contactName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    commodity: commodity?.trim() || '',
    haulingServiceType: haulingServiceType || 'Dry Van',
    originCity: (req.body.originCity || origin.city || '').trim(),
    originState: (req.body.originState || origin.state || '').trim(),
    destinationCity: (req.body.destinationCity || destination.city || '').trim(),
    destinationState: (req.body.destinationState || destination.state || '').trim(),
    totalWeight: totalWeight?.trim() || '',
    dimensions: dimensions?.trim() || '',
    preferredShipDate: preferredShipDate ? new Date(preferredShipDate) : null,
    specialHandlingNotes: specialHandlingNotes?.trim() || '',
    status: 'new',
  });

  // Trigger admin notification for new shipper quote request
  await createNotification({
    type: 'shipper_quote',
    title: 'New Freight Quote Request',
    message: `${shipper.companyName} (${shipper.contactName}) - ${shipper.haulingServiceType}`,
    referenceId: shipper._id,
    relatedModel: 'Shipper',
  });

  return success(res, 201, shipper, 'Quote request received');
});

/**
 * @route   GET /api/shippers
 * @desc    List shippers, filterable by haulingServiceType, originState, destinationState, status, and search
 * @access  Private/Admin
 */
export const getShippers = asyncHandler(async (req, res) => {
  const {
    haulingServiceType,
    originState,
    destinationState,
    status,
    search,
  } = req.query;

  const query = {};
  if (haulingServiceType) query.haulingServiceType = haulingServiceType;
  if (originState) query.originState = originState;
  if (destinationState) query.destinationState = destinationState;
  if (status) query.status = status;

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    query.$or = [
      { companyName: re },
      { contactName: re },
      { email: re },
      { phone: re },
      { commodity: re },
    ];
  }

  const shippers = await Shipper.find(query)
    .populate('assignedAgent', 'name email')
    .sort('-createdAt');

  return success(res, 200, shippers, 'Shippers retrieved');
});

/**
 * @route   GET /api/shippers/:id
 * @desc    Get a single shipper
 * @access  Private/Admin
 */
export const getShipper = asyncHandler(async (req, res) => {
  const shipper = await Shipper.findById(req.params.id).populate(
    'assignedAgent',
    'name email'
  );
  if (!shipper) return error(res, 404, 'Shipper not found');

  return success(res, 200, shipper, 'Shipper retrieved');
});

/**
 * @route   POST /api/shippers
 * @desc    Create a shipper (admin manual entry)
 * @access  Private/Admin
 */
export const createShipper = asyncHandler(async (req, res) => {
  const {
    companyName,
    contactName,
    email,
    phone,
    commodity,
    haulingServiceType,
    originCity,
    originState,
    destinationCity,
    destinationState,
    totalWeight,
    dimensions,
    preferredShipDate,
    specialHandlingNotes,
    status,
    quoteAmount,
    internalNotes,
    assignedAgent,
  } = req.body;

  if (!companyName || !companyName.trim()) {
    return error(res, 400, 'Company name is required');
  }

  const shipper = await Shipper.create({
    companyName: companyName.trim(),
    contactName: contactName?.trim() || '',
    email: email?.trim().toLowerCase() || '',
    phone: phone?.trim() || '',
    commodity: commodity?.trim() || '',
    haulingServiceType: haulingServiceType || 'Dry Van',
    originCity: originCity?.trim() || '',
    originState: originState?.trim() || '',
    destinationCity: destinationCity?.trim() || '',
    destinationState: destinationState?.trim() || '',
    totalWeight: totalWeight?.trim() || '',
    dimensions: dimensions?.trim() || '',
    preferredShipDate: preferredShipDate ? new Date(preferredShipDate) : null,
    specialHandlingNotes: specialHandlingNotes?.trim() || '',
    status: status || 'new',
    quoteAmount: quoteAmount || null,
    quotedDate: quoteAmount ? new Date() : null,
    internalNotes: internalNotes?.trim() || '',
    assignedAgent: assignedAgent || null,
  });

  await shipper.populate('assignedAgent', 'name email');
  return success(res, 201, shipper, 'Shipper created');
});

/**
 * @route   PATCH /api/shippers/:id
 * @desc    Update a shipper
 * @access  Private/Admin
 */
export const updateShipper = asyncHandler(async (req, res) => {
  const shipper = await Shipper.findById(req.params.id);
  if (!shipper) return error(res, 404, 'Shipper not found');

  const {
    companyName,
    contactName,
    email,
    phone,
    commodity,
    haulingServiceType,
    originCity,
    originState,
    destinationCity,
    destinationState,
    totalWeight,
    dimensions,
    preferredShipDate,
    specialHandlingNotes,
    status,
    quoteAmount,
    internalNotes,
    assignedAgent,
  } = req.body;

  if (companyName !== undefined) shipper.companyName = companyName.trim();
  if (contactName !== undefined) shipper.contactName = contactName.trim();
  if (email !== undefined) shipper.email = email.trim().toLowerCase();
  if (phone !== undefined) shipper.phone = phone.trim();
  if (commodity !== undefined) shipper.commodity = commodity.trim();
  if (haulingServiceType !== undefined) shipper.haulingServiceType = haulingServiceType;
  if (originCity !== undefined) shipper.originCity = originCity.trim();
  if (originState !== undefined) shipper.originState = originState.trim();
  if (destinationCity !== undefined) shipper.destinationCity = destinationCity.trim();
  if (destinationState !== undefined) shipper.destinationState = destinationState.trim();
  if (totalWeight !== undefined) shipper.totalWeight = totalWeight.trim();
  if (dimensions !== undefined) shipper.dimensions = dimensions.trim();
  if (preferredShipDate !== undefined) shipper.preferredShipDate = preferredShipDate ? new Date(preferredShipDate) : null;
  if (specialHandlingNotes !== undefined) shipper.specialHandlingNotes = specialHandlingNotes.trim();
  if (status !== undefined) shipper.status = status;
  if (quoteAmount !== undefined) {
    shipper.quoteAmount = quoteAmount;
    if (quoteAmount && !shipper.quotedDate) {
      shipper.quotedDate = new Date();
    }
  }
  if (internalNotes !== undefined) shipper.internalNotes = internalNotes.trim();
  if (assignedAgent !== undefined) shipper.assignedAgent = assignedAgent || null;

  await shipper.save();
  await shipper.populate('assignedAgent', 'name email');
  return success(res, 200, shipper, 'Shipper updated');
});

/**
 * @route   DELETE /api/shippers/:id
 * @desc    Delete a shipper
 * @access  Private/Admin
 */
export const deleteShipper = asyncHandler(async (req, res) => {
  const shipper = await Shipper.findById(req.params.id);
  if (!shipper) return error(res, 404, 'Shipper not found');

  await Shipper.deleteOne({ _id: req.params.id });
  return success(res, 200, null, 'Shipper deleted');
});

/**
 * @route   POST /api/shippers/bulk-delete
 * @desc    Delete multiple shippers
 * @access  Private/Admin
 */
export const bulkDeleteShippers = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(res, 400, 'No shipper IDs provided');
  }

  const result = await Shipper.deleteMany({ _id: { $in: ids } });
  return success(res, 200, { deletedCount: result.deletedCount }, 'Shippers deleted');
});
