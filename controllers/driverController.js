import asyncHandler from 'express-async-handler';
import fs from 'fs';
import path from 'path';
import Driver, { DQF_ITEMS_CONFIG } from '../models/Driver.js';
import logger from '../utils/logger.js';
import { createNotification } from '../utils/notificationHelper.js';
import {
  uploadDocToCloudinary,
  deleteDocFromCloudinary,
  streamDocDownload,
} from '../services/cloudinaryDocService.js';

// Helper to construct accessible file URL
const getFileUrl = (req, filePath) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const relativePath = normalizedPath.includes('uploads/')
    ? normalizedPath.substring(normalizedPath.indexOf('uploads/'))
    : normalizedPath;
  return `${req.protocol}://${req.get('host')}/${relativePath}`;
};

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
        console.error('Driver document upload failed:', error);
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

export const initializeAndSyncDQF = (driver) => {
  if (driver.status !== 'Hired') return;

  if (!driver.dqfChecklist) {
    driver.dqfChecklist = [];
  }

  DQF_ITEMS_CONFIG.forEach((config) => {
    let item = driver.dqfChecklist.find((i) => i.itemKey === config.itemKey);
    if (!item) {
      driver.dqfChecklist.push({
        itemKey: config.itemKey,
        title: config.title,
        hasExpiration: config.hasExpiration,
        status: 'Missing',
        cloudinaryUrl: '',
        cloudinaryPublicId: '',
        originalFileName: '',
        resourceType: 'raw',
        mimeType: '',
        expirationDate: null,
        uploadedAt: null,
        uploadedBy: '',
      });
      item = driver.dqfChecklist[driver.dqfChecklist.length - 1];
    } else {
      item.title = config.title;
      item.hasExpiration = config.hasExpiration;
    }

    // Auto-population logic for overlapping items if missing or no file attached
    if (config.autoPopulateType && (!item.cloudinaryUrl || item.status === 'Missing')) {
      const matchDoc = driver.documents.find((d) => d.fileType === config.autoPopulateType);
      if (matchDoc) {
        item.cloudinaryUrl = matchDoc.cloudinaryUrl;
        item.cloudinaryPublicId = matchDoc.cloudinaryPublicId || '';
        item.originalFileName = matchDoc.originalFileName || matchDoc.fileName || '';
        item.resourceType = matchDoc.resourceType || 'raw';
        item.mimeType = matchDoc.mimeType || '';
        item.uploadedAt = matchDoc.uploadedAt || new Date();
        item.uploadedBy = 'Auto-Populated from Application Documents';
      }
    }

    // Recalculate status based on file presence & expiration
    if (!item.cloudinaryUrl) {
      item.status = 'Missing';
    } else if (config.hasExpiration && item.expirationDate) {
      const now = new Date();
      const exp = new Date(item.expirationDate);
      const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
      if (diffDays < 0) {
        item.status = 'Expired';
      } else if (diffDays <= 30) {
        item.status = 'Expiring Soon';
      } else {
        item.status = 'Valid';
      }
    } else {
      item.status = config.hasExpiration ? 'Valid' : 'Uploaded';
    }
  });
};

/**
 * @desc    Create a new driver application / lead
 * @route   POST /api/drivers
 * @access  Public / Admin
 */
