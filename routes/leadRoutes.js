import express from 'express';
import multer from 'multer';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';
import {
  uploadExcelLeads,
  getMainLeads,
  getLeadById,
  assignLeads,
  getBulkAssignAvailable,
  bulkAssignLeadsByCount,
  unassignLeads,
  bulkDeleteLeads,
  getMyLeads,
  getMyLeadStats,
  updateLeadStatus,
  updateLeadDetails,
  uploadLeadDocument,
  selectLeadRange,
  getSubmittedLeads,
  convertLeadToCarrier,
  getDailyWorkReport,
  getMonthlyWorkReport,
  getAgentPerformanceReport,
  getActivityDrilldown,
  getAgentActivityStats,
  sendQuickLeadMessage,
  getAdminAgentOversight,
} from '../controllers/leadController.js';

const router = express.Router();
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Excel Upload (Admin Only)
router.post('/excel-upload', protect, adminOnly, memoryUpload.single('file'), uploadExcelLeads);

// Main Leads List (Admin Only)
router.get('/main-leads', protect, adminOnly, getMainLeads);
router.get('/bulk-assign/available', protect, adminOnly, getBulkAssignAvailable);
router.post('/bulk-assign-by-count', protect, adminOnly, bulkAssignLeadsByCount);

// Server-side Range Selection
router.post('/select-range', protect, selectLeadRange);

router.get('/submitted', protect, requireRole('sales_agent', 'admin'), getSubmittedLeads);
router.post('/:id/convert', protect, requireRole('sales_agent', 'admin'), convertLeadToCarrier);

router.get('/reports/daily', protect, requireRole('sales_agent', 'admin'), getDailyWorkReport);
router.get('/reports/monthly', protect, requireRole('sales_agent', 'admin'), getMonthlyWorkReport);
router.get('/reports/agent-performance', protect, adminOnly, getAgentPerformanceReport);
router.get('/reports/drilldown', protect, adminOnly, getActivityDrilldown);

router.get('/agent-activity-stats', protect, requireRole('sales_agent', 'admin'), getAgentActivityStats);
router.get('/admin-oversight/:agentId', protect, adminOnly, getAdminAgentOversight);

// Assign Leads to Agent (Admin Only)
router.post('/assign', protect, adminOnly, assignLeads);

// Unassign Leads (Admin Only)
router.post('/unassign', protect, adminOnly, unassignLeads);

// Bulk Delete Leads (Admin Only)
router.post('/bulk-delete', protect, adminOnly, bulkDeleteLeads);

// My Leads (Sales Agent & Admin)
router.get('/my-leads', protect, requireRole('sales_agent', 'admin'), getMyLeads);
router.get('/my-lead-stats', protect, requireRole('sales_agent', 'admin'), getMyLeadStats);

// Update Status & Log Activity (Agent / Admin)
router.patch('/:id/status', protect, updateLeadStatus);

// Optional document uploads for lead details
router.post('/:id/documents', protect, memoryUpload.single('document'), uploadLeadDocument);

// Update Truck Details Panel
router.patch('/:id/details', protect, updateLeadDetails);

router.post('/:id/quick-message', protect, requireRole('sales_agent', 'admin'), sendQuickLeadMessage);

router.get('/:id', protect, getLeadById);

export default router;
