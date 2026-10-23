import mongoose from 'mongoose';

/**
 * Task Schema
 * A task the admin assigns to a team member. Distinct from the personal
 * Workspace notes/tasks — this one has an assigner and assignee.
 */
const taskSchema = new mongoose.Schema(
  {
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Please provide a task title'],
      trim: true,
    },
    description: { type: String, trim: true },
    dueDate: Date,
    status: {
      type: String,
      enum: ['pending', 'done'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

taskSchema.index({ assignedTo: 1, status: 1 });

const Task = mongoose.model('Task', taskSchema);

export default Task;
