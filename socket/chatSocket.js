import logger from '../utils/logger.js';

// Global map tracking active online user sockets: userId -> { sockets: Set<socketId>, role: string }
const onlineUsers = new Map();

/**
 * Check if a specific user is currently online
 */
export const isUserOnline = (userId) => {
  if (!userId) return false;
  const uid = String(userId);
  const entry = onlineUsers.get(uid);
  return Boolean(entry && entry.sockets && entry.sockets.size > 0);
};

/**
 * Check if any admin user is currently online
 */
export const isAnyAdminOnline = () => {
  for (const [, entry] of onlineUsers.entries()) {
    if (entry.role === 'admin' && entry.sockets && entry.sockets.size > 0) {
      return true;
    }
  }
  return false;
};

/**
 * Get all currently online user IDs
 */
export const getOnlineUserIds = () => {
  return Array.from(onlineUsers.keys());
};

/**
 * Initialize Chat Socket.IO Handlers
 * @param {import('socket.io').Server} io
 */
export const initChatSocket = (io) => {
  io.on('connection', (socket) => {
    logger?.info?.(`[ChatSocket] Socket connected: ${socket.id}`);

    // Client requests current online users list
    socket.on('get_online_users', () => {
      socket.emit('users:online_list', {
        onlineUserIds: Array.from(onlineUsers.keys()),
        isAdminOnline: isAnyAdminOnline(),
      });
    });

    // Authenticate / register user socket
    socket.on('register_user', ({ userId, role }) => {
      if (userId) {
        const uid = String(userId);
        socket.userId = uid;
        socket.userRole = role;

        socket.join(`user:${uid}`);
        if (role === 'admin') {
          socket.join('admin_chat_updates');
        }

        if (!onlineUsers.has(uid)) {
          onlineUsers.set(uid, { sockets: new Set(), role });
        }
        const entry = onlineUsers.get(uid);
        entry.role = role || entry.role;
        entry.sockets.add(socket.id);

        logger?.info?.(`[ChatSocket] User registered: ${uid} (role: ${role}), socket: ${socket.id}, totalOnline: ${onlineUsers.size}`);

        // Broadcast to all connected clients that this user is online
        io.emit('user:status_change', {
          userId: uid,
          isOnline: true,
          role,
          onlineUserIds: Array.from(onlineUsers.keys()),
          isAdminOnline: isAnyAdminOnline(),
        });

        // Send full online list to this socket
        socket.emit('users:online_list', {
          onlineUserIds: Array.from(onlineUsers.keys()),
          isAdminOnline: isAnyAdminOnline(),
        });
      }
    });

    // Join specific conversation room
    socket.on('join_conversation', ({ conversationId }) => {
      if (conversationId) {
        const room = `conversation:${conversationId}`;
        socket.join(room);
        logger?.info?.(`[ChatSocket] Socket ${socket.id} (user: ${socket.userId || 'unknown'}) joined room: ${room}`);
      }
    });

    // Leave specific conversation room
    socket.on('leave_conversation', ({ conversationId }) => {
      if (conversationId) {
        const room = `conversation:${conversationId}`;
        socket.leave(room);
        logger?.info?.(`[ChatSocket] Socket ${socket.id} (user: ${socket.userId || 'unknown'}) left room: ${room}`);
      }
    });

    // Typing start indicator
    socket.on('typing:start', ({ conversationId, userId, userName }) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:start', {
          conversationId,
          userId,
          userName,
        });
      }
    });

    // Typing stop indicator
    socket.on('typing:stop', ({ conversationId, userId }) => {
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:stop', {
          conversationId,
          userId,
        });
      }
    });

    // Handle disconnection & clean up online status
    socket.on('disconnect', (reason) => {
      logger?.info?.(`[ChatSocket] Socket disconnected: ${socket.id} (user: ${socket.userId || 'unknown'}), reason: ${reason}`);
      if (socket.userId) {
        const uid = socket.userId;
        if (onlineUsers.has(uid)) {
          const entry = onlineUsers.get(uid);
          entry.sockets.delete(socket.id);

          if (entry.sockets.size === 0) {
            onlineUsers.delete(uid);

            logger?.info?.(`[ChatSocket] User went offline: ${uid}, totalOnline: ${onlineUsers.size}`);

            // Broadcast that user is offline
            io.emit('user:status_change', {
              userId: uid,
              isOnline: false,
              onlineUserIds: Array.from(onlineUsers.keys()),
              isAdminOnline: isAnyAdminOnline(),
            });
          }
        }
      }
    });
  });
};

export default initChatSocket;
