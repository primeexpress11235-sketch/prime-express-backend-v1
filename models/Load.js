import mongoose from 'mongoose';

/**
 * Load Schema
 * A booked freight load, used for dispatcher load history and carrier load
 * history / payment status.
 */
const loadSchema = new mongoose.Schema(
  {
    // Nullable: when a carrier is deleted its loads are kept for history and
    // this reference is cleared, so nothing populates to a dangling id.
    carrier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Carrier',
      default: null,
    },
    // Denormalized carrier name, captured at creation, so a load stays readable
    // after its carrier record is gone.
    carrierName: { type: String, trim: true },
    carrierDeleted: { type: Boolean, default: false },
    dispatcher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    pickupLocation: { type: String, trim: true },
    deliveryLocation: { type: String, trim: true },
    pickupDate: Date,
    deliveryDate: Date,
    rate: { type: Number, default: 0 },

    // --- Freight detail --------------------------------------------------
    // Captured when a dispatcher books a load on the Trucks Management board.
    // All optional: loads created through the plain POST /api/loads path (and
    // every load written before this board existed) simply leave them unset.
    // Kept as their own fields rather than one note blob so history stays
    // queryable — "what did we haul for this carrier at what weight".
    commodity: { type: String, trim: true },
    weight: { type: String, trim: true },
    // Empty miles to the shipper, and the loaded trip itself. Strings because
    // dispatchers write them as they read them off a load board ("120 mi",
    // "Dallas → Atlanta, 780"), not as clean numbers.
    deadhead: { type: String, trim: true },
    trip: { type: String, trim: true },

    // The truck that ran the load. Nullable so the field is additive — loads
    // booked outside the board have no truck to point at.
    truck: { type: mongoose.Schema.Types.ObjectId, ref: 'Truck', default: null },
    status: {
      type: String,
      enum: ['booked', 'invoiced', 'pending_payment', 'paid', 'in_transit', 'delivered'],
      default: 'booked',
    },
    // Billing & Invoice tracking
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
    invoiceNumber: { type: String, trim: true, default: null },
    invoicedAt: { type: Date, default: null },
    invoiceDate: { type: Date, default: null },
    isFirstFreeLoad: { type: Boolean, default: false },
    dispatchFee: { type: Number, default: 0 },
    broker: { type: String, trim: true, default: '' },
    loadRef: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

loadSchema.index({ carrier: 1 });
loadSchema.index({ dispatcher: 1 });
loadSchema.index({ status: 1 });
loadSchema.index({ truck: 1 });

const Load = mongoose.model('Load', loadSchema);

export default Load;
