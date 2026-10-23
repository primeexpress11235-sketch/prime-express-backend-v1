import asyncHandler from 'express-async-handler';
import OwnerOperator from '../models/OwnerOperator.js';
import { success, error } from '../utils/sendResponse.js';
import { createNotification } from '../utils/notificationHelper.js';
import {
  uploadDocToCloudinary,
  deleteDocFromCloudinary,
  streamDocDownload,
} from '../services/cloudinaryDocService.js';

// Escapes user input before using it in a RegExp so search text like "a+b" is treated literally.
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
        console.error('Owner-operator document upload failed:', error);
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
 * @route   POST /api/owner-operators/public-apply
 * @desc    Public website owner-operator application submission with document uploads
 * @access  Public
 */
export const publicCreateOwnerOperator = asyncHandler(async (req, res) => {
  let body = req.body;

  const normalizeDocumentType = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'resume';
    if (raw.includes('cdl') || raw.includes('license')) return 'cdl_license';
    if (raw.includes('insurance') || raw.includes('cert') || raw.includes('coi')) return 'insurance_cert';
    return 'resume';
  };

  // Handle JSON stringified fields if sent via FormData
  if (typeof body.smsConsent === 'string') {
    body.smsConsent = body.smsConsent === 'true';
  }

  const {
    fullName,
    phone,
    email,
    truckEquipmentType,
    truckYear,
    truckMake,
    truckModel,
    cdlLicenseNumber,
    cdlClassAExperience,
    insuranceCoverageStatus,
    smsConsent,
  } = body;

  if (!fullName || !fullName.trim()) {
    return error(res, 400, 'Full name is required');
  }

  if (!phone || !phone.trim()) {
    return error(res, 400, 'Phone number is required');
  }

  if (!email || !email.trim()) {
    return error(res, 400, 'Email is required');
  }

  if (!truckEquipmentType) {
    return error(res, 400, 'Truck equipment type is required');
  }

  const ownerOperatorData = {
    fullName: fullName.trim(),
    phone: phone.trim(),
    email: email.trim().toLowerCase(),
    truckEquipmentType,
    truckYear: truckYear?.trim() || '',
    truckMake: truckMake?.trim() || '',
    truckModel: truckModel?.trim() || '',
    cdlLicenseNumber: cdlLicenseNumber?.trim() || '',
    cdlClassAExperience: cdlClassAExperience || 'Class A - 1-3 Years',
    insuranceCoverageStatus: insuranceCoverageStatus || 'Not Active',
    smsConsent: smsConsent === true || smsConsent === 'true',
    smsConsentTimestamp: smsConsent === true || smsConsent === 'true' ? new Date() : null,
    documents: [],
    status: 'new',
  };

  // Process document uploads (CDL, Resume, Insurance)
  if (req.files && req.files.length > 0) {
    const fileTypeMap = body.fileTypes
      ? typeof body.fileTypes === 'string'
        ? JSON.parse(body.fileTypes)
        : body.fileTypes
      : {};

    const settled = await uploadFilesWithConcurrency(req.files, async (file, idx) => {
      // fileTypeMap maps fieldname to documentType: cdl_license, resume, insurance_cert
      const rawType = Array.isArray(fileTypeMap)
        ? fileTypeMap[idx] || 'resume'
        : fileTypeMap[file.fieldname] || fileTypeMap[file.originalname] || 'resume';
      const documentType = normalizeDocumentType(rawType);

      const uploaded = await uploadDocToCloudinary(
        file.buffer,
        file.originalname,
        'dkr/owner-operator-applications'
      );

      return {
        originalFileName: uploaded.originalFileName,
        cloudinaryUrl: uploaded.cloudinaryUrl,
        cloudinaryPublicId: uploaded.cloudinaryPublicId,
        resourceType: uploaded.resourceType,
        documentType: documentType,
        mimeType: uploaded.fileType,
        uploadedAt: new Date(),
      };
    });

    ownerOperatorData.documents = settled
      .filter((entry) => entry?.status === 'fulfilled' && entry.value)
      .map((entry) => entry.value);
  }

  const ownerOperator = await OwnerOperator.create(ownerOperatorData);

  // Trigger admin notification for new owner-operator application
  await createNotification({
    type: 'owner_operator_app',
    title: 'New Owner-Operator Application',
    message: `${ownerOperator.fullName} (${ownerOperator.truckEquipmentType}, ${ownerOperator.cdlClassAExperience})`,
    referenceId: ownerOperator._id,
    relatedModel: 'OwnerOperator',
  });

  return success(res, 201, ownerOperator, 'Application received');
});

