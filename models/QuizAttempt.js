import mongoose from 'mongoose';

const quizAttemptSchema = new mongoose.Schema(
  {
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chapter',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
    },
    passed: {
      type: Boolean,
      required: true,
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ agentId: 1, chapterId: 1, passed: 1 });

const QuizAttempt = mongoose.model('QuizAttempt', quizAttemptSchema);

export default QuizAttempt;
