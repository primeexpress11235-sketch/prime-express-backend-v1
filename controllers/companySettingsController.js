import asyncHandler from 'express-async-handler';
import CompanySettings from '../models/CompanySettings.js';
import { success } from '../utils/sendResponse.js';

/**
 * @route   GET /api/company-settings
 * @desc    Get company contact info settings
 * @access  Private (Any authenticated user: Admin, Dispatcher, Sales Agent)
 */
export const getCompanySettings = asyncHandler(async (req, res) => {
  const settings = await CompanySettings.getSettings();
  return success(
    res,
    200,
    {
      phone: settings.phone || '',
      address: settings.address || '',
      officialEmail: settings.officialEmail || '',
      legalEntityName: settings.legalEntityName || '',
      website: settings.website || '',
      paymentMethodLabel: settings.paymentMethodLabel || '',
      paymentDetails: Array.isArray(settings.paymentDetails) ? settings.paymentDetails : [],
      updatedAt: settings.updatedAt || null,
    },
    'Company settings retrieved successfully'
  );
});

/**
 * @route   PUT /api/company-settings
 * @desc    Update company contact info settings
 * @access  Private (Admin only)
 */
export const updateCompanySettings = asyncHandler(async (req, res) => {
  const {
    phone = '',
    address = '',
    officialEmail = '',
    legalEntityName = '',
    website = '',
    paymentMethodLabel = '',
    paymentDetails = [],
  } = req.body;

  let sanitizedPaymentDetails = [];
  if (Array.isArray(paymentDetails)) {
    sanitizedPaymentDetails = paymentDetails
      .filter((item) => item && (item.label || item.value))
      .map((item) => ({
        label: String(item.label || '').trim(),
        value: String(item.value || '').trim(),
      }));
  }

  let settings = await CompanySettings.findOne();
  if (!settings) {
    settings = new CompanySettings({
      phone: String(phone || '').trim(),
      address: String(address || '').trim(),
      officialEmail: String(officialEmail || '').trim(),
      legalEntityName: String(legalEntityName || '').trim(),
      website: String(website || '').trim(),
      paymentMethodLabel: String(paymentMethodLabel || '').trim(),
      paymentDetails: sanitizedPaymentDetails,
      updatedBy: req.user?._id,
    });
  } else {
    settings.phone = String(phone || '').trim();
    settings.address = String(address || '').trim();
    settings.officialEmail = String(officialEmail || '').trim();
    settings.legalEntityName = String(legalEntityName || '').trim();
    settings.website = String(website || '').trim();
    settings.paymentMethodLabel = String(paymentMethodLabel || '').trim();
    settings.paymentDetails = sanitizedPaymentDetails;
    settings.updatedBy = req.user?._id;
  }

  await settings.save();

  return success(
    res,
    200,
    {
      phone: settings.phone,
      address: settings.address,
      officialEmail: settings.officialEmail,
      legalEntityName: settings.legalEntityName,
      website: settings.website,
      paymentMethodLabel: settings.paymentMethodLabel,
      paymentDetails: settings.paymentDetails,
      updatedAt: settings.updatedAt,
    },
    'Company settings updated successfully'
  );
});
