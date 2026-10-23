import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Carrier from '../models/Carrier.js';
import Load from '../models/Load.js';
import Attendance from '../models/Attendance.js';
import Truck from '../models/Truck.js';
import User from '../models/User.js';
import { success } from '../utils/sendResponse.js';
import { calendarMonthBounds, dateBucket, dateBucketStart, dateBucketWindow, today } from '../utils/performanceDates.js';
import {
  aggregateCallCounts,
  countEventsByAgent,
  getActiveCarrierEvents,
  getLeadSubmissionEvents,
} from '../services/salesAgentPerformanceService.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfToday() {
  return dateBucketStart();
}

/**
 * @route   GET /api/analytics/overview
 * @desc    Aggregated stats for the admin Overview page.
 * @access  Private/Admin
 */
export const getOverview = asyncHandler(async (req, res) => {
  const [activeCarriers, totalCarriers, pendingAssignments, totalLoadsBooked, stageAgg] = await Promise.all([
    Carrier.countDocuments({ pipelineStage: 'active_carrier' }),
    Carrier.countDocuments({}),
    Truck.countDocuments({ dispatcher: null, isActive: { $ne: false } }),
    Load.countDocuments({}),
    Carrier.aggregate([{ $group: { _id: '$pipelineStage', count: { $sum: 1 } } }]),
  ]);

  const pipelineConversionRate = totalCarriers ? Math.round((activeCarriers / totalCarriers) * 100) : 0;

  // Revenue trend — sum of load rates per month over the last 6 months.
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const loadRevenue = await Load.aggregate([
    { $addFields: { effectiveDate: { $ifNull: ['$pickupDate', '$createdAt'] } } },
    { $match: { effectiveDate: { $gte: windowStart } } },
    { $group: { _id: { y: { $year: '$effectiveDate' }, m: { $month: '$effectiveDate' } }, revenue: { $sum: { $ifNull: ['$rate', 0] } } } },
  ]);
  const revMap = new Map(loadRevenue.map((r) => [`${r._id.y}-${r._id.m}`, r.revenue]));
  const revenueTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    revenueTrend.push({
      month: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      revenue: revMap.get(`${d.getFullYear()}-${d.getMonth() + 1}`) || 0,
    });
  }

  // Today's attendance summary.
  const todayRecords = await Attendance.find({ date: startOfToday() }).select('status');
  const attendanceToday = { onTime: 0, late: 0, absent: 0 };
  todayRecords.forEach((r) => {
    if (r.status === 'on_time') attendanceToday.onTime += 1;
    else if (r.status === 'late') attendanceToday.late += 1;
    else if (r.status === 'absent') attendanceToday.absent += 1;
  });

  const stageBreakdown = stageAgg.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {});

  const overview = {
    activeCarriers,
    totalCarriers,
    totalLoadsBooked,
    pendingAssignments,
    pipelineConversionRate,
    revenueTrend,
    attendanceToday,
    stageBreakdown,
  };

  return success(res, 200, { overview }, 'Overview retrieved');
});

/**
 * @route   GET /api/analytics/loads-trend
 * @desc    Aggregated loads booked trend by month and truck equipment type for a given year.
 * @access  Private/Admin
 * @query   year - The year to query (e.g., 2024)
 */
