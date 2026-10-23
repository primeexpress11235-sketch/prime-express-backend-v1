import asyncHandler from 'express-async-handler';
import Document from '../models/Document.js';
import Carrier from '../models/Carrier.js';
import Load from '../models/Load.js';
import User from '../models/User.js';
import CompanySettings from '../models/CompanySettings.js';
import { COMPANY_DETAILS, STANDARD_RATES } from '../config/companyConfig.js';
import { generateAndSaveDocument } from '../services/pdfService.js';
import { deleteDocFromCloudinary } from '../services/cloudinaryDocService.js';
import { success, error } from '../utils/sendResponse.js';
import { formatMc } from '../utils/formatMc.js';
import { createNotification } from '../utils/notificationHelper.js';
import { createAdminNotification } from '../utils/adminNotificationHelper.js';
import { dateBucket, TIME_ZONE } from '../utils/performanceDates.js';

/**
 * Format a date nicely as "MMM DD, YYYY"
 */
const formatDate = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
};

/**
 * Helper to zero-pad numbers
 */
const padZero = (num, places = 2) => String(num).padStart(places, '0');

/**
 * Generate invoice document number as DKR-{YYMMDD}-{sequence}
 */
const getNextInvoiceNumber = async () => {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = padZero(now.getMonth() + 1);
  const dd = padZero(now.getDate());
  const datePrefix = `DKR-${yy}${mm}${dd}`;

  // Count existing invoices generated today with prefix
  const count = await Document.countDocuments({
    type: 'invoice',
    documentNumber: new RegExp(`^${datePrefix}`),
  });

  const seq = padZero(count + 1, 3);
  return `${datePrefix}-${seq}`;
};

/**
 * @route   GET /api/documents
 * @desc    Get generated documents with optional type filter and search
 * @access  Private (Admin)
 */
export const getDocuments = asyncHandler(async (req, res) => {
  const { type, search } = req.query;

  const query = {};
  if (type && ['invoice', 'carrier_agreement', 'agent_contract'].includes(type)) {
    query.type = type;
  }

  let carrierMCs = [];
  let agentIds = [];

  if (search && search.trim()) {
    const s = search.trim();
    const searchRegex = new RegExp(s, 'i');

    // Find carriers matching companyName, mcNumber, or contactName
    const matchingCarriers = await Carrier.find({
      $or: [
        { companyName: searchRegex },
        { mcNumber: searchRegex },
        { contactName: searchRegex },
      ],
    }).select('mcNumber');
    carrierMCs = matchingCarriers.map((c) => c.mcNumber).filter(Boolean);

    // Find sales agents matching name or email
    const matchingAgents = await User.find({
      $or: [{ name: searchRegex }, { email: searchRegex }],
    }).select('_id');
    agentIds = matchingAgents.map((a) => a._id);

    query.$or = [
      { documentNumber: searchRegex },
      { fileName: searchRegex },
      { relatedCarrierMC: searchRegex },
      { relatedCarrierMC: { $in: carrierMCs } },
      { relatedAgentId: { $in: agentIds } },
    ];
  }

  const documents = await Document.find(query)
    .sort({ generatedAt: -1 })
    .populate('relatedAgentId', 'name email cnic')
    .populate('generatedBy', 'name email')
    .lean();

  // Enhance documents with carrier info if relatedCarrierMC is present
  const allMCs = Array.from(new Set(documents.map((d) => d.relatedCarrierMC).filter(Boolean)));
  const carrierMap = new Map();
  if (allMCs.length > 0) {
    const carriers = await Carrier.find({ mcNumber: { $in: allMCs } }).select(
      'companyName mcNumber dotNumber contactName contactPhone contactEmail address'
    );
    carriers.forEach((c) => carrierMap.set(c.mcNumber, c));
  }

  const enhanced = documents.map((doc) => {
    const carrier = doc.relatedCarrierMC ? carrierMap.get(doc.relatedCarrierMC) : null;
    return {
      ...doc,
      carrier: carrier || doc.metadata?.carrier || null,
      agent: doc.relatedAgentId || doc.metadata?.agent || null,
    };
  });

  return success(res, 200, enhanced, 'Documents retrieved successfully');
});

