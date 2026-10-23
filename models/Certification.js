import mongoose from 'mongoose';

const certificationSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    courseId: {
      type: String,
      default: 'sales-agent-v1',
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
    certificateUrl: {
      type: String,
      required: true,
    },
    certificateId: {
      type: String,
      required: true,
      unique: true,
    },
    certificateTemplateVersion: {
      type: Number,
    },
  },
  { timestamps: true }
);

certificationSchema.index({ agentId: 1, courseId: 1 }, { unique: true });
certificationSchema.index({ certificateId: 1 });

const Certification = mongoose.model('Certification', certificationSchema);

export default Certification;
