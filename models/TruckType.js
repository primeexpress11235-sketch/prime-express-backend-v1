import mongoose from 'mongoose';

const truckTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide truck type name'],
      unique: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['Semi', 'Non-Semi'],
      required: true,
    },
    equipmentType: {
      type: String,
      default: 'Dry Van',
      trim: true,
    },
    imageUrl: { type: String, default: '' },
    images: {
      type: [String],
      default: [],
    },
    description: { type: String, default: '' },
    trailerLengths: {
      type: [String],
      default: [],
    },
    maxWeightCapacity: {
      type: String,
      default: '',
    },
    doorType: { type: String, default: '' },
    liftGate: { type: String, default: '' },
    trailerLength: { type: String, default: '' },
    stepDeckSubType: { type: String, default: '' },
    trailerConfig: { type: String, default: '' },
    trailerSize: { type: String, default: '' },
    cargoType: { type: String, default: '' },
    neckType: { type: String, default: '' },
    specializedEquipment: {
      type: [String],
      default: [],
    },
    commonModels: {
      type: [String],
      default: [],
    },
    commissionRate: {
      type: Number,
    },
  },
  { timestamps: true }
);

truckTypeSchema.index({ category: 1 });

const TruckType = mongoose.model('TruckType', truckTypeSchema);

export default TruckType;
