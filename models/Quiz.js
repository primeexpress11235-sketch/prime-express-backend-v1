import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: [(arr) => arr.length === 4, 'Each question must have exactly 4 options'],
  },
  correctIndex: {
    type: Number,
    required: true,
    min: 0,
    max: 3,
  },
});

const quizSchema = new mongoose.Schema(
  {
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chapter',
      required: true,
      unique: true,
    },
    questions: {
      type: [questionSchema],
      required: true,
    },
  },
  { timestamps: true }
);

quizSchema.index({ chapterId: 1 });

const Quiz = mongoose.model('Quiz', quizSchema);

export default Quiz;