/**
 * @route   GET /api/documents/carrier-docs
 * @desc    Aggregate all carrier-uploaded documents from Carrier.documents across carriers
 * @access  Private (Admin)
 */
export const getCarrierUploadedDocs = asyncHandler(async (req, res) => {
  const { search } = req.query;

  const carrierQuery = { 'documents.0': { $exists: true } };

  if (search && search.trim()) {
    const s = search.trim();
    const searchRegex = new RegExp(s, 'i');
    carrierQuery.$or = [
      { companyName: searchRegex },
      { mcNumber: searchRegex },
      { contactName: searchRegex },
      { 'documents.originalFileName': searchRegex },
    ];
  }

  const carriers = await Carrier.find(carrierQuery)
    .select('companyName mcNumber dotNumber contactName contactPhone contactEmail documents updatedAt')
    .lean();

  const searchFilter = search ? new RegExp(search.trim(), 'i') : null;
  const list = [];

  for (const carrier of carriers) {
    for (const doc of carrier.documents || []) {
      const match =
        !searchFilter ||
        searchFilter.test(carrier.companyName || '') ||
        searchFilter.test(carrier.mcNumber || '') ||
        searchFilter.test(carrier.contactName || '') ||
        searchFilter.test(doc.originalFileName || '');

      if (match) {
        list.push({
          _id: doc._id,
          carrierId: carrier._id,
          carrierCompanyName: carrier.companyName,
          carrierMC: carrier.mcNumber,
          carrierDOT: carrier.dotNumber,
          carrierContact: carrier.contactName,
          carrierEmail: carrier.contactEmail,
          carrierPhone: carrier.contactPhone,
          originalFileName: doc.originalFileName || doc.label || 'Carrier Document',
          fileUrl: doc.cloudinaryUrl || doc.url,
          type: doc.type || 'other',
          uploadedAt: doc.uploadedAt || carrier.updatedAt,
        });
      }
    }
  }

  list.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  return success(res, 200, list, 'Carrier uploaded documents retrieved successfully');
});

/**
 * @route   POST /api/documents/invoices/generate
 * @desc    Generate an invoice PDF, upload to Cloudinary, save Document record, and update Load statuses
 * @access  Private (Admin)
 */