export const createDriver = asyncHandler(async (req, res) => {
  let body = req.body;

  // Handle json stringified nested objects if sent via FormData
  if (typeof body.screeningAnswers === 'string') {
    try {
      body.screeningAnswers = JSON.parse(body.screeningAnswers);
    } catch (e) {
      body.screeningAnswers = {};
    }
  }
  if (typeof body.equipmentExperience === 'string') {
    try {
      body.equipmentExperience = JSON.parse(body.equipmentExperience);
    } catch (e) {
      body.equipmentExperience = body.equipmentExperience ? [body.equipmentExperience] : [];
    }
  }
  if (typeof body.endorsements === 'string') {
    try {
      body.endorsements = JSON.parse(body.endorsements);
    } catch (e) {
      body.endorsements = body.endorsements ? [body.endorsements] : [];
    }
  }

  const {
    name,
    phone,
    email,
    homeState,
    yearsExperience,
    equipmentExperience,
    manualTransmission,
    endorsements,
    currentEmployer,
    earliestAvailableDate,
    payExpectation,
    status,
    source,
    referredBy,
    screeningAnswers,
    smsConsent,
    notes,
  } = body;

  if (!name || !phone || !email || !homeState || yearsExperience === undefined || yearsExperience === '') {
    res.status(400);
    throw new Error('Name, phone, email, home state, and years of experience are required.');
  }

  const isSmsConsent = smsConsent === true || smsConsent === 'true';

  const driverData = {
    name,
    phone,
    email,
    homeState,
    yearsExperience: Number(yearsExperience) || 0,
    equipmentExperience: Array.isArray(equipmentExperience) ? equipmentExperience : [],
    manualTransmission: manualTransmission === true || manualTransmission === 'true',
    endorsements: Array.isArray(endorsements) ? endorsements : [],
    currentEmployer: currentEmployer || '',
    earliestAvailableDate: earliestAvailableDate ? new Date(earliestAvailableDate) : null,
    payExpectation: payExpectation || '',
    status: status || 'New',
    source: source || 'Facebook Group',
    referredBy: referredBy || '',
    lastContactedDate: new Date(),
    screeningAnswers: screeningAnswers || {},
    smsConsent: isSmsConsent,
    smsConsentTimestamp: isSmsConsent ? new Date() : null,
    notes: notes || '',
    documents: [],
  };

  // Process any files attached during initial creation
  if (req.files && req.files.length > 0) {
    const fileCategoryMap = body.fileTypes ? (typeof body.fileTypes === 'string' ? JSON.parse(body.fileTypes) : body.fileTypes) : {};

    const settled = await uploadFilesWithConcurrency(req.files, async (file, idx) => {
      const fileType = Array.isArray(fileCategoryMap)
        ? fileCategoryMap[idx] || 'Other'
        : fileCategoryMap[file.originalname] || 'Other';

      const uploaded = await uploadDocToCloudinary(file.buffer, file.originalname, 'dkr/driver-documents');
      return {
        originalFileName: uploaded.originalFileName,
        cloudinaryUrl: uploaded.cloudinaryUrl,
        cloudinaryPublicId: uploaded.cloudinaryPublicId,
        resourceType: uploaded.resourceType,
        fileType: fileType,
        mimeType: uploaded.fileType,
        uploadedAt: new Date(),
      };
    });

    driverData.documents = settled
      .filter((entry) => entry?.status === 'fulfilled' && entry.value)
      .map((entry) => entry.value);
  }

  const driver = await Driver.create(driverData);

  // Trigger admin notification for new driver application
  await createNotification({
    type: 'driver_application',
    title: 'New Driver Application',
    message: `${driver.name} applied (${driver.yearsExperience} yrs exp, ${driver.homeState})`,
    referenceId: driver._id,
    relatedModel: 'Driver',
  });

  res.status(201).json({ success: true, data: driver });
});

/**
 * @desc    Get all drivers with query filter options
 * @route   GET /api/drivers
 * @access  Private / Admin
 */
export const getDrivers = asyncHandler(async (req, res) => {
  const { status, source, search, followUp, equipment, endorsement } = req.query;
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (source) {
    filter.source = source;
  }

  if (equipment) {
    filter.equipmentExperience = equipment;
  }

  if (endorsement) {
    filter.endorsements = endorsement;
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { homeState: { $regex: search, $options: 'i' } },
      { currentEmployer: { $regex: search, $options: 'i' } },
    ];
  }

  // Pure UI computed follow-up helper filter if needed
  if (followUp === '30') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    filter.lastContactedDate = { $lte: thirtyDaysAgo };
    filter.status = { $nin: ['Hired', 'Not Interested'] };
  } else if (followUp === '60') {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    filter.lastContactedDate = { $lte: sixtyDaysAgo };
    filter.status = { $nin: ['Hired', 'Not Interested'] };
  }

  const drivers = await Driver.find(filter).sort({ createdAt: -1 });
  res.status(200).json({ success: true, count: drivers.length, data: drivers });
});

/**
 * @desc    Get single driver by ID
 * @route   GET /api/drivers/:id
 * @access  Private / Admin
 */
export const getDriverById = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }
  if (driver.status === 'Hired') {
    initializeAndSyncDQF(driver);
    await driver.save();
  }
  res.status(200).json({ success: true, data: driver });
});

/**
 * @desc    Update driver profile
 * @route   PUT /api/drivers/:id
 * @access  Private / Admin
 */