/**
 * @route   GET /api/owner-operators
 * @desc    List owner-operators, filterable by truckEquipmentType, cdlClassAExperience, insuranceCoverageStatus, status, and search
 * @access  Private/Admin
 */
export const getOwnerOperators = asyncHandler(async (req, res) => {
  const {
    truckEquipmentType,
    cdlClassAExperience,
    insuranceCoverageStatus,
    status,
    search,
  } = req.query;

  const query = {};
  if (truckEquipmentType) query.truckEquipmentType = truckEquipmentType;
  if (cdlClassAExperience) query.cdlClassAExperience = cdlClassAExperience;
  if (insuranceCoverageStatus) query.insuranceCoverageStatus = insuranceCoverageStatus;
  if (status) query.status = status;

  if (search && search.trim()) {
    const re = new RegExp(escapeRegex(search.trim()), 'i');
    query.$or = [
      { fullName: re },
      { email: re },
      { phone: re },
      { cdlLicenseNumber: re },
    ];
  }

  const ownerOperators = await OwnerOperator.find(query)
    .populate('assignedManager', 'name email')
    .sort('-createdAt');

  return success(res, 200, ownerOperators, 'Owner-operators retrieved');
});

/**
 * @route   GET /api/owner-operators/:id
 * @desc    Get a single owner-operator
 * @access  Private/Admin
 */
export const getOwnerOperator = asyncHandler(async (req, res) => {
  const ownerOperator = await OwnerOperator.findById(req.params.id).populate(
    'assignedManager',
    'name email'
  );
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  return success(res, 200, ownerOperator, 'Owner-operator retrieved');
});

/**
 * @route   POST /api/owner-operators
 * @desc    Create an owner-operator (admin manual entry or with file uploads)
 * @access  Private/Admin
 */