export const generateInvoice = asyncHandler(async (req, res) => {
  const {
    carrierId,
    invoiceDate,
    dueDate,
    loadIds = [],
    feePlan: inputFeePlan,
    truckType: inputTruckType,
    rate: inputRate,
    paymentMethodLabel: inputPaymentMethodLabel,
    paymentDetails: inputPaymentDetails,
  } = req.body;

  if (!carrierId) {
    return error(res, 400, 'Please provide a carrierId');
  }

  const carrier = await Carrier.findById(carrierId);
  if (!carrier) {
    return error(res, 404, 'Carrier not found');
  }

  if (!Array.isArray(loadIds) || loadIds.length === 0) {
    return error(res, 400, 'Please select at least one load to include in this invoice');
  }

  // Fetch selected loads
  const loads = await Load.find({ _id: { $in: loadIds }, carrier: carrier._id })
    .sort({ pickupDate: 1, createdAt: 1 })
    .lean();

  if (loads.length === 0) {
    return error(res, 400, 'None of the selected loads belong to the selected carrier');
  }

  // 1. Determine Carrier's billing plan from existing Carrier-Dispatcher Agreement record or request
  const agreement = await Document.findOne({
    type: 'carrier_agreement',
    $or: [
      { relatedCarrierMC: carrier.mcNumber },
      { 'metadata.carrierId': carrier._id },
    ],
  }).sort({ generatedAt: -1 });

  const isSemi = !carrier.truckType || (!carrier.truckType.toLowerCase().includes('box') && !carrier.truckType.toLowerCase().includes('hotshot'));
  const feePlan = inputFeePlan || agreement?.metadata?.feePlan || 'percentage';
  const truckType = inputTruckType || agreement?.metadata?.truckType || (isSemi ? 'Semi' : 'Non-Semi');

  const defaultRate = truckType === 'Non-Semi'
    ? STANDARD_RATES.non_semi.percentage
    : STANDARD_RATES.semi.percentage;

  const numericRate = inputRate !== undefined && inputRate !== ''
    ? Number(inputRate)
    : (agreement?.metadata?.rate !== undefined && agreement?.metadata?.rate !== null ? Number(agreement.metadata.rate) : defaultRate);

  const isFlatRatePlan = feePlan === 'flat';

  // 2. Process each selected load and calculate fees (NO FREE LOAD)
  let totalGross = 0;
  let dispatchFeeTotal = 0;

  const processedLoads = loads.map((l) => {
    const gross = Number(l.rate) || 0;
    totalGross += gross;

    let loadFee = 0;
    if (!isFlatRatePlan) {
      loadFee = Number(((gross * numericRate) / 100).toFixed(2));
      dispatchFeeTotal += loadFee;
    }

    return {
      ...l,
      grossRateNum: gross,
      dispatchFeeNum: loadFee,
      isFreeLoad: false,
    };
  });

  let totalDue = 0;
  if (isFlatRatePlan) {
    dispatchFeeTotal = numericRate;
    totalDue = numericRate;
  } else {
    totalDue = Number(dispatchFeeTotal.toFixed(2));
  }

  // Determine billing week date range
  const validPickupDates = loads.map((l) => (l.pickupDate ? new Date(l.pickupDate) : null)).filter(Boolean);
  const minPickup = validPickupDates.length > 0 ? new Date(Math.min(...validPickupDates)) : new Date();
  const maxPickup = validPickupDates.length > 0 ? new Date(Math.max(...validPickupDates)) : new Date();

  // Invoice Number
  const invoiceNumber = await getNextInvoiceNumber();

  // Dates
  const invDateObj = invoiceDate ? new Date(invoiceDate) : new Date();
  const dueDateObj = dueDate
    ? new Date(dueDate)
    : new Date(invDateObj.getTime() + 24 * 60 * 60 * 1000);

  const feePlanLabel = isFlatRatePlan
    ? `Flat Weekly Rate ($${numericRate} per week)`
    : `Percentage of Gross Rate (${numericRate}%)`;

  const feePlanAppliedLabel = isFlatRatePlan
    ? `Flat Weekly Rate ($${numericRate.toFixed(2)} per week)`
    : `${numericRate}% of gross revenue`;

  const templateLoads = processedLoads.map((l) => ({
    loadRef: l.loadRef || l.commodity || l.trip || `LD-${String(l._id).slice(-6).toUpperCase()}`,
    pickupDate: formatDate(l.pickupDate),
    origin: l.pickupLocation || 'Origin on file',
    destination: l.deliveryLocation || 'Destination on file',
    broker: l.broker || 'Direct / Spot',
    grossRate: l.grossRateNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    dispatchFee: l.dispatchFeeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }));

  const savedCompanySettings = await CompanySettings.getSettings();
  const legalEntityName = savedCompanySettings.legalEntityName || COMPANY_DETAILS.legalEntityName || 'DKR Trucking LLC';
  const companyAddress = savedCompanySettings.address || COMPANY_DETAILS.address || '';
  const companyPhone = savedCompanySettings.phone || COMPANY_DETAILS.phone || '';
  const companyEmail = savedCompanySettings.officialEmail || COMPANY_DETAILS.email || 'info@dkrtrucking.com';
  const companyWebsite = savedCompanySettings.website || COMPANY_DETAILS.website || 'dkrtrucking.com';

  const paymentMethodLabel = inputPaymentMethodLabel !== undefined
    ? inputPaymentMethodLabel
    : (savedCompanySettings.paymentMethodLabel || '');

  const paymentDetails = Array.isArray(inputPaymentDetails)
    ? inputPaymentDetails
    : (Array.isArray(savedCompanySettings.paymentDetails) ? savedCompanySettings.paymentDetails : []);

  const templateData = {
    company: {
      ...COMPANY_DETAILS,
      legalEntityName,
      address: companyAddress,
      phone: companyPhone,
      email: companyEmail,
      website: companyWebsite,
    },
    legalEntityName,
    companyAddress,
    companyEmail,
    companyPhone,
    companyWebsite,
    paymentMethodLabel,
    paymentDetails,
    latePaymentTerms: COMPANY_DETAILS.latePaymentTerms || '',
    invoiceNumber,
    invoiceDate: formatDate(invDateObj),
    dueDate: formatDate(dueDateObj),
    isSample: false,
    carrierName: carrier.companyName || 'Valued Carrier',
    mcNumber: formatMc(carrier.mcNumber) || 'N/A',
    dotNumber: carrier.dotNumber || 'N/A',
    carrierAddress: carrier.address || 'Address on file',
    contactName: carrier.contactName || 'Carrier Dispatch',
    contactEmail: carrier.contactEmail || '—',
    contactPhone: carrier.contactPhone || '—',
    truckType,
    feePlanLabel,
    feePlanAppliedLabel,
    billingPeriodStart: formatDate(minPickup),
    billingPeriodEnd: formatDate(maxPickup),
    isFlatRatePlan,
    loads: templateLoads,
    loadCount: loads.length,
    grossRevenueTotal: totalGross.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    dispatchFeeTotal: dispatchFeeTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    totalDue: totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };

  const safeCarrierName = (carrier.companyName || 'Carrier').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Invoice_${invoiceNumber}_${safeCarrierName}.pdf`;

  // Generate and save document
  const docRecord = await generateAndSaveDocument({
    type: 'invoice',
    templateName: 'invoice-template',
    data: templateData,
    documentNumber: invoiceNumber,
    fileName,
    relatedCarrierMC: carrier.mcNumber,
    generatedBy: req.user?._id,
    metadata: {
      carrierId: carrier._id,
      carrierCompanyName: carrier.companyName,
      carrierMC: carrier.mcNumber,
      carrierEmail: carrier.contactEmail,
      carrierPhone: carrier.contactPhone,
      truckType,
      feePlan,
      rate: numericRate,
      grossRevenue: totalGross,
      dispatchFeeTotal,
      totalDue,
      loadCount: loads.length,
      loadIds: loads.map((l) => l._id),
      billingPeriodStart: minPickup,
      billingPeriodEnd: maxPickup,
      invoiceDate: invDateObj,
      dueDate: dueDateObj,
      paymentMethodLabel,
      paymentDetails,
    },
  });

  // Update status and invoice reference on each included load
  for (const l of processedLoads) {
    await Load.findByIdAndUpdate(l._id, {
      status: 'invoiced',
      invoice: docRecord._id,
      invoiceNumber: invoiceNumber,
      invoicedAt: new Date(),
      invoiceDate: invDateObj,
      dispatchFee: l.dispatchFeeNum,
      isFirstFreeLoad: false,
    });
  }

  return success(
    res,
    201,
    {
      document: docRecord,
      carrier: {
        companyName: carrier.companyName,
        email: carrier.contactEmail || '',
        mcNumber: carrier.mcNumber,
      },
      invoiceNumber,
      totalDue,
      loadCount: loads.length,
    },
    'Invoice generated successfully and loads updated to Invoiced'
  );
});

/**
 * @route   POST /api/documents/carrier-agreements/generate
 * @desc    Generate a Carrier-Dispatcher Agreement PDF, upload to Cloudinary, and save Document record
 * @access  Private (Admin)
 */
export const generateCarrierAgreement = asyncHandler(async (req, res) => {
  const {
    carrierId,
    feePlan = 'percentage', // 'percentage' | 'flat'
    truckType = 'Semi', // 'Semi' | 'Non-Semi'
    rate,
    phone: inputPhone,
    address: inputAddress,
    officialEmail: inputOfficialEmail,
    saveDefaultSettings = false,
  } = req.body;

  if (!carrierId) {
    return error(res, 400, 'Please select a carrier');
  }

  const carrier = await Carrier.findById(carrierId);
  if (!carrier) {
    return error(res, 404, 'Carrier not found');
  }

  // Retrieve saved company settings as fallback if input fields were omitted
  const savedCompanySettings = await CompanySettings.getSettings();
  const phone = String(inputPhone !== undefined ? inputPhone : savedCompanySettings.phone || '').trim();
  const address = String(inputAddress !== undefined ? inputAddress : savedCompanySettings.address || '').trim();
  const officialEmail = String(inputOfficialEmail !== undefined ? inputOfficialEmail : savedCompanySettings.officialEmail || '').trim();
  const legalEntityName = savedCompanySettings.legalEntityName || COMPANY_DETAILS.legalEntityName || 'DKR Trucking LLC';
  const website = savedCompanySettings.website || COMPANY_DETAILS.website || 'dkrtrucking.com';

  if (!phone || !address || !officialEmail) {
    return error(
      res,
      400,
      'Company phone, physical address, and official email are required to generate an agreement.'
    );
  }

  // Update default company settings if requested
  if (saveDefaultSettings) {
    savedCompanySettings.phone = phone;
    savedCompanySettings.address = address;
    savedCompanySettings.officialEmail = officialEmail;
    savedCompanySettings.updatedBy = req.user?._id;
    await savedCompanySettings.save();
  }

  const isSemi = truckType !== 'Non-Semi';
  const defaultRate = isSemi
    ? STANDARD_RATES.semi.percentage
    : STANDARD_RATES.non_semi.percentage;

  const numericRate = rate !== undefined && rate !== '' ? Number(rate) : defaultRate;

  const rateValue = feePlan === 'flat' ? `$${numericRate}/week` : `${numericRate}% weekly`;
  const feePlanType = feePlan === 'flat' ? 'Flat Weekly Rate' : 'Percentage of Gross Load Rate';

  const company = {
    ...COMPANY_DETAILS,
    legalEntityName,
    phone,
    address,
    email: officialEmail,
    website,
  };

  const templateData = {
    company,
    carrier: {
      companyName: carrier.companyName || 'Valued Carrier',
      mcNumber: formatMc(carrier.mcNumber) || 'N/A',
      dotNumber: carrier.dotNumber || 'N/A',
    },
    feePlanType,
    truckType: isSemi ? 'Semi' : 'Non-Semi',
    rateValue,
  };

  const agreementNumber = `AGR-MC${carrier.mcNumber || 'NEW'}-${Date.now().toString().slice(-4)}`;
  const safeCarrierName = (carrier.companyName || 'Carrier').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Carrier_Agreement_${safeCarrierName}_MC${carrier.mcNumber || 'NA'}.pdf`;

  const docRecord = await generateAndSaveDocument({
    type: 'carrier_agreement',
    templateName: 'carrier-dispatcher-agreement-template',
    data: templateData,
    documentNumber: agreementNumber,
    fileName,
    relatedCarrierMC: carrier.mcNumber,
    generatedBy: req.user?._id,
    metadata: {
      carrierId: carrier._id,
      carrierCompanyName: carrier.companyName,
      carrierMC: carrier.mcNumber,
      carrierEmail: carrier.contactEmail || '',
      carrierPhone: carrier.contactPhone || '',
      companyPhone: phone,
      companyAddress: address,
      companyOfficialEmail: officialEmail,
      legalEntityName,
      website,
      feePlan,
      truckType: isSemi ? 'Semi' : 'Non-Semi',
      rate: numericRate,
      rateValue,
    },
  });

  return success(
    res,
    201,
    {
      document: docRecord,
      carrier: {
        companyName: carrier.companyName,
        email: carrier.contactEmail || '',
        mcNumber: carrier.mcNumber,
      },
    },
    'Carrier agreement generated successfully'
  );
});

