import mongoose from 'mongoose';

/**
 * CarrierActivityLog Schema
 * Immutable log recording every status change made by an agent on a carrier prospect lead.
 * Sole source of truth for cold calls / outreach activity.
 */
const carrierActivityLogSchema = new mongoose.Schema(
  {
    carrierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CarrierLead',
      required: true,
      index: true,
    },
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    statusFrom: {
      type: String,
      default: 'None',
    },
    statusTo: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

carrierActivityLogSchema.index({ agentId: 1, timestamp: -1 });

const CarrierActivityLog = mongoose.model('CarrierActivityLog', carrierActivityLogSchema);

export default CarrierActivityLog;
