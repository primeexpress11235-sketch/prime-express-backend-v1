import mongoose from 'mongoose';

/**
 * Shipper Schema
 * Manages freight quote requests from the "Get a Quote" form on the public website.
 * Shippers submit freight shipping details and receive direct quotes.
 */

export const HAULING_SERVICE_TYPES = [
  'Dry Van',
  'Flatbed',
  'Expedited / Hotshot',
  'Reefer',
  'Step Deck',
  'Power Only',
];

const shipperSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, 'Please provide a company name'],
      trim: true,
    },
    contactName: {
      type: String,
      required: [true, 'Please provide a contact name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Please provide a phone number'],
      trim: true,
    },
    commodity: {
      type: String,
      trim: true,
      default: '',
    },
    haulingServiceType: {
      type: String,
      enum: HAULING_SERVICE_TYPES,
      default: 'Dry Van',
    },
    // Origin location
    originCity: { type: String, trim: true, default: '' },
    originState: { type: String, trim: true, default: '' },
    // Destination location
    destinationCity: { type: String, trim: true, default: '' },
    destinationState: { type: String, trim: true, default: '' },
    // Shipment details
    totalWeight: { type: String, trim: true, default: '' },
    dimensions: { type: String, trim: true, default: '' },
    preferredShipDate: { type: Date, default: null },
    specialHandlingNotes: { type: String, trim: true, default: '' },
    // Admin tracking
    status: {
      type: String,
      enum: ['new', 'quoted', 'booked', 'archived'],
      default: 'new',
    },
    quoteAmount: { type: Number, default: null },
    quotedDate: { type: Date, default: null },
    internalNotes: { type: String, trim: true, default: '' },
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

shipperSchema.index({ createdAt: -1 });
shipperSchema.index({ status: 1 });
shipperSchema.index({ originState: 1 });
shipperSchema.index({ destinationState: 1 });
shipperSchema.index({ haulingServiceType: 1 });
shipperSchema.index({ email: 1 });

const Shipper = mongoose.model('Shipper', shipperSchema);

export default Shipper;
