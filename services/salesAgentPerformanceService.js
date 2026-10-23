import mongoose from 'mongoose';
import Carrier from '../models/Carrier.js';
import CarrierActivityLog from '../models/CarrierActivityLog.js';
import CarrierLead from '../models/CarrierLead.js';
import { dateBucket } from '../utils/performanceDates.js';

export async function aggregateCallCounts({ agentIds, start, end }) {
  if (!agentIds?.length) {
    return { logs: [], total: 0, byAgent: new Map(), byDate: new Map(), byAgentDate: new Map() };
  }

  const objectIds = agentIds.map((agentId) => (
    agentId instanceof mongoose.Types.ObjectId
      ? agentId
      : mongoose.Types.ObjectId.isValid(agentId)
      ? new mongoose.Types.ObjectId(agentId)
      : agentId
  ));

  const logs = await CarrierActivityLog.aggregate([
    {
      $match: {
        agentId: { $in: objectIds },
        timestamp: { $lt: end },
        $expr: { $ne: ['$statusFrom', '$statusTo'] },
      },
    },
    { $sort: { timestamp: 1, _id: 1 } },
    {
      $group: {
        _id: { agentId: '$agentId', carrierId: '$carrierId' },
        firstTouch: { $first: '$$ROOT' },
      },
    },
    { $replaceRoot: { newRoot: '$firstTouch' } },
    { $match: { timestamp: { $gte: start } } },
    { $sort: { timestamp: 1, _id: 1 } },
  ]);

  const byAgent = new Map();
  const byDate = new Map();
  const byAgentDate = new Map();
  logs.forEach((log) => {
    const agentKey = String(log.agentId);
    const dateKey = dateBucket(log.timestamp);
    byAgent.set(agentKey, (byAgent.get(agentKey) || 0) + 1);
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + 1);
    const agentDateKey = `${agentKey}:${dateKey}`;
    byAgentDate.set(agentDateKey, (byAgentDate.get(agentDateKey) || 0) + 1);
  });

  return { logs, total: logs.length, byAgent, byDate, byAgentDate };
}

export function countEventsByAgent(events, fieldName) {
  const counts = new Map();
  events.forEach((event) => {
    const agentKey = String(event[fieldName]);
    counts.set(agentKey, (counts.get(agentKey) || 0) + 1);
  });
  return counts;
}

export async function getLeadSubmissionEvents({ agentIds, start, end }) {
  if (!agentIds?.length) return [];
  return CarrierLead.find({
    submittedByAgentId: { $in: agentIds },
    isSubmitted: true,
    submittedAt: { $gte: start, $lt: end },
  }).select('_id submittedByAgentId submittedAt companyName mcNumber').lean();
}

export async function getActiveCarrierEvents({ agentIds, start, end }) {
  if (!agentIds?.length) return [];

  const carriers = await Carrier.find({
    convertedFromLeadId: { $ne: null },
    $or: [
      { activatedAt: { $ne: null } },
      { 'stageHistory.stage': 'active_carrier' },
    ],
  }).select('convertedFromLeadId activatedAt stageHistory').lean();

  const leadIds = carriers.map((carrier) => carrier.convertedFromLeadId).filter(Boolean);
  if (!leadIds.length) return [];

  const submittedLeads = await CarrierLead.find({
    _id: { $in: leadIds },
    submittedByAgentId: { $in: agentIds },
    isSubmitted: true,
  }).select('_id submittedByAgentId').lean();
  const submitterByLeadId = new Map(submittedLeads.map((lead) => [String(lead._id), lead.submittedByAgentId]));

  return carriers.flatMap((carrier) => {
    const agentId = submitterByLeadId.get(String(carrier.convertedFromLeadId));
    if (!agentId) return [];
    const stageEntries = (carrier.stageHistory || [])
      .filter((entry) => entry.stage === 'active_carrier' && entry.enteredAt)
      .sort((left, right) => new Date(left.enteredAt) - new Date(right.enteredAt));
    const activatedAt = carrier.activatedAt || stageEntries[0]?.enteredAt;
    if (!activatedAt || activatedAt < start || activatedAt >= end) return [];
    return [{ carrierId: carrier._id, agentId, activatedAt }];
  });
}

export async function populateActivityLogs(logs, select) {
  return CarrierActivityLog.populate(logs, { path: 'carrierId', select });
}