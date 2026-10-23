import mongoose from 'mongoose';

/**
 * Notification Schema
 * Represents in-app notifications for users
 */
const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    type: {
      type: String,
      enum: [
        'driver_application',
        'carrier_setup',
        'contact_us',
        'shipper_quote',
        'owner_operator_app',
        'sales_agent_lead',
        'truck_assigned',
        'carrier_assigned',
        'lead_stage_changed',
        'task_assigned',
        'task_completed',
        'attendance_flag',
        'meeting_created',
        'announcement_posted',
        'new_inquiry',
        'dqf_compliance',
        'academy_question',
        'agent_contract_request',
        'agent_contract_signed',
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: String,
    body: String,
    isRead: {
      type: Boolean,
      default: false,
    },
    referenceId: mongoose.Schema.Types.ObjectId,
    relatedModel: String, // e.g., 'Driver', 'Carrier', 'Inquiry', 'Task', 'Meeting'
    relatedId: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true }
);

// Index for frequently queried fields
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ type: 1, isRead: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
