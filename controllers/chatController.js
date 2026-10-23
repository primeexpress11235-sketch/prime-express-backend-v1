import asyncHandler from 'express-async-handler';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { emitSocketEvent } from '../utils/chatSocketEmitter.js';

/**
 * @desc    Get all conversations (Admin only)
 * @route   GET /api/chat/conversations
 * @access  Private (Admin)
 */
export const getConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Find all conversations where admin has not soft-deleted it
  const conversations = await Conversation.find({
    deletedFor: { $ne: userId },
  })
    .populate('participantId', 'name email role avatar isActive workLocation')
    .sort({ lastMessageAt: -1 });

  // Filter out any conversation where participant was deleted from DB
  const validConversations = conversations.filter((c) => c.participantId);

  res.status(200).json({
    success: true,
    data: validConversations,
  });
});

/**
 * @desc    Get or create conversation for the logged-in user or specified participant
 * @route   GET /api/chat/conversation/active
 * @route   POST /api/chat/conversation/active
 * @access  Private
 */
export const getOrCreateConversation = asyncHandler(async (req, res) => {
  const currentUser = req.user;
  let targetParticipantId;

  if (currentUser.role === 'admin') {
    // Admin is opening a chat with a specific agent/dispatcher
    targetParticipantId = req.body?.participantId || req.query?.participantId;
    if (!targetParticipantId) {
      return res.status(400).json({
        success: false,
        message: 'participantId is required for admin',
      });
    }
  } else {
    // Sales Agent or Dispatcher always chats with Admin
    targetParticipantId = currentUser._id;
  }

  // Validate participant user exists
  const participantUser = await User.findById(targetParticipantId).select(
    'name email role avatar isActive workLocation'
  );

  if (!participantUser) {
    return res.status(404).json({
      success: false,
      message: 'Participant user not found',
    });
  }

  // Find existing conversation
  let conversation = await Conversation.findOne({
    participantId: targetParticipantId,
  }).populate('participantId', 'name email role avatar isActive workLocation');

  if (!conversation) {
    // Create new conversation
    conversation = await Conversation.create({
      participantId: targetParticipantId,
      lastMessageAt: new Date(),
      lastMessagePreview: '',
      unreadCountAdmin: 0,
      unreadCountParticipant: 0,
      deletedFor: [],
    });

    conversation = await Conversation.findById(conversation._id).populate(
      'participantId',
      'name email role avatar isActive workLocation'
    );
  } else {
    // If soft-deleted for current user, restore visibility
    if (conversation.deletedFor && conversation.deletedFor.some((id) => id.equals(currentUser._id))) {
      conversation.deletedFor = conversation.deletedFor.filter(
        (id) => !id.equals(currentUser._id)
      );
      await conversation.save();
    }
  }

  res.status(200).json({
    success: true,
    data: conversation,
  });
});

/**
 * @desc    Get messages for a conversation
 * @route   GET /api/chat/conversations/:conversationId/messages
 * @access  Private
 */
export const getMessages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const userRole = req.user.role;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversation not found',
    });
  }

  // Security Check: Current user must be Admin or the conversation participant
  if (userRole !== 'admin' && !conversation.participantId.equals(userId)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied to this conversation',
    });
  }

  // Fetch messages not soft-deleted for the current user
  const messages = await Message.find({
    conversationId,
    deletedFor: { $ne: userId },
  })
    .populate('senderId', 'name email avatar role')
    .populate('reactions.userId', 'name avatar role')
    .sort({ createdAt: 1 });

  // Sanitize deleted for everyone messages
  const sanitizedMessages = messages.map((msg) => {
    const doc = msg.toObject();
    if (doc.deletedForEveryone) {
      return {
        ...doc,
        content: 'This message was deleted',
        mediaUrl: '',
        mediaFileName: '',
        reactions: [],
      };
    }
    return doc;
  });

  res.status(200).json({
    success: true,
    data: sanitizedMessages,
  });
});

/**
 * @desc    Send a message
 * @route   POST /api/chat/messages
 * @access  Private
 */
