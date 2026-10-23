import logger from './logger.js';
import { getSocketIO } from './notificationHelper.js';

export const emitSocketEvent = (room, event, data) => {
  try {
    const io = global.io || getSocketIO();
    if (io) {
      logger?.info?.(`[ChatSocket Broadcast] Emitting '${event}' to room '${room}'`);
      io.to(room).emit(event, data);
    } else {
      logger?.warn?.(`[ChatSocket Broadcast WARNING] No io instance available to emit '${event}' to room '${room}'`);
    }
  } catch (err) {
    logger?.warn?.(`Failed to emit socket event ${event} to room ${room}:`, err?.message || err);
  }
};

export default emitSocketEvent;