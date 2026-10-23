import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a course title'],
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    audience: {
      type: String,
      enum: ['sales_agent', 'dispatcher'],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

courseSchema.index({ audience: 1, isActive: 1, createdAt: 1 });

const Course = mongoose.model('Course', courseSchema);

export default Course;