export const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId, content, type = 'text', mediaUrl = '', mediaFileName = '', mediaFileSize = 0 } = req.body;
  const senderId = req.user._id;
  const senderRole = req.user.role;

  if (!conversationId) {
    return res.status(400).json({
      success: false,
      message: 'conversationId is required',
    });
  }

  if (type === 'text' && (!content || !content.trim())) {
    return res.status(400).json({
      success: false,
      message: 'Message content cannot be empty',
    });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversation not found',
    });
  }

  // Security: user must be admin or the participant
  if (senderRole !== 'admin' && !conversation.participantId.equals(senderId)) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to send messages in this conversation',
    });
  }

  // Create message
  const newMessage = await Message.create({
    conversationId,
    senderId,
    type,
    content: (content || '').trim(),
    mediaUrl,
    mediaFileName,
    mediaFileSize,
    status: 'sent',
    reactions: [],
    deletedFor: [],
  });

  // Generate preview snippet
  let preview = '';
  if (type === 'image') {
    preview = content ? `📷 ${content}` : '📷 Photo';
  } else if (type === 'document') {
    preview = content ? `📄 ${content}` : `📄 ${mediaFileName || 'Document'}`;
  } else {
    preview = content.trim();
  }

  // Update conversation last activity and unread counts
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = preview;

  if (senderRole === 'admin') {
    conversation.unreadCountParticipant = (conversation.unreadCountParticipant || 0) + 1;
  } else {
    conversation.unreadCountAdmin = (conversation.unreadCountAdmin || 0) + 1;
  }

  // If conversation was soft-deleted by any participant, restore visibility on new message
  conversation.deletedFor = [];
  await conversation.save();

  // Populate sender info for return and broadcast
  const populatedMessage = await Message.findById(newMessage._id)
    .populate('senderId', 'name email avatar role')
    .populate('reactions.userId', 'name avatar role');

  logger?.info?.(`[ChatController] sendMessage by ${senderId} in conversation ${conversationId}, broadcasting to rooms...`);

  // Broadcast real-time event to conversation room
  emitSocketEvent(`conversation:${conversationId}`, 'message:new', populatedMessage);

  // Broadcast update to participant's private user channel
  emitSocketEvent(`user:${conversation.participantId}`, 'message:new', populatedMessage);

  // Broadcast update to admin channel
  emitSocketEvent('admin_chat_updates', 'message:new', populatedMessage);
  emitSocketEvent('admin_chat_updates', 'conversation:update', {
    conversationId: conversation._id,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    unreadCountAdmin: conversation.unreadCountAdmin,
    participantId: conversation.participantId,
    message: populatedMessage,
  });

  res.status(201).json({
    success: true,
    data: populatedMessage,
  });
});

/**
 * @desc    Edit a message
 * @route   PATCH /api/chat/messages/:messageId
 * @access  Private
 */
export const editMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  const userId = req.user._id;

  if (!content || !content.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Content cannot be empty',
    });
  }

  const message = await Message.findById(messageId);
  if (!message) {
    return res.status(404).json({
      success: false,
      message: 'Message not found',
    });
  }

  // Only original sender can edit
  if (!message.senderId.equals(userId)) {
    return res.status(403).json({
      success: false,
      message: 'You can only edit your own messages',
    });
  }

  if (message.deletedForEveryone) {
    return res.status(400).json({
      success: false,
      message: 'Cannot edit a deleted message',
    });
  }

  message.content = content.trim();
  message.edited = true;
  message.editedAt = new Date();
  await message.save();

  const populated = await Message.findById(message._id)
    .populate('senderId', 'name email avatar role')
    .populate('reactions.userId', 'name avatar role');

  emitSocketEvent(`conversation:${message.conversationId}`, 'message:edit', populated);

  res.status(200).json({
    success: true,
    data: populated,
  });
});

/**
 * @desc    Delete message ("Delete for Me" or "Delete for Everyone")
 * @route   DELETE /api/chat/messages/:messageId
 * @access  Private
 */
export const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { mode = 'me' } = req.query; // 'me' or 'everyone'
  const userId = req.user._id;

  const message = await Message.findById(messageId);
  if (!message) {
    return res.status(404).json({
      success: false,
      message: 'Message not found',
    });
  }

  if (mode === 'everyone') {
    // Only the original sender (or admin) can delete for everyone
    const isSender = message.senderId.equals(userId);
    const isAdmin = req.user.role === 'admin';
    if (!isSender && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the sender can delete a message for everyone',
      });
    }

    message.deletedForEveryone = true;
    message.content = 'This message was deleted';
    message.mediaUrl = '';
    message.mediaFileName = '';
    message.reactions = []; // Clear reactions on delete for everyone
    await message.save();

    // Broadcast delete for everyone to conversation and admin/user channels
    emitSocketEvent(`conversation:${message.conversationId}`, 'message:delete', {
      messageId: message._id,
      conversationId: message.conversationId,
      deletedForEveryone: true,
    });
    emitSocketEvent('admin_chat_updates', 'message:delete', {
      messageId: message._id,
      conversationId: message.conversationId,
      deletedForEveryone: true,
    });

    return res.status(200).json({
      success: true,
      message: 'Message deleted for everyone',
      data: {
        messageId: message._id,
        deletedForEveryone: true,
      },
    });
  } else {
    // Delete for Me: soft-delete for this user only
    if (!message.deletedFor.some((id) => id.equals(userId))) {
      message.deletedFor.push(userId);
      if (message.senderId.equals(userId)) {
        message.deletedForSenderOnly = true;
      }
      await message.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Message deleted for you',
      data: {
        messageId: message._id,
        deletedForEveryone: false,
      },
    });
  }
});

/**
 * @desc    React / Unreact to a message
 * @route   POST /api/chat/messages/:messageId/reaction
 * @access  Private
 */
