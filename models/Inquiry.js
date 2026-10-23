import mongoose from 'mongoose';

/**
 * Inquiry Schema
 * Inbound submissions from the public website's lead and contact forms. This
 * is deliberately lightweight — it only records interest so an admin can see
 * it. Public carrier self-signup that builds a pipeline lead is a later phase.
 */
const inquirySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['lead', 'contact'],
      default: 'lead',
    },
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true },
    truckType: { type: String, trim: true },
    authorityAge: { type: String, trim: true },
    message: { type: String, trim: true },
    status: {
      type: String,
      enum: ['new', 'reviewed', 'archived'],
      default: 'new',
    },
  },
  { timestamps: true }
);

inquirySchema.index({ createdAt: -1 });

const Inquiry = mongoose.model('Inquiry', inquirySchema);

export default Inquiry;
