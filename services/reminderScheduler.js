import cron from 'node-cron';
import Reminder from '../models/Reminder.js';
import Notification from '../models/Notification.js';

/**
 * Initializes scheduled cron job to check for due follow-up reminders
 * and trigger in-app notifications. Runs every 15 minutes.
 */
export const initReminderScheduler = () => {
  // Cron syntax: '*/15 * * * *' = every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const now = new Date();

      // Find all unresolved reminders with no notification sent yet
      const pendingReminders = await Reminder.find({
        resolved: false,
        notifiedAt: null,
      }).populate('carrierId', 'companyName');

      for (const reminder of pendingReminders) {
        if (!reminder.reminderDate) continue;

        // Parse reminder datetime
        const datePart = new Date(reminder.reminderDate).toISOString().slice(0, 10);
        const timePart = reminder.reminderTime || '18:00';
        const reminderDateTime = new Date(`${datePart}T${timePart}:00.000Z`);

        // Check if reminder date/time has passed or is now
        if (reminderDateTime <= now) {
          const companyName = reminder.carrierId?.companyName || 'Lead';

          await Notification.create({
            recipient: reminder.agentId,
            type: 'sales_agent_lead',
            title: 'Follow-Up Reminder',
            message: `You are supposed to follow up on ${companyName} today at ${timePart}.`,
            body: `Follow-Up Note: ${reminder.message}`,
            relatedModel: 'Carrier',
            relatedId: reminder.carrierId?._id || reminder.carrierId,
          });

          reminder.notifiedAt = new Date();
          await reminder.save();
        }
      }
    } catch (error) {
      console.error('Error executing reminder scheduler cron:', error);
    }
  });
};

export default initReminderScheduler;
