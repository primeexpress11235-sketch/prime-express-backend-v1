/**
 * One-off migration for the 6-stage -> 7-stage carrier pipeline.
 *
 *   assigned_to_dispatcher -> dispatcher_assigned
 *   documents_vetting      -> qualification
 *
 * Rewrites both `pipelineStage` and every `stageHistory[].stage` entry, then
 * backfills `dispatcherAssignedAt` for carriers that already have a dispatcher
 * so their cards are not blank.
 *
 * Run once, after deploying the new model:  node scripts/migratePipelineStages.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Carrier, { LEGACY_STAGE_MAP } from '../models/Carrier.js';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is not set');

  await mongoose.connect(uri);
  console.log('Connected. Migrating carrier pipeline stages…');

  let stageUpdates = 0;
  let historyUpdates = 0;
  let assignedBackfills = 0;

  // strict:false so the legacy enum values can still be read back.
  const carriers = await Carrier.find({}).lean();

  for (const c of carriers) {
    const set = {};

    const mappedStage = LEGACY_STAGE_MAP[c.pipelineStage];
    if (mappedStage) {
      set.pipelineStage = mappedStage;
      stageUpdates += 1;
    }

    const history = c.stageHistory || [];
    if (history.some((h) => LEGACY_STAGE_MAP[h.stage])) {
      set.stageHistory = history.map((h) => ({
        ...h,
        stage: LEGACY_STAGE_MAP[h.stage] || h.stage,
      }));
      historyUpdates += 1;
    }

    // Give existing assignments a plausible timestamp so the Dispatcher
    // Assigned card has something to show.
    if (c.assignedDispatcher && !c.dispatcherAssignedAt) {
      const entered = (set.stageHistory || history)
        .filter((h) => h.stage === 'dispatcher_assigned')
        .pop()?.enteredAt;
      set.dispatcherAssignedAt = entered || c.updatedAt || c.createdAt || new Date();
      assignedBackfills += 1;
    }

    if (Object.keys(set).length > 0) {
      await Carrier.collection.updateOne({ _id: c._id }, { $set: set });
    }
  }

  console.log(`  pipelineStage rewritten:      ${stageUpdates}`);
  console.log(`  stageHistory rewritten:       ${historyUpdates}`);
  console.log(`  dispatcherAssignedAt filled:  ${assignedBackfills}`);
  console.log(`  carriers scanned:             ${carriers.length}`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
