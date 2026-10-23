import http from 'http';
import logger from '../utils/logger.js';

const host = 'localhost';
const port = process.env.PORT || 5000;

const loginPayload = {
  email: process.env.LOGIN_EMAIL || 'devadmin@local',
  password: process.env.LOGIN_PASS || 'DevPass123',
};

function doRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', (err) => reject(err));

    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const loginBody = JSON.stringify(loginPayload);
    const loginRes = await doRequest(
      {
        hostname: host,
        port,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(loginBody),
        },
      },
      loginBody
    );

    logger.info('login response', { status: loginRes.statusCode, body: loginRes.body, headers: loginRes.headers });

    // Extract cookie(s)
    const setCookie = loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie'];
    let cookieHeader = '';
    if (setCookie) {
      if (Array.isArray(setCookie)) {
        cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
      } else {
        cookieHeader = setCookie.split(';')[0];
      }
    }

    const meRes = await doRequest({ hostname: host, port, path: '/api/auth/me', method: 'GET', headers: { Cookie: cookieHeader } });
    logger.info('me response', { status: meRes.statusCode, body: meRes.body });
  } catch (err) {
    logger.error('login_and_me failed', err?.message || err);
    logger.error(err);
    process.exit(1);
  }
})();
