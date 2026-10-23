// Simple console-based logger used for development and production.
// Intentionally lightweight to avoid external dependencies like winston.

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

const logger = {
  info: (...args) => console.log('[info]', ...args),
  warn: (...args) => console.warn('[warn]', ...args),
  error: (...args) => console.error('[error]', ...args),
  debug: (...args) => {
    if (level === 'debug') console.debug('[debug]', ...args);
  },
};

logger.stream = { write: (message) => logger.info(message.trim()) };

export default logger;
