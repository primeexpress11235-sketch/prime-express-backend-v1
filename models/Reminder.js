import mongoose from 'mongoose';

/**
 * Reminder Schema
 * Generic follow-up reminder for any carrier lead, created by an agent or admin.
 */
const reminderSchema = new mongoose.Schema(
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reminderDate: {
      type: Date,
      required: true,
      index: true,
    },
    reminderTime: {
      type: String,
      default: '18:00',
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    resolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

reminderSchema.index({ agentId: 1, resolved: 1, reminderDate: 1 });

const Reminder = mongoose.model('Reminder', reminderSchema);

export default Reminder;
