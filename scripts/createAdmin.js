import logger from '../utils/logger.js';

const url = process.env.URL || 'http://localhost:5000/api/auth/admin-setup';
const payload = {
  name: 'Dev Admin',
  email: 'devadmin@local',
  password: 'DevPass123',
};

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    logger.info('createAdmin result', { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text });
  } catch (err) {
    logger.error('createAdmin failed', err?.message || err);
  }
})();