export const getLoadsTrend = asyncHandler(async (req, res) => {
  const { year } = req.query;

  if (!year || Number.isNaN(Number(year))) {
    return res.status(400).json({ success: false, message: 'Valid year query parameter is required' });
  }

  const yearNum = Number(year);
  const startDate = new Date(yearNum, 0, 1);
  const endDate = new Date(yearNum, 11, 31, 23, 59, 59);

  // Aggregate loads by month and equipment type (via truck lookup)
  // Filter to Carrier trucks only (not Owner-Operators)
  const result = await Load.aggregate([
    {
      $addFields: {
        effectiveDate: { $ifNull: ['$pickupDate', '$createdAt'] },
      },
    },
    {
      $match: {
        effectiveDate: { $gte: startDate, $lte: endDate },
        status: 'booked',
        carrier: { $exists: true, $ne: null },  // ← Carriers only, not Owner-Operators
      },
    },
    {
      $lookup: {
        from: 'trucks',
        localField: 'truck',
        foreignField: '_id',
        as: 'truckData',
      },
    },
    {
      $addFields: {
        equipmentType: { $arrayElemAt: ['$truckData.equipmentType', 0] },
      },
    },
    {
      $group: {
        _id: {
          month: { $month: '$effectiveDate' },
          equipmentType: '$equipmentType',
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { '_id.month': 1 },
    },
  ]);

  // Transform to frontend-friendly format
  const trend = result.map((item) => ({
    month: item._id.month,
    equipmentType: item._id.equipmentType || 'Unknown',
    count: item.count,
  }));

  // Get available years from the Load collection (Carriers only)
  const yearsData = await Load.aggregate([
    {
      $match: {
        status: 'booked',
        carrier: { $exists: true, $ne: null },  // ← Carriers only
      },
    },
    {
      $addFields: {
        effectiveDate: { $ifNull: ['$pickupDate', '$createdAt'] },
      },
    },
    {
      $group: {
        _id: { $year: '$effectiveDate' },
      },
    },
    {
      $sort: { _id: -1 },
    },
  ]);

  const availableYears = yearsData.map((y) => y._id).filter((y) => y);

  return success(res, 200, { trend, availableYears }, 'Loads trend retrieved');
});

async function buildAgentHistory(agentId, monthRange) {
  const [calls, submissions, activations] = await Promise.all([
    aggregateCallCounts({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
    getLeadSubmissionEvents({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
    getActiveCarrierEvents({ agentIds: [agentId], start: monthRange.start, end: monthRange.end }),
  ]);
  const rows = new Map();
  const add = (date, key) => {
    const row = rows.get(date) || { date, coldCalls: 0, leadsSubmitted: 0, carriersActivated: 0 };
    row[key] += 1;
    rows.set(date, row);
  };
  calls.logs.forEach((log) => add(dateBucket(log.timestamp), 'coldCalls'));
  submissions.forEach((lead) => add(dateBucket(lead.submittedAt), 'leadsSubmitted'));
  activations.forEach((carrier) => add(dateBucket(carrier.activatedAt), 'carriersActivated'));
  return [...rows.values()].sort((left, right) => right.date.localeCompare(left.date));
}

async function buildSalesAgentPerformance(agentIds, dateWindow, monthRange) {
  const agents = await User.find({ _id: { $in: agentIds }, role: 'sales_agent', isActive: true })
    .select('_id name email isActive')
    .sort({ name: 1 });
  const [dayCalls, monthCalls, daySubmissions, monthSubmissions, dayActivations, monthActivations] = await Promise.all([
    aggregateCallCounts({ agentIds, start: dateWindow.start, end: dateWindow.end }),
    aggregateCallCounts({ agentIds, start: monthRange.start, end: monthRange.end }),
    getLeadSubmissionEvents({ agentIds, start: dateWindow.start, end: dateWindow.end }),
    getLeadSubmissionEvents({ agentIds, start: monthRange.start, end: monthRange.end }),
    getActiveCarrierEvents({ agentIds, start: dateWindow.start, end: dateWindow.end }),
    getActiveCarrierEvents({ agentIds, start: monthRange.start, end: monthRange.end }),
  ]);
  const dayLeadCounts = countEventsByAgent(daySubmissions, 'submittedByAgentId');
  const monthLeadCounts = countEventsByAgent(monthSubmissions, 'submittedByAgentId');
  const dayCarrierCounts = countEventsByAgent(dayActivations, 'agentId');
  const monthCarrierCounts = countEventsByAgent(monthActivations, 'agentId');

  return agents.map((agent) => {
    const id = String(agent._id);
    const activeCarriers = dayCarrierCounts.get(id) || 0;
    return {
      agent: agent.toObject(),
      today: {
        coldCalls: dayCalls.byAgent.get(id) || 0,
        activitySubmitted: true,
        leadsSubmitted: dayLeadCounts.get(id) || 0,
        carriersActivated: activeCarriers,
        activeCarriers,
      },
      month: {
        coldCalls: monthCalls.byAgent.get(id) || 0,
        leadsSubmitted: monthLeadCounts.get(id) || 0,
        carriersActivated: monthCarrierCounts.get(id) || 0,
      },
      activeCarriersCount: activeCarriers,
    };
  });
}

export const getSalesAgentPerformance = asyncHandler(async (req, res) => {
  if (req.query.agentId && !mongoose.isValidObjectId(req.query.agentId)) {
    return res.status(400).json({ success: false, message: 'A valid agentId is required' });
  }

  const agentIds = req.user.role === 'sales_agent'
    ? [req.user._id]
    : req.query.agentId
      ? [req.query.agentId]
      : await User.find({ role: 'sales_agent', isActive: true }).distinct('_id');
  const dateWindow = dateBucketWindow(req.query.date || today());
  const monthRange = calendarMonthBounds(req.query.month || dateWindow.key.slice(0, 7));
  const performance = await buildSalesAgentPerformance(agentIds, dateWindow, monthRange);
  const selectedPeriod = req.query.period === 'month' || (req.query.month && !req.query.date) ? 'month' : 'today';

  performance.sort((left, right) => (
    (right[selectedPeriod].carriersActivated || 0) - (left[selectedPeriod].carriersActivated || 0) ||
    (right[selectedPeriod].leadsSubmitted || 0) - (left[selectedPeriod].leadsSubmitted || 0) ||
    (right[selectedPeriod].coldCalls || 0) - (left[selectedPeriod].coldCalls || 0) ||
    left.agent.name.localeCompare(right.agent.name)
  ));

  performance.forEach((item) => { item.periodDate = dateWindow.key; });
  if (req.query.history === 'true' && performance[0]) {
    performance[0].history = await buildAgentHistory(performance[0].agent._id, monthRange);
  }

  return success(res, 200, performance, 'Sales-agent performance retrieved');
});

export default { getOverview, getLoadsTrend, getSalesAgentPerformance };
