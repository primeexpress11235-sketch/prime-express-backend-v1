import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: {
      type: String,
      required: [true, 'Please provide question text'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['open', 'answered'],
      default: 'open',
    },
    adminReply: {
      type: String,
      default: '',
    },
    addedToFAQ: {
      type: Boolean,
      default: false,
    },
    answeredAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

questionSchema.index({ agentId: 1, createdAt: -1 });
questionSchema.index({ addedToFAQ: 1 });
questionSchema.index({ status: 1 });

const Question = mongoose.model('Question', questionSchema);

export default Question;
