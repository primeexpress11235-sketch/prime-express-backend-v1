import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldAutoAddReadyDispatchTruck } from '../controllers/truckPipelineController.js';
import { resolveCarrierTruckUpdates } from '../controllers/truckController.js';
import { countDistinctCarrierIdsForUser, countDistinctTruckIdsForUser, countLoadsForUser } from '../services/loadHistory.js';

test('single-truck carrier auto-adds when moved to ready for dispatch', () => {
  assert.equal(shouldAutoAddReadyDispatchTruck({ pipelineStage: 'ready_for_dispatch', truckCount: 1 }), true);
});

test('multi-truck carriers stay manual', () => {
  assert.equal(shouldAutoAddReadyDispatchTruck({ pipelineStage: 'ready_for_dispatch', truckCount: 2 }), false);
});

test('non-ready stages do not auto-add', () => {
  assert.equal(shouldAutoAddReadyDispatchTruck({ pipelineStage: 'qualification', truckCount: 1 }), false);
});

test('carrier truck updates preserve exact truck ownership when dispatcher changes', () => {
  const existing = [
    { _id: 't1', truckNumber: 1, driverName: 'Alice', dispatcher: 'd_old' },
    { _id: 't2', truckNumber: 2, driverName: 'Bob', dispatcher: 'd_old_2' },
  ];

  const updates = [
    { truckId: 't1', truckNumber: 1, driverName: 'Alice', dispatcher: 'd_old' },
    { truckId: 't2', truckNumber: 2, driverName: 'Bob', dispatcher: 'd_ethan' },
  ];

  const result = resolveCarrierTruckUpdates(existing, updates);

  assert.deepEqual(result.updatedIds.sort(), ['t1', 't2']);
  assert.equal(result.toCreate.length, 0);
  assert.equal(result.toDelete.length, 0);
  assert.equal(result.updates.find((u) => u.truckId === 't2').dispatcher, 'd_ethan');
  assert.equal(result.updates.find((u) => u.truckId === 't2').truckId, 't2');
});

test('dispatcher active carrier count is deduplicated by carrier across multiple truck loads', () => {
  const loads = [
    { dispatcher: 'dispatcher-1', carrier: 'carrier-a', truck: 'truck-1', status: 'booked' },
    { dispatcher: 'dispatcher-1', carrier: 'carrier-a', truck: 'truck-1', status: 'booked' },
    { dispatcher: 'dispatcher-1', carrier: 'carrier-b', truck: 'truck-2', status: 'booked' },
    { dispatcher: 'dispatcher-2', carrier: 'carrier-a', truck: 'truck-3', status: 'booked' },
  ];

  assert.equal(countDistinctCarrierIdsForUser(loads, 'dispatcher-1'), 2);
  assert.equal(countLoadsForUser(loads, 'dispatcher-1'), 3);
});

test('sales agent active carrier count increases only when a carrier actually books a load', () => {
  const loads = [
    { carrier: 'carrier-a', dispatcher: 'dispatcher-1', truck: 'truck-1', status: 'booked' },
    { carrier: 'carrier-a', dispatcher: 'dispatcher-1', truck: 'truck-1', status: 'booked' },
    { carrier: 'carrier-b', dispatcher: 'dispatcher-2', truck: 'truck-2', status: 'booked' },
  ];

  const carrierById = {
    'carrier-a': { assignedSalesAgent: 'sales-1' },
    'carrier-b': { assignedSalesAgent: 'sales-2' },
  };

  assert.equal(countDistinctCarrierIdsForUser(loads, 'sales-1', carrierById), 1);
  assert.equal(countDistinctCarrierIdsForUser(loads, 'sales-2', carrierById), 1);
});

test('dispatcher active truck count is based on booked load history, not truck assignment', () => {
  const loads = [];
  const truckAssignment = { dispatcher: 'dispatcher-1', truckNumber: 'truck-1' };

  assert.equal(countDistinctTruckIdsForUser(loads, 'dispatcher-1'), 0);

  loads.push({ carrier: 'carrier-a', dispatcher: 'dispatcher-1', truck: 'truck-1', status: 'booked' });
  assert.equal(countDistinctTruckIdsForUser(loads, 'dispatcher-1'), 1);

  truckAssignment.dispatcher = 'dispatcher-2';
  assert.equal(countDistinctTruckIdsForUser(loads, 'dispatcher-1'), 1);
  assert.equal(countDistinctTruckIdsForUser(loads, 'dispatcher-2'), 0);
});

test('dispatcher active carrier count is based on booked load history, not truck assignment', () => {
  const loads = [];
  const truckAssignment = { dispatcher: 'dispatcher-1', truckNumber: 'truck-1' };

  assert.equal(countDistinctCarrierIdsForUser(loads, 'dispatcher-1'), 0);

  loads.push({ carrier: 'carrier-a', dispatcher: 'dispatcher-1', truck: 'truck-1', status: 'booked' });
  assert.equal(countDistinctCarrierIdsForUser(loads, 'dispatcher-1'), 1);

  truckAssignment.dispatcher = 'dispatcher-2';
  assert.equal(countDistinctCarrierIdsForUser(loads, 'dispatcher-1'), 1);
  assert.equal(countDistinctCarrierIdsForUser(loads, 'dispatcher-2'), 0);
});