/**
 * @route   POST /api/documents/carrier-agreements/bulk-delete
 * @desc    Bulk delete Carrier-Dispatcher Agreements and remove their PDF files from Cloudinary
 * @access  Private (Admin only)
 */
export const bulkDeleteCarrierAgreements = asyncHandler(async (req, res) => {
  const { documentIds } = req.body;

  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return error(res, 400, 'Please select at least one agreement to delete');
  }

  // Safety filter: ONLY match carrier_agreement documents! Invoices and agent contracts can NEVER be deleted.
  const agreements = await Document.find({
    _id: { $in: documentIds },
    type: 'carrier_agreement',
  });

  if (agreements.length === 0) {
    return error(res, 404, 'No matching carrier agreements found to delete');
  }

  let deletedCount = 0;

  for (const doc of agreements) {
    let publicId = doc.metadata?.cloudinaryPublicId || doc.cloudinaryPublicId;
    if (!publicId && doc.fileUrl) {
      const match = doc.fileUrl.match(/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
      if (match) {
        publicId = match[1];
      }
    }

    if (publicId) {
      try {
        await deleteDocFromCloudinary(publicId, doc.metadata?.resourceType || 'raw');
      } catch (err) {
        console.warn(`[bulkDeleteCarrierAgreements] Could not delete file ${publicId} from Cloudinary:`, err?.message || err);
      }
    }

    await doc.deleteOne();
    deletedCount++;
  }

  return success(
    res,
    200,
    { deletedCount },
    `Successfully deleted ${deletedCount} carrier agreement(s) and associated files.`
  );
});

