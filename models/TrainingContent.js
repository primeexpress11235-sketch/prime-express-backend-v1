import mongoose from 'mongoose';

const trainingContentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a title'],
      trim: true,
    },
    documentTitle: {
      type: String,
      default: '',
      trim: true,
    },
    body: {
      type: String,
      default: '',
    },
    fileUrl: {
      type: String,
      default: '',
    },
    originalFileName: {
      type: String,
      default: '',
    },
    cloudinaryPublicId: {
      type: String,
      default: '',
    },
    resourceType: {
      type: String,
      default: 'raw',
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
  },
  { timestamps: true }
);

trainingContentSchema.index({ category: 1, createdAt: -1 });

const TrainingContent = mongoose.model('TrainingContent', trainingContentSchema);

export default TrainingContent;
