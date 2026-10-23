import express from 'express';
import analyticsController from '../controllers/analyticsController.js';
import { protect, adminOnly, requireRole } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/analytics/overview
router.get('/overview', protect, adminOnly, analyticsController.getOverview);

// GET /api/analytics/loads-trend
router.get('/loads-trend', protect, adminOnly, analyticsController.getLoadsTrend);

// GET /api/analytics/sales-agent-performance
router.get('/sales-agent-performance', protect, requireRole('admin', 'sales_agent'), analyticsController.getSalesAgentPerformance);

export default router;