export const getAdminAgentContracts = asyncHandler(async (req, res) => {
  const agents = await User.find({ role: 'sales_agent' })
    .select('name email cnic agreementAcceptedAt contractRequest contractVersions')
    .sort({ name: 1 })
    .lean();
  const documents = await Document.find({ type: 'agent_contract', relatedAgentId: { $in: agents.map((agent) => agent._id) } })
    .sort({ generatedAt: -1 })
    .lean();
  const documentsByAgent = new Map();
  documents.forEach((doc) => {
    const agentKey = String(doc.relatedAgentId);
    const versions = documentsByAgent.get(agentKey) || [];
    versions.push(doc);
    documentsByAgent.set(agentKey, versions);
  });

  const data = agents.map((agent) => {
    const versions = documentsByAgent.get(String(agent._id)) || [];
    const request = agent.contractRequest || { status: 'not_sent', sentAt: null, version: 0 };
    const hasLegacySignedVersion = versions.length > 0 || Boolean(agent.agreementAcceptedAt);
    const status = request.status === 'pending'
      ? 'pending'
      : request.status === 'signed' || hasLegacySignedVersion
      ? 'signed'
      : 'not_sent';
    return {
      agent: { _id: agent._id, name: agent.name, email: agent.email, cnic: agent.cnic || '' },
      status,
      contractRequest: request,
      sentAt: request.sentAt || null,
      signedAt: versions[0]?.metadata?.acceptedAt || versions[0]?.generatedAt || agent.agreementAcceptedAt || null,
      versions: versions.map((doc) => ({
        ...doc,
        version: Number(doc.metadata?.version) || 1,
        signedAt: doc.metadata?.acceptedAt || doc.generatedAt,
        cnic: doc.metadata?.cnic || agent.cnic || '',
      })),
    };
  });

  return success(res, 200, data, 'Sales agent contract statuses retrieved');
});

