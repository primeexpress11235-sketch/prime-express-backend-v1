import asyncHandler from 'express-async-handler';
import Inquiry from '../models/Inquiry.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';

/**
 * @route   POST /api/inquiries
 * @desc    Store a public website lead/contact form submission
 * @access  Public
 */
export const createInquiry = asyncHandler(async (req, res) => {
  const { type, name, email, phone, truckType, authorityAge, message } = req.body;

  if (!name || !email) {
    return error(res, 400, 'Name and email are required');
  }

  const inquiry = await Inquiry.create({
    type: type === 'contact' ? 'contact' : 'lead',
    name,
    email,
    phone,
    truckType,
    authorityAge,
    message,
  });

  const msgPreview = message ? (message.length > 50 ? `${message.substring(0, 50)}...` : message) : 'No message body';

  await createNotification({
    type: 'contact_us',
    title: 'New Contact Message',
    message: `${name} (${email}): ${msgPreview}`,
    referenceId: inquiry._id,
    relatedModel: 'Inquiry',
  });

  return success(res, 201, { id: inquiry._id }, 'Inquiry received');
});

/**
 * @route   GET /api/inquiries
 * @desc    List website inquiries (newest first), optional ?type & ?status
 * @access  Private/Admin
 */
export const getInquiries = asyncHandler(async (req, res) => {
  const { type, status } = req.query;
  const query = {};
  if (type) query.type = type;
  if (status) query.status = status;

  const inquiries = await Inquiry.find(query).sort({ createdAt: -1 });

  return success(res, 200, inquiries, 'Inquiries retrieved');
});

/**
 * @route   GET /api/inquiries/:id
 * @desc    Get single inquiry by ID
 * @access  Private/Admin
 */
export const getInquiryById = asyncHandler(async (req, res) => {
  const inquiry = await Inquiry.findById(req.params.id);
  if (!inquiry) {
    return error(res, 404, 'Inquiry not found');
  }
  return success(res, 200, inquiry, 'Inquiry retrieved');
});

export default { createInquiry, getInquiries, getInquiryById };
