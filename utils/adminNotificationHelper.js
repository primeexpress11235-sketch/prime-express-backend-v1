import User from '../models/User.js';
import { createNotification } from './notificationHelper.js';

export async function createAdminNotification(notification) {
  const admins = await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id');
  return Promise.all(
    admins.map((admin) => createNotification({ ...notification, recipientId: admin._id }))
  );
}

export default createAdminNotification;
