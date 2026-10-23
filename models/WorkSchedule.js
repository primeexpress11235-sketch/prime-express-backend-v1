import mongoose from 'mongoose';

/**
 * WorkSchedule Schema
 * Per-user working-hours configuration set by the admin. Attendance status is
 * computed against these values. One schedule per user.
 */
const workScheduleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Local time-of-day strings, 'HH:mm' (24-hour).
    startTime: { type: String, default: '09:00' },
    endTime: { type: String, default: '17:00' },
    // Minutes after startTime before a check-in counts as late.
    lateThresholdMinutes: { type: Number, default: 15 },
    // Minutes after startTime (with no check-in) before the day is absent.
    absentThresholdMinutes: { type: Number, default: 240 },
    workLocation: {
      type: String,
      enum: ['remote', 'onsite'],
      default: 'onsite',
    },
  },
  { timestamps: true }
);

const WorkSchedule = mongoose.model('WorkSchedule', workScheduleSchema);

export default WorkSchedule;