export const createOwnerOperator = asyncHandler(async (req, res) => {
  let body = req.body;

  if (typeof body.smsConsent === 'string') {
    body.smsConsent = body.smsConsent === 'true';
  }

  const {
    fullName,
    phone,
    email,
    truckEquipmentType,
    truckYear,
    truckMake,
    truckModel,
    cdlLicenseNumber,
    cdlClassAExperience,
    insuranceCoverageStatus,
    smsConsent,
    status,
    internalNotes,
    assignedManager,
  } = body;

  if (!fullName || !fullName.trim()) {
    return error(res, 400, 'Full name is required');
  }

  if (!truckEquipmentType) {
    return error(res, 400, 'Truck equipment type is required');
  }

  const ownerOperatorData = {
    fullName: fullName.trim(),
    phone: phone?.trim() || '',
    email: email?.trim().toLowerCase() || '',
    truckEquipmentType,
    truckYear: truckYear?.trim() || '',
    truckMake: truckMake?.trim() || '',
    truckModel: truckModel?.trim() || '',
    cdlLicenseNumber: cdlLicenseNumber?.trim() || '',
    cdlClassAExperience: cdlClassAExperience || 'Class A - 1-3 Years',
    insuranceCoverageStatus: insuranceCoverageStatus || 'Not Active',
    smsConsent: smsConsent === true || smsConsent === 'true',
    smsConsentTimestamp: smsConsent === true || smsConsent === 'true' ? new Date() : null,
    documents: [],
    status: status || 'new',
    internalNotes: internalNotes?.trim() || '',
    assignedManager: assignedManager || null,
  };

  // Process document uploads if admin is attaching files
  if (req.files && req.files.length > 0) {
    const fileTypeMap = body.fileTypes
      ? typeof body.fileTypes === 'string'
        ? JSON.parse(body.fileTypes)
        : body.fileTypes
      : {};

    const uploadTasks = req.files.map(async (file, idx) => {
      const documentType = Array.isArray(fileTypeMap)
        ? fileTypeMap[idx] || 'resume'
        : fileTypeMap[file.fieldname] || fileTypeMap[file.originalname] || 'resume';

      const uploaded = await uploadDocToCloudinary(
        file.buffer,
        file.originalname,
        'dkr/owner-operator-applications'
      );

      return {
        originalFileName: uploaded.originalFileName,
        cloudinaryUrl: uploaded.cloudinaryUrl,
        cloudinaryPublicId: uploaded.cloudinaryPublicId,
        resourceType: uploaded.resourceType,
        documentType: documentType,
        mimeType: uploaded.fileType,
        uploadedAt: new Date(),
      };
    });

    ownerOperatorData.documents = await Promise.all(uploadTasks);
  }

  const ownerOperator = await OwnerOperator.create(ownerOperatorData);
  await ownerOperator.populate('assignedManager', 'name email');
  return success(res, 201, ownerOperator, 'Owner-operator created');
});

/**
 * @route   PATCH /api/owner-operators/:id
 * @desc    Update an owner-operator
 * @access  Private/Admin
 */
export const updateOwnerOperator = asyncHandler(async (req, res) => {
  const ownerOperator = await OwnerOperator.findById(req.params.id);
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  const {
    fullName,
    phone,
    email,
    truckEquipmentType,
    truckYear,
    truckMake,
    truckModel,
    cdlLicenseNumber,
    cdlClassAExperience,
    insuranceCoverageStatus,
    smsConsent,
    status,
    internalNotes,
    assignedManager,
  } = req.body;

  if (fullName !== undefined) ownerOperator.fullName = fullName.trim();
  if (phone !== undefined) ownerOperator.phone = phone.trim();
  if (email !== undefined) ownerOperator.email = email.trim().toLowerCase();
  if (truckEquipmentType !== undefined) ownerOperator.truckEquipmentType = truckEquipmentType;
  if (truckYear !== undefined) ownerOperator.truckYear = truckYear.trim();
  if (truckMake !== undefined) ownerOperator.truckMake = truckMake.trim();
  if (truckModel !== undefined) ownerOperator.truckModel = truckModel.trim();
  if (cdlLicenseNumber !== undefined) ownerOperator.cdlLicenseNumber = cdlLicenseNumber.trim();
  if (cdlClassAExperience !== undefined) ownerOperator.cdlClassAExperience = cdlClassAExperience;
  if (insuranceCoverageStatus !== undefined) ownerOperator.insuranceCoverageStatus = insuranceCoverageStatus;
  if (smsConsent !== undefined) {
    ownerOperator.smsConsent = smsConsent === true || smsConsent === 'true';
    if (ownerOperator.smsConsent && !ownerOperator.smsConsentTimestamp) {
      ownerOperator.smsConsentTimestamp = new Date();
    }
  }
  if (status !== undefined) ownerOperator.status = status;
  if (internalNotes !== undefined) ownerOperator.internalNotes = internalNotes.trim();
  if (assignedManager !== undefined) ownerOperator.assignedManager = assignedManager || null;

  await ownerOperator.save();
  await ownerOperator.populate('assignedManager', 'name email');
  return success(res, 200, ownerOperator, 'Owner-operator updated');
});