export const sendAgentContractRequest = asyncHandler(async (req, res) => {
  const { agentId, allUnsigned = false, resend = false } = req.body;
  if (!agentId && !allUnsigned) return error(res, 400, 'agentId or allUnsigned is required');

  const agents = allUnsigned
    ? await User.find({ role: 'sales_agent', isActive: { $ne: false } })
    : [await User.findOne({ _id: agentId, role: 'sales_agent' })];
  if (!agents.length || agents.some((agent) => !agent)) return error(res, 404, 'Sales agent not found');

  const sent = [];
  for (const agent of agents) {
    const request = agent.contractRequest || { status: 'not_sent', sentAt: null, version: 0 };
    const hasSignedVersion = (agent.contractVersions || []).length > 0 || Boolean(agent.agreementAcceptedAt);
    if (allUnsigned && (request.status === 'pending' || (hasSignedVersion && !resend))) continue;
    if (!allUnsigned && !resend && (request.status === 'pending' || hasSignedVersion)) {
      return error(res, 409, 'This agent already has a pending or signed contract. Use Resend to create a new version.');
    }

    const savedDocuments = await Document.find({ type: 'agent_contract', relatedAgentId: agent._id })
      .select('metadata.version generatedAt')
      .sort({ generatedAt: 1 })
      .lean();
    const highestSavedVersion = savedDocuments.reduce((highest, document, index) => (
      Math.max(highest, Number(document.metadata?.version) || index + 1)
    ), 0);
    const highestRecordedVersion = (agent.contractVersions || []).reduce(
      (highest, record) => Math.max(highest, Number(record.version) || 0),
      0
    );
    const version = Math.max(Number(request.version) || 0, highestSavedVersion, highestRecordedVersion) + 1;
    const sentAt = new Date();
    agent.contractRequest = { status: 'pending', sentAt, version };
    await agent.save();
    await createNotification({
      recipientId: agent._id,
      type: 'agent_contract_request',
      title: 'Sales agent contract requires your signature',
      message: `A new contract (version ${version}) is ready for your review and signature.`,
      referenceId: agent._id,
      relatedModel: 'User',
    });
    sent.push({ agentId: agent._id, version, sentAt });
  }

  return success(res, 200, { sent, count: sent.length }, 'Contract requests sent');
});

