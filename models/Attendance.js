import mongoose from 'mongoose';

/**
 * Attendance Schema
 * One record per user per day. Status is computed against that user's
 * WorkSchedule: a check-in after the late threshold is 'late'; no check-in by
 * the end-of-day cutoff is 'absent'; a missing check-out is flagged for admin
 * review rather than silently assumed on-time.
 */
const attendanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Midnight-normalized calendar day this record represents.
    date: { type: Date, required: true },
    checkInTime: Date,
    checkOutTime: Date,
    status: {
      type: String,
      enum: ['on_time', 'late', 'absent'],
      default: 'absent',
    },
    // Set when a check-out is missing so the admin can review rather than
    // assuming the day was completed on time.
    missingCheckOut: { type: Boolean, default: false },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

// One attendance record per user per day.
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

export default Attendance;
