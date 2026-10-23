import express from 'express';
import {
  getDocuments,
  getCarrierUploadedDocs,
  generateInvoice,
  generateCarrierAgreement,
  bulkDeleteCarrierAgreements,
  acceptAgentContract,
  getMyContract,
  getMyContractVersions,
  getAdminAgentContracts,
  sendAgentContractRequest,
  cancelAgentContractRequest,
  updateDocumentStatus,
} from '../controllers/documentController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin document listings
router.get('/', protect, adminOnly, getDocuments);
router.get('/carrier-docs', protect, adminOnly, getCarrierUploadedDocs);

// Invoice generation
router.post('/invoices/generate', protect, adminOnly, generateInvoice);

// Carrier Agreement generation & bulk delete
router.post('/carrier-agreements/generate', protect, adminOnly, generateCarrierAgreement);
router.post('/carrier-agreements/bulk-delete', protect, adminOnly, bulkDeleteCarrierAgreements);

// Sales agent contract acceptance & retrieval
router.get('/agent-contracts', protect, adminOnly, getAdminAgentContracts);
router.post('/agent-contracts/request', protect, adminOnly, sendAgentContractRequest);
router.delete('/agent-contracts/request/:agentId', protect, adminOnly, cancelAgentContractRequest);
router.post('/agent-contracts/accept', protect, requireRole('sales_agent'), acceptAgentContract);
router.get('/my-contract', protect, requireRole('sales_agent', 'admin'), getMyContract);
router.get('/my-contracts', protect, requireRole('sales_agent', 'admin'), getMyContractVersions);

// Status update
router.patch('/:id/status', protect, adminOnly, updateDocumentStatus);

export default router;