export const cancelAgentContractRequest = asyncHandler(async (req, res) => {
  const agent = await User.findOne({ _id: req.params.agentId, role: 'sales_agent' });
  if (!agent) return error(res, 404, 'Sales agent not found');
  if (agent.contractRequest?.status !== 'pending') return error(res, 409, 'Only pending contract requests can be cancelled');

  agent.contractRequest.status = 'not_sent';
  agent.contractRequest.sentAt = null;
  await agent.save();
  return success(res, 200, { agentId: agent._id, contractRequest: agent.contractRequest }, 'Contract request cancelled');
});

/**
 * @route   POST /api/documents/agent-contracts/accept
 * @desc    Sign the current admin-requested contract version and save its PDF.
 * @access  Private (Sales Agent)
 */
export const acceptAgentContract = asyncHandler(async (req, res) => {
  const { cnic, agreed, typedName, signatureImage } = req.body;
  if (req.user.role !== 'sales_agent') return error(res, 403, 'Only the assigned sales agent can sign this contract');
  const user = await User.findById(req.user._id);

  if (!user) {
    return error(res, 404, 'User not found');
  }

  if (!cnic || !cnic.trim()) {
    return error(res, 400, 'CNIC number is required');
  }
  if (agreed !== true) {
    return error(res, 400, 'Agreement acceptance is required');
  }
  if (user.contractRequest?.status !== 'pending') {
    return error(res, 409, 'There is no pending contract request to sign');
  }

  const cleanCnic = cnic.trim();
  const cleanTypedName = String(typedName || user.name || '').trim();
  const acceptedTimestamp = new Date();
  const version = Number(user.contractRequest.version) || 1;

  // Capture client IP and User Agent for audit trail
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '';
  const agentIp = String(rawIp).split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || '').trim();

  // Retrieve dynamic company settings for contract footer
  const savedCompanySettings = await CompanySettings.getSettings();
  const legalEntityName = savedCompanySettings.legalEntityName || COMPANY_DETAILS.legalEntityName || 'DKR Trucking LLC';
  const companyPhone = savedCompanySettings.phone || COMPANY_DETAILS.phone || '';
  const companyAddress = savedCompanySettings.address || COMPANY_DETAILS.address || '';
  const companyOfficialEmail = savedCompanySettings.officialEmail || COMPANY_DETAILS.email || 'info@dkrtrucking.com';
  const companyWebsite = savedCompanySettings.website || COMPANY_DETAILS.website || 'dkrtrucking.com';

  const company = {
    ...COMPANY_DETAILS,
    legalEntityName,
    phone: companyPhone,
    address: companyAddress,
    email: companyOfficialEmail,
    website: companyWebsite,
  };

  // Prepare data for template
  const agreementDate = new Date(`${dateBucket(acceptedTimestamp)}T12:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TIME_ZONE,
  });

  const formattedAcceptedOn = acceptedTimestamp.toLocaleString('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const templateData = {
    company,
    agreementDate,
    acceptedTimestamp: formattedAcceptedOn,
    agent: {
      fullName: cleanTypedName,
      cnic: cleanCnic,
      signatureImage: signatureImage || null,
    },
  };

  const documentNumber = `DKR-AGENT-CTR-${user._id.toString().slice(-6).toUpperCase()}-V${version}`;
  const safeAgentName = cleanTypedName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Independent_Sales_Agent_Agreement_${safeAgentName}_V${version}.pdf`;

  // Generate PDF and save document
  const docRecord = await generateAndSaveDocument({
    type: 'agent_contract',
    templateName: 'sales-agent-agreement-template',
    data: templateData,
    documentNumber,
    fileName,
    relatedAgentId: user._id,
    generatedBy: user._id,
    metadata: {
      agentId: user._id,
      agentName: cleanTypedName,
      agentEmail: user.email,
      cnic: cleanCnic,
      acceptedAt: acceptedTimestamp,
      agreed: true,
      typedName: cleanTypedName,
      signatureImage: signatureImage || null,
      ipAddress: agentIp,
      userAgent,
      version,
      companyPhone,
      companyAddress,
      companyOfficialEmail,
      legalEntityName,
      website: companyWebsite,
    },
  });

  user.cnic = cleanCnic;
  user.agreementAcceptedAt = acceptedTimestamp;
  user.contractRequest.status = 'signed';
  user.contractVersions.push({
    version,
    documentId: docRecord._id,
    signedAt: acceptedTimestamp,
    cnic: cleanCnic,
    typedName: cleanTypedName,
    ipAddress: agentIp,
    userAgent,
  });
  await user.save();

  await createAdminNotification({
    type: 'agent_contract_signed',
    title: 'Sales agent signed a contract',
    message: `${user.name} signed contract version ${version}.`,
    referenceId: docRecord._id,
    relatedModel: 'Document',
  });

  return success(
    res,
    201,
    {
      document: docRecord,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        cnic: user.cnic,
        agreementAcceptedAt: user.agreementAcceptedAt,
        contractRequest: user.contractRequest,
      },
    },
    'Agreement accepted and contract generated successfully'
  );
});

