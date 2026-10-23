import Driver, { DQF_ITEMS_CONFIG } from '../models/Driver.js';
import { createNotification } from '../utils/notificationHelper.js';
import logger from '../utils/logger.js';

/**
 * Scan all Hired drivers' DQF checklist items with expiration dates,
 * update status to "Expiring Soon" (<=30 days) or "Expired" (past),
 * and create Notification entries for newly flagged items.
 */
export const runDQFExpirationCheck = async () => {
  try {
    const hiredDrivers = await Driver.find({ status: 'Hired' });
    const now = new Date();

    for (const driver of hiredDrivers) {
      let isDriverModified = false;

      if (!driver.dqfChecklist || driver.dqfChecklist.length === 0) {
        continue;
      }

      for (const item of driver.dqfChecklist) {
        if (!item.hasExpiration || !item.expirationDate || !item.cloudinaryUrl) {
          continue;
        }

        const expDate = new Date(item.expirationDate);
        const diffTime = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let newStatus = 'Valid';
        if (diffDays < 0) {
          newStatus = 'Expired';
        } else if (diffDays <= 30) {
          newStatus = 'Expiring Soon';
        }

        const oldStatus = item.status;

        if (oldStatus !== newStatus) {
          item.status = newStatus;
          isDriverModified = true;

          // Trigger notification if newly Expiring Soon or Expired
          if (newStatus === 'Expiring Soon' || newStatus === 'Expired') {
            await createNotification({
              type: 'dqf_compliance',
              title: `DQF Document ${newStatus}: ${driver.name}`,
              message: `${driver.name}'s ${item.title} is ${newStatus.toLowerCase()} (Expiration: ${expDate.toLocaleDateString()}).`,
              referenceId: driver._id,
              relatedModel: 'Driver',
              relatedId: driver._id,
            });
            logger?.info?.(`[DQF Cron] Created notification for driver ${driver.name} - ${item.title} is ${newStatus}`);
          }
        }
      }

      if (isDriverModified) {
        await driver.save();
      }
    }
  } catch (err) {
    logger?.error?.('[DQF Cron Job] Error executing DQF expiration check:', err);
  }
};

/**
 * Initialize daily scheduled DQF expiration check job
 */
export const initDQFCronJob = () => {
  // Run initial check 15 seconds after server startup
  setTimeout(() => {
    logger?.info?.('[DQF Cron] Running initial startup DQF compliance check...');
    runDQFExpirationCheck();
  }, 15000);

  // Schedule to run every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    logger?.info?.('[DQF Cron] Running daily scheduled DQF compliance check...');
    runDQFExpirationCheck();
  }, TWENTY_FOUR_HOURS);
};

export default initDQFCronJob;
