import Notification from '../models/Notification.js';
import logger from './logger.js';

let ioInstance = null;

export const setSocketIO = (io) => {
  ioInstance = io;
};

export const getSocketIO = () => ioInstance || global.io;

/**
 * Create Notification
 * Shared helper function to create and save notifications and emit real-time updates
 */
export const createNotification = async ({
  recipientId = null,
  type,
  title,
  message,
  body,
  referenceId = null,
  relatedModel = null,
  relatedId = null,
}) => {
  try {
    const finalMessage = message || body || '';
    const finalRefId = referenceId || relatedId || null;
    const finalModel = relatedModel || (type === 'driver_application' ? 'Driver' : type === 'carrier_setup' ? 'Carrier' : type === 'contact_us' ? 'Inquiry' : null);

    const notification = new Notification({
      recipient: recipientId || undefined,
      type,
      title,
      message: finalMessage,
      body: finalMessage,
      referenceId: finalRefId,
      relatedModel: finalModel,
      relatedId: finalRefId,
    });

    await notification.save();

    const activeIo = ioInstance || global.io;
    if (activeIo && typeof activeIo.emit === 'function') {
      try {
        activeIo.emit('new_notification', notification.toObject ? notification.toObject() : notification);
      } catch (socketErr) {
        logger?.error?.('Socket.IO notification emit failed:', socketErr);
      }
    }

    return notification;
  } catch (err) {
    logger?.error?.('Failed to create notification:', err);
    return null;
  }
};

export default createNotification;