/**
 * @route   GET /api/documents/my-contract
 * @desc    Fetch the logged in sales agent's accepted contract
 * @access  Private (Sales Agent / Team / Admin)
 */
export const getMyContract = asyncHandler(async (req, res) => {
  const contract = await Document.findOne({
    type: 'agent_contract',
    relatedAgentId: req.user._id,
  }).sort({ generatedAt: -1 });

  if (!contract) {
    return error(res, 404, 'No contract found for this agent');
  }

  return success(res, 200, contract, 'Contract retrieved successfully');
});

export const getMyContractVersions = asyncHandler(async (req, res) => {
  const contracts = await Document.find({
    type: 'agent_contract',
    relatedAgentId: req.user._id,
  }).sort({ generatedAt: -1 });
  return success(res, 200, contracts, 'Contract versions retrieved successfully');
});

/**
 * @route   PATCH /api/documents/:id/status
 * @desc    Update document status (e.g. generated -> sent)
 * @access  Private (Admin)
 */
export const updateDocumentStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['generated', 'sent'].includes(status)) {
    return error(res, 400, 'Status must be generated or sent');
  }

  const doc = await Document.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );

  if (!doc) {
    return error(res, 404, 'Document not found');
  }

  return success(res, 200, doc, 'Document status updated');
});

export default {
  getDocuments,
  getCarrierUploadedDocs,
  generateInvoice,
  generateCarrierAgreement,
  bulkDeleteCarrierAgreements,
  getAdminAgentContracts,
  sendAgentContractRequest,
  cancelAgentContractRequest,
  acceptAgentContract,
  getMyContract,
  getMyContractVersions,
  updateDocumentStatus,
};
