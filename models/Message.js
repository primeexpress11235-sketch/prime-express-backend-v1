import mongoose from 'mongoose';

/**
 * Message Reaction Sub-Schema
 * Exactly 1 reaction per user per message
 */
const reactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    emoji: {
      type: String,
      enum: ['👍', '😂', '❤️'],
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

/**
 * Message Schema
 */
const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'document'],
      default: 'text',
    },
    content: {
      type: String,
      default: '',
    },
    mediaUrl: {
      type: String,
      default: '',
    },
    mediaFileName: {
      type: String,
      default: '',
    },
    mediaFileSize: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
      index: true,
    },
    edited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedForSenderOnly: {
      type: Boolean,
      default: false,
    },
    // Track users who chose "Delete for Me"
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // "Delete for Everyone" replaces content with placeholder
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
    reactions: [reactionSchema],
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
