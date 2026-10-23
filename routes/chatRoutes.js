import express from 'express';
import {
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
} from '../controllers/chatController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { uploadAny } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// All chat routes require authentication
router.use(protect);

// Conversation endpoints
router.get('/conversations', adminOnly, getConversations);
router.get('/conversation/active', getOrCreateConversation);
router.post('/conversation/active', getOrCreateConversation);
router.delete('/conversations/:conversationId', deleteConversation);
router.patch('/conversations/:conversationId/read', markConversationAsRead);

// Messages endpoints
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/messages', sendMessage);
router.patch('/messages/:messageId', editMessage);
router.delete('/messages/:messageId', deleteMessage);
router.post('/messages/:messageId/reaction', toggleReaction);

// Directory search for Admin
router.get('/directory', adminOnly, searchChatDirectory);

// Global unread badge count
router.get('/unread-count', getUnreadChatCount);

// Media upload endpoint (Cloudinary)
router.post('/upload', uploadAny.single('file'), uploadChatMedia);

export default router;
