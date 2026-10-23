import Load from '../models/Load.js';
import User from '../models/User.js';
import Carrier, { PRE_ACTIVE_STAGES } from '../models/Carrier.js';

/**
 * Writing a load into a carrier's history.
 *
 * Extracted from loadController so the Trucks Management board books loads
 * through exactly the same path as POST /api/loads rather than reimplementing
 * it. Both the carrier-name snapshot and the promote-to-active side effect
 * matter and are easy to forget at a second call site — which is precisely why
 * they live here now.
 */

/**
 * Records a booked load against a carrier and returns the saved Load.
 *
 * @param {object}  input
 * @param {object}  input.carrierDoc   Already-loaded Carrier document.
 * @param {string}  [input.dispatcher] Falls back to the carrier's dispatcher.
 * @param {string}  [input.truck]      Truck that will run it, when known.
 * @param {object}  input.details      pickupLocation, deliveryLocation,
 *                                     pickupDate, deliveryDate, rate,
 *                                     commodity, weight, deadhead, trip.
 * @param {string}  [input.status]
 */
export function countLoadsForUser(loads = [], userId) {
  const target = String(userId);
  return loads.filter((load) => load?.status === 'booked' && String(load?.dispatcher?._id || load?.dispatcher || '') === target).length;
}

export function countDistinctTruckIdsForUser(loads = [], userId) {
  const target = String(userId);
  const seen = new Set();

  for (const load of loads) {
    if (load?.status !== 'booked') continue;

    const truckId = String(load?.truck?._id || load?.truck || '');
    if (!truckId) continue;

    const isDispatcherMatch = String(load?.dispatcher?._id || load?.dispatcher || '') === target;
    if (isDispatcherMatch) {
      seen.add(truckId);
    }
  }

  return seen.size;
}

export function countDistinctCarrierIdsForUser(loads = [], userId, carrierById = {}) {
  const target = String(userId);
  const seen = new Set();

  for (const load of loads) {
    if (load?.status !== 'booked') continue;

    const carrierId = String(load?.carrier?._id || load?.carrier || '');
    if (!carrierId) continue;

    const isDispatcherMatch = String(load?.dispatcher?._id || load?.dispatcher || '') === target;
    const isSalesAgentMatch = !!carrierById[carrierId] && String(
      carrierById[carrierId]?.assignedSalesAgent?._id || carrierById[carrierId]?.assignedSalesAgent || ''
    ) === target;

    if (isDispatcherMatch || isSalesAgentMatch) {
      seen.add(carrierId);
    }
  }

  return seen.size;
}

export async function syncUserCarrierMetrics({ dispatcherId, salesAgentId }) {
  if (dispatcherId) {
    const distinctCarrierIds = await Load.distinct('carrier', {
      dispatcher: dispatcherId,
      carrier: { $ne: null },
      status: 'booked',
    });
    await User.findByIdAndUpdate(dispatcherId, { activeCarrierCount: distinctCarrierIds.length });
  }

  if (salesAgentId) {
    const carrierIds = await Carrier.find({ assignedSalesAgent: salesAgentId }).distinct('_id');
    const distinctCarrierIds = await Load.distinct('carrier', {
      carrier: { $in: carrierIds || [] },
      status: 'booked',
    });
    await User.findByIdAndUpdate(salesAgentId, { activeCarrierCount: distinctCarrierIds.length });
  }
}

export async function recordLoad({ carrierDoc, dispatcher, truck, details = {}, status }) {
  const load = await Load.create({
    carrier: carrierDoc._id,
    // Snapshot so the load stays readable if the carrier is later deleted.
    carrierName: carrierDoc.companyName,
    dispatcher: dispatcher || null,
    truck: truck || null,
    pickupLocation: details.pickupLocation,
    deliveryLocation: details.deliveryLocation,
    pickupDate: details.pickupDate,
    deliveryDate: details.deliveryDate,
    rate: details.rate,
    commodity: details.commodity,
    weight: details.weight,
    deadhead: details.deadhead,
    trip: details.trip,
    status,
  });

  // Booking a load is the event that makes a carrier "active", so promote any
  // carrier still sitting in a pre-active stage. Churned carriers are left
  // alone — reactivating one should be a deliberate move on the board.
  if (PRE_ACTIVE_STAGES.includes(carrierDoc.pipelineStage)) {
    carrierDoc.pipelineStage = 'active_carrier';
    carrierDoc.stageHistory.push({ stage: 'active_carrier', enteredAt: new Date() });
    carrierDoc.needsFollowUp = false;
    await carrierDoc.save();
  }

  await syncUserCarrierMetrics({
    dispatcherId: dispatcher || null,
    salesAgentId: carrierDoc.assignedSalesAgent || null,
  });

  return load;
}

/** Convenience wrapper for callers that only hold a carrier id. */
export async function recordLoadForCarrierId(carrierId, rest) {
  const carrierDoc = await Carrier.findById(carrierId);
  if (!carrierDoc) return null;
  return recordLoad({ carrierDoc, ...rest });
}

export default { recordLoad, recordLoadForCarrierId };