export const updateDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const allowedUpdates = [
    'name',
    'phone',
    'email',
    'homeState',
    'yearsExperience',
    'equipmentExperience',
    'manualTransmission',
    'endorsements',
    'currentEmployer',
    'earliestAvailableDate',
    'payExpectation',
    'status',
    'source',
    'referredBy',
    'lastContactedDate',
    'screeningAnswers',
    'smsConsent',
    'notes',
  ];

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      if (field === 'lastContactedDate' && req.body[field]) {
        driver[field] = new Date(req.body[field]);
      } else if (field === 'earliestAvailableDate') {
        driver[field] = req.body[field] ? new Date(req.body[field]) : null;
      } else {
        driver[field] = req.body[field];
      }
    }
  });

  if (driver.status === 'Hired') {
    initializeAndSyncDQF(driver);
  }

  const updatedDriver = await driver.save();
  res.status(200).json({ success: true, data: updatedDriver });
});

/**
 * @desc    Delete driver record
 * @route   DELETE /api/drivers/:id
 * @access  Private / Admin
 */
export const deleteDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  // Delete associated Cloudinary documents if present
  if (driver.documents && driver.documents.length > 0) {
    await Promise.all(
      driver.documents.map((doc) =>
        doc.cloudinaryPublicId
          ? deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType || 'raw')
          : Promise.resolve()
      )
    );
  }

  // Also clean up local legacy folder if it exists
  const driverFolder = path.resolve('uploads', 'drivers', driver._id.toString());
  if (fs.existsSync(driverFolder)) {
    try {
      fs.rmSync(driverFolder, { recursive: true, force: true });
    } catch (err) {
      logger?.warn?.(`Could not remove folder for driver ${driver._id}:`, err);
    }
  }

  await driver.deleteOne();
  res.status(200).json({ success: true, message: 'Driver deleted successfully.' });
});

/**
 * @desc    Upload documents to a specific driver
 * @route   POST /api/drivers/:id/documents
 * @access  Private / Admin / Public (during signup)
 */
export const uploadDriverDocument = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(400);
    throw new Error('Driver profile not found.');
  }

  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) {
    res.status(400);
    throw new Error('No files provided for upload.');
  }

  const fileType = req.body.fileType || 'Other';

  const uploadTasks = files.map(async (file) => {
    const uploaded = await uploadDocToCloudinary(file.buffer, file.originalname, 'dkr/driver-documents');
    return {
      originalFileName: uploaded.originalFileName,
      cloudinaryUrl: uploaded.cloudinaryUrl,
      cloudinaryPublicId: uploaded.cloudinaryPublicId,
      resourceType: uploaded.resourceType,
      fileType: fileType,
      mimeType: uploaded.fileType,
      uploadedAt: new Date(),
    };
  });

  const newDocs = await Promise.all(uploadTasks);
  driver.documents.push(...newDocs);
  await driver.save();

  res.status(200).json({ success: true, data: driver.documents });
});

/**
 * @desc    List driver documents
 * @route   GET /api/drivers/:id/documents
 * @access  Private / Admin
 */
export const getDriverDocuments = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }
  res.status(200).json({ success: true, data: driver.documents });
});

/**
 * @desc    Delete a driver document
 * @route   DELETE /api/drivers/:id/documents/:documentId
 * @access  Private / Admin
 */
export const deleteDriverDocument = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const doc = driver.documents.id(req.params.documentId);
  if (!doc) {
    res.status(404);
    throw new Error('Document not found.');
  }

  if (doc.cloudinaryPublicId) {
    await deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType || 'raw');
  }

  driver.documents.pull(req.params.documentId);
  await driver.save();

  res.status(200).json({ success: true, data: driver.documents });
});

/**
 * @desc    View driver document inline
 * @route   GET /api/drivers/:id/documents/:documentId/view
 * @access  Private / Admin
 */
export const viewDriverDocument = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const doc = driver.documents.id(req.params.documentId);
  const targetUrl = doc?.cloudinaryUrl || doc?.fileUrl;

  if (!doc || !targetUrl) {
    res.status(404);
    throw new Error('Document not found.');
  }

  return res.redirect(targetUrl);
});

/**
 * @desc    Download driver document with original filename
 * @route   GET /api/drivers/:id/documents/:documentId/download
 * @access  Private / Admin
 */
export const downloadDriverDocument = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const doc = driver.documents.id(req.params.documentId);
  const targetUrl = doc?.cloudinaryUrl || doc?.fileUrl;
  const fileName = doc?.originalFileName || doc?.fileName || 'driver_document';

  if (!doc || !targetUrl) {
    res.status(404);
    throw new Error('Document not found.');
  }

  return streamDocDownload(res, targetUrl, fileName);
});

/**
 * @desc    Get DQF checklist & compliance status
 * @route   GET /api/drivers/:id/dqf
 * @access  Private / Admin
 */
