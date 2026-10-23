import mongoose from 'mongoose';

/**
 * Meeting Schema
 * An internal meeting record. No external calendar/API integration — the type
 * and link/location are just stored fields.
 */
const meetingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a meeting title'],
      trim: true,
    },
    date: { type: Date, required: true },
    // Local time-of-day string, 'HH:mm'.
    time: { type: String },
    type: {
      type: String,
      enum: ['zoom', 'google_meet', 'in_person'],
      default: 'zoom',
    },
    // Meeting URL for zoom/google_meet, or a physical location for in_person.
    linkOrLocation: { type: String, trim: true },
    notes: { type: String, trim: true },
    attendees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

meetingSchema.index({ date: 1 });

const Meeting = mongoose.model('Meeting', meetingSchema);

export default Meeting;
