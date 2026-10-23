import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['image', 'link', 'document'],
    default: 'link',
  },
  url: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: '',
  },
});

const chapterSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: [true, 'A chapter must belong to a course'],
    },
    order: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: [true, 'Please provide a chapter title'],
      trim: true,
    },
    content: {
      type: String,
      required: [true, 'Please provide chapter content'],
    },
    attachments: [attachmentSchema],
    coverImage: {
      type: String,
      default: '',
    },
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
    },
  },
  { timestamps: true }
);

chapterSchema.index({ courseId: 1, order: 1 }, { unique: true, sparse: true });

const Chapter = mongoose.model('Chapter', chapterSchema);

export default Chapter;