export const toggleReaction = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;
  const userId = req.user._id;

  if (emoji && !['👍', '😂', '❤️'].includes(emoji)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid emoji. Supported: 👍, 😂, ❤️',
    });
  }

  const message = await Message.findById(messageId);
  if (!message) {
    return res.status(404).json({
      success: false,
      message: 'Message not found',
    });
  }

  if (message.deletedForEveryone) {
    return res.status(400).json({
      success: false,
      message: 'Cannot react to a deleted message',
    });
  }

  const existingIndex = message.reactions.findIndex((r) => r.userId.equals(userId));

  if (existingIndex > -1) {
    const existing = message.reactions[existingIndex];
    if (!emoji || existing.emoji === emoji) {
      // Toggle off / unreact if same emoji or null provided
      message.reactions.splice(existingIndex, 1);
    } else {
      // Switch reaction emoji
      message.reactions[existingIndex].emoji = emoji;
      message.reactions[existingIndex].createdAt = new Date();
    }
  } else if (emoji) {
    // Add new reaction (enforcing at most 1 reaction per user per message)
    message.reactions.push({
      userId,
      emoji,
      createdAt: new Date(),
    });
  }

  await message.save();

  const populated = await Message.findById(message._id)
    .populate('senderId', 'name email avatar role')
    .populate('reactions.userId', 'name avatar role');

  emitSocketEvent(`conversation:${message.conversationId}`, 'message:reaction', {
    messageId: message._id,
    conversationId: message.conversationId,
    reactions: populated.reactions,
  });

  res.status(200).json({
    success: true,
    data: populated.reactions,
  });
});

/**
 * @desc    Mark conversation messages as read
 * @route   PATCH /api/chat/conversations/:conversationId/read
 * @access  Private
 */
export const markConversationAsRead = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;
  const userRole = req.user.role;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversation not found',
    });
  }

  // Update message statuses sent by other users
  await Message.updateMany(
    {
      conversationId,
      senderId: { $ne: userId },
      status: { $ne: 'read' },
    },
    {
      $set: { status: 'read' },
    }
  );

  // Reset unread count on conversation model
  if (userRole === 'admin') {
    conversation.unreadCountAdmin = 0;
  } else {
    conversation.unreadCountParticipant = 0;
  }
  await conversation.save();

  // Broadcast read status
  emitSocketEvent(`conversation:${conversationId}`, 'message:read', {
    conversationId,
    readerId: userId,
  });

  res.status(200).json({
    success: true,
    message: 'Conversation marked as read',
  });
});

/**
 * @desc    Delete (soft-delete) conversation for current user
 * @route   DELETE /api/chat/conversations/:conversationId
 * @access  Private
 */
export const deleteConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user._id;

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversation not found',
    });
  }

  if (!conversation.deletedFor.some((id) => id.equals(userId))) {
    conversation.deletedFor.push(userId);
    await conversation.save();
  }

  res.status(200).json({
    success: true,
    message: 'Conversation deleted for you',
  });
});

/**
 * @desc    Search Sales Agents and Dispatchers directory (Admin only)
 * @route   GET /api/chat/directory
 * @access  Private (Admin)
 */
export const searchChatDirectory = asyncHandler(async (req, res) => {
  const { q = '' } = req.query;

  const query = {
    role: { $in: ['sales_agent', 'dispatcher'] },
    isActive: true,
  };

  if (q.trim()) {
    query.$or = [
      { name: { $regex: q.trim(), $options: 'i' } },
      { email: { $regex: q.trim(), $options: 'i' } },
    ];
  }

  const users = await User.find(query)
    .select('name email role avatar isActive workLocation')
    .sort({ name: 1 })
    .limit(30);

  res.status(200).json({
    success: true,
    data: users,
  });
});

/**
 * @desc    Get total unread message count for current user
 * @route   GET /api/chat/unread-count
 * @access  Private
 */
export const getUnreadChatCount = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userRole = req.user.role;

  let count = 0;

  if (userRole === 'admin') {
    const activeConvs = await Conversation.find({
      deletedFor: { $ne: userId },
    }).select('unreadCountAdmin');

    count = activeConvs.reduce((sum, c) => sum + (c.unreadCountAdmin || 0), 0);
  } else {
    const conv = await Conversation.findOne({
      participantId: userId,
      deletedFor: { $ne: userId },
    }).select('unreadCountParticipant');

    count = conv?.unreadCountParticipant || 0;
  }

  res.status(200).json({
    success: true,
    data: { count },
  });
});

/**
 * @desc    Upload media (Image or Document) for chat via Cloudinary
 * @route   POST /api/chat/upload
 * @access  Private
 */
export const uploadChatMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
    });
  }

  const isImage = req.file.mimetype.startsWith('image/');
  const fileType = isImage ? 'image' : 'document';
  const fileUrl = req.file.path || req.file.secure_url;
  const originalName = req.file.originalname;
  const fileSize = req.file.size || req.file.bytes || 0;

  res.status(200).json({
    success: true,
    data: {
      type: fileType,
      mediaUrl: fileUrl,
      mediaFileName: originalName,
      mediaFileSize: fileSize,
    },
  });
});

export default {
  getConversations,
  getOrCreateConversation,
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  markConversationAsRead,
  deleteConversation,
  searchChatDirectory,
  getUnreadChatCount,
  uploadChatMedia,
};
