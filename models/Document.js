import mongoose from 'mongoose';

/**
 * Document Schema
 * Stores records for all generated PDFs (invoices, carrier agreements, and agent contracts).
 * Uploaded directly to Cloudinary and tracked in this single collection.
 */
const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['invoice', 'carrier_agreement', 'agent_contract'],
      required: true,
      index: true,
    },
    relatedCarrierMC: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    relatedAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    documentNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['generated', 'sent'],
      default: 'generated',
    },
  },
  {
    timestamps: true,
  }
);

documentSchema.index({ type: 1, relatedCarrierMC: 1 });
documentSchema.index({ type: 1, relatedAgentId: 1 });
documentSchema.index({ type: 1, generatedAt: -1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;
