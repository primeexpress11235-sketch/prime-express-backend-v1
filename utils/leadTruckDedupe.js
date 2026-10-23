const normalize = (value) => String(value ?? '').trim().toLowerCase();

export const leadTruckProfileKey = (truck) => JSON.stringify([
  normalize(truck.equipmentType),
  normalize(truck.driverName),
  String(truck.driverPhone || '').replace(/\D/g, ''),
  normalize(truck.emptyZip),
  Number(truck.maxLoadCapacity) || 0,
  normalize(truck.trailerLength),
  normalize(truck.doorType),
  normalize(truck.liftGate),
  normalize(truck.stepDeckSubType),
  normalize(truck.trailerConfig),
  normalize(truck.trailerSize),
  normalize(truck.cargoType),
  normalize(truck.neckType),
]);

export const selectUnseenLeadTrucks = (existingTrucks, incomingTrucks) => {
  const sourceKeys = new Set();
  const profileKeys = new Set(existingTrucks.map(leadTruckProfileKey));

  for (const truck of existingTrucks) {
    if (truck.sourceLeadId && truck.sourceLeadTruckIndex !== null && truck.sourceLeadTruckIndex !== undefined) {
      sourceKeys.add(`${truck.sourceLeadId}:${truck.sourceLeadTruckIndex}`);
    }
  }

  const added = [];
  const skipped = [];
  for (const item of incomingTrucks) {
    const sourceKey = `${item.sourceLeadId}:${item.sourceLeadTruckIndex}`;
    const profileKey = leadTruckProfileKey(item.data);
    if (sourceKeys.has(sourceKey) || profileKeys.has(profileKey)) {
      skipped.push(item);
      continue;
    }
    sourceKeys.add(sourceKey);
    added.push(item);
  }

  return { added, skipped };
};