export const getDriverDQF = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  if (driver.status === 'Hired') {
    initializeAndSyncDQF(driver);
    await driver.save();
  }

  res.status(200).json({
    success: true,
    data: {
      status: driver.status,
      complianceStatus: driver.complianceStatus,
      dqfChecklist: driver.dqfChecklist || [],
    },
  });
});

/**
 * @desc    Upload or update a specific DQF checklist item
 * @route   PUT /api/drivers/:id/dqf/:itemKey
 * @access  Private / Admin
 */
export const updateDriverDQFItem = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  if (driver.status !== 'Hired') {
    res.status(400);
    throw new Error('DQF checklist is only available for Hired drivers.');
  }

  initializeAndSyncDQF(driver);

  const { itemKey } = req.params;
  const config = DQF_ITEMS_CONFIG.find((c) => c.itemKey === itemKey);
  if (!config) {
    res.status(400);
    throw new Error('Invalid DQF checklist item key.');
  }

  let item = driver.dqfChecklist.find((i) => i.itemKey === itemKey);
  if (!item) {
    res.status(404);
    throw new Error('DQF item not found.');
  }

  const file = req.file || (req.files && req.files[0]);
  if (file) {
    const uploaded = await uploadDocToCloudinary(file.buffer, file.originalname, 'dkr/dqf-documents');
    item.cloudinaryUrl = uploaded.cloudinaryUrl;
    item.cloudinaryPublicId = uploaded.cloudinaryPublicId || '';
    item.originalFileName = uploaded.originalFileName;
    item.resourceType = uploaded.resourceType || 'raw';
    item.mimeType = uploaded.fileType || '';
    item.uploadedAt = new Date();
    item.uploadedBy = req.user?.name || req.user?.email || req.body.uploadedBy || 'Admin';
  }

  if (req.body.expirationDate !== undefined) {
    item.expirationDate = req.body.expirationDate ? new Date(req.body.expirationDate) : null;
  }

  if (req.body.uploadedBy !== undefined && !file) {
    item.uploadedBy = req.body.uploadedBy;
  }

  initializeAndSyncDQF(driver);

  await driver.save();
  res.status(200).json({
    success: true,
    data: {
      complianceStatus: driver.complianceStatus,
      dqfChecklist: driver.dqfChecklist,
      driver,
    },
  });
});

/**
 * @desc    Delete/Clear a DQF checklist item file
 * @route   DELETE /api/drivers/:id/dqf/:itemKey
 * @access  Private / Admin
 */
export const deleteDriverDQFItem = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const { itemKey } = req.params;
  let item = driver.dqfChecklist.find((i) => i.itemKey === itemKey);
  if (!item) {
    res.status(404);
    throw new Error('DQF item not found.');
  }

  if (item.cloudinaryPublicId) {
    try {
      await deleteDocFromCloudinary(item.cloudinaryPublicId, item.resourceType || 'raw');
    } catch (err) {
      logger?.warn?.(`Failed to delete Cloudinary asset for DQF item ${itemKey}:`, err);
    }
  }

  item.cloudinaryUrl = '';
  item.cloudinaryPublicId = '';
  item.originalFileName = '';
  item.resourceType = 'raw';
  item.mimeType = '';
  item.expirationDate = null;
  item.uploadedAt = null;
  item.uploadedBy = '';
  item.status = 'Missing';

  initializeAndSyncDQF(driver);

  await driver.save();
  res.status(200).json({
    success: true,
    data: {
      complianceStatus: driver.complianceStatus,
      dqfChecklist: driver.dqfChecklist,
      driver,
    },
  });
});

/**
 * @desc    View DQF item document inline
 * @route   GET /api/drivers/:id/dqf/:itemKey/view
 * @access  Private / Admin
 */
export const viewDriverDQFItem = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const { itemKey } = req.params;
  const item = driver.dqfChecklist?.find((i) => i.itemKey === itemKey);
  if (!item || !item.cloudinaryUrl) {
    res.status(404);
    throw new Error('DQF document not found.');
  }

  return res.redirect(item.cloudinaryUrl);
});

/**
 * @desc    Download DQF item document
 * @route   GET /api/drivers/:id/dqf/:itemKey/download
 * @access  Private / Admin
 */
export const downloadDriverDQFItem = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) {
    res.status(404);
    throw new Error('Driver profile not found.');
  }

  const { itemKey } = req.params;
  const item = driver.dqfChecklist?.find((i) => i.itemKey === itemKey);
  if (!item || !item.cloudinaryUrl) {
    res.status(404);
    throw new Error('DQF document not found.');
  }

  return streamDocDownload(res, item.cloudinaryUrl, item.originalFileName || `${itemKey}_document`);
});
