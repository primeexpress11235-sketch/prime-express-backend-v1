import test from 'node:test';
import assert from 'node:assert/strict';

import { selectUnseenLeadTrucks } from '../utils/leadTruckDedupe.js';

const truck = (overrides = {}) => ({
  equipmentType: 'Dry Van',
  driverName: 'TEST Driver',
  driverPhone: '555-0100',
  emptyZip: '90210',
  maxLoadCapacity: 45000,
  trailerLength: '53ft',
  ...overrides,
});

const leadTruck = (index, data = truck()) => ({
  sourceLeadId: 'lead-test',
  sourceLeadTruckIndex: index,
  data,
});

test('identical trucks at different indexes in one submitted lead are both retained', () => {
  const result = selectUnseenLeadTrucks([], [leadTruck(0), leadTruck(1)]);

  assert.equal(result.added.length, 2);
  assert.equal(result.skipped.length, 0);
});

test('conversion source identity prevents the same lead truck from being added twice', () => {
  const existing = [{
    ...truck(),
    sourceLeadId: 'lead-test',
    sourceLeadTruckIndex: 0,
  }];

  const result = selectUnseenLeadTrucks(existing, [leadTruck(0)]);

  assert.equal(result.added.length, 0);
  assert.equal(result.skipped.length, 1);
});

test('legacy truck records dedupe by normalized equipment profile', () => {
  const existing = [truck({ equipmentType: 'dry van', driverPhone: '(555) 0100', emptyZip: ' 90210 ' })];

  const result = selectUnseenLeadTrucks(existing, [leadTruck(0)]);

  assert.equal(result.added.length, 0);
  assert.equal(result.skipped.length, 1);
});

test('different operational profiles are added to the existing carrier', () => {
  const result = selectUnseenLeadTrucks([truck()], [leadTruck(0, truck({ driverPhone: '555-0199' }))]);

  assert.equal(result.added.length, 1);
  assert.equal(result.skipped.length, 0);
});