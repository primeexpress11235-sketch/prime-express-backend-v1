import mongoose from 'mongoose';

/**
 * Conversation Schema
 * Represents a conversation between an agent/dispatcher and Admin.
 * Since every conversation in the star topology is participant ↔ Admin,
 * the single participantId reference identifies the conversation.
 */
const conversationSchema = new mongoose.Schema(
  {
    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastMessagePreview: {
      type: String,
      default: '',
    },
    // Track unread messages count for fast queries
    unreadCountAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCountParticipant: {
      type: Number,
      default: 0,
      min: 0,
    },
    // For soft-deleting conversation thread per user
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