/**
 * @route   DELETE /api/owner-operators/:id
 * @desc    Delete an owner-operator
 * @access  Private/Admin
 */
export const deleteOwnerOperator = asyncHandler(async (req, res) => {
  const ownerOperator = await OwnerOperator.findById(req.params.id);
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  // Delete all documents from Cloudinary
  for (const doc of ownerOperator.documents || []) {
    if (doc.cloudinaryPublicId) {
      await deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType);
    }
  }

  await OwnerOperator.deleteOne({ _id: req.params.id });
  return success(res, 200, null, 'Owner-operator deleted');
});

/**
 * @route   POST /api/owner-operators/bulk-delete
 * @desc    Delete multiple owner-operators
 * @access  Private/Admin
 */
export const bulkDeleteOwnerOperators = asyncHandler(async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return error(res, 400, 'No owner-operator IDs provided');
  }

  const ownerOperators = await OwnerOperator.find({ _id: { $in: ids } });

  // Delete all documents from Cloudinary
  for (const oo of ownerOperators) {
    for (const doc of oo.documents || []) {
      if (doc.cloudinaryPublicId) {
        await deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType);
      }
    }
  }

  const result = await OwnerOperator.deleteMany({ _id: { $in: ids } });
  return success(res, 200, { deletedCount: result.deletedCount }, 'Owner-operators deleted');
});

/**
 * @route   GET /api/owner-operators/:id/documents/:documentId/download
 * @desc    Download an owner-operator document from Cloudinary
 * @access  Private/Admin
 */
export const downloadOwnerOperatorDocument = asyncHandler(async (req, res) => {
  const { id, documentId } = req.params;

  const ownerOperator = await OwnerOperator.findById(id);
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  const doc = ownerOperator.documents?.find((d) => d._id.toString() === documentId);
  if (!doc) return error(res, 404, 'Document not found');

  streamDocDownload(res, doc.cloudinaryUrl, doc.originalFileName);
});

/**
 * @route   DELETE /api/owner-operators/:id/documents/:documentId
 * @desc    Delete a specific document from an owner-operator
 * @access  Private/Admin
 */
export const deleteOwnerOperatorDocument = asyncHandler(async (req, res) => {
  const { id, documentId } = req.params;

  const ownerOperator = await OwnerOperator.findById(id);
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  const docIndex = ownerOperator.documents?.findIndex((d) => d._id.toString() === documentId);
  if (docIndex === -1) return error(res, 404, 'Document not found');

  const doc = ownerOperator.documents[docIndex];
  if (doc.cloudinaryPublicId) {
    await deleteDocFromCloudinary(doc.cloudinaryPublicId, doc.resourceType);
  }

  ownerOperator.documents.splice(docIndex, 1);
  await ownerOperator.save();

  return success(res, 200, ownerOperator, 'Document deleted');
});

/**
 * @route   POST /api/owner-operators/:id/documents
 * @desc    Add a document to an owner-operator (admin upload)
 * @access  Private/Admin
 */
export const addOwnerOperatorDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const file = req.file;
  const { documentType } = req.body;

  if (!file) {
    return error(res, 400, 'No file provided');
  }

  const ownerOperator = await OwnerOperator.findById(id);
  if (!ownerOperator) return error(res, 404, 'Owner-operator not found');

  const uploaded = await uploadDocToCloudinary(
    file.buffer,
    file.originalname,
    'dkr/owner-operator-applications'
  );

  ownerOperator.documents.push({
    originalFileName: uploaded.originalFileName,
    cloudinaryUrl: uploaded.cloudinaryUrl,
    cloudinaryPublicId: uploaded.cloudinaryPublicId,
    resourceType: uploaded.resourceType,
    documentType: documentType || 'resume',
    mimeType: uploaded.fileType,
    uploadedAt: new Date(),
  });

  await ownerOperator.save();
  return success(res, 201, ownerOperator, 'Document added');
});
