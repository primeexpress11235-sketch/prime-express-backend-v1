import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

// Database connection
import { connectDB } from './config/db.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import cmsRoutes from './routes/cmsRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import blogRoutes from './routes/blogRoutes.js';
import workspaceRoutes from './routes/workspaceRoutes.js';
import truckRoutes from './routes/truckRoutes.js';
import truckPipelineRoutes from './routes/truckPipelineRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import carrierRoutes from './routes/carrierRoutes.js';
import loadRoutes from './routes/loadRoutes.js';
import userRoutes from './routes/userRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import workScheduleRoutes from './routes/workScheduleRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import path from 'path';
import announcementRoutes from './routes/announcementRoutes.js';
import meetingRoutes from './routes/meetingRoutes.js';
import driverRoutes from './routes/driverRoutes.js';
import shipperRoutes from './routes/shipperRoutes.js';
import ownerOperatorRoutes from './routes/ownerOperatorRoutes.js';
import companySettingsRoutes from './routes/companySettingsRoutes.js';
import academyRoutes from './routes/academyRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import reminderRoutes from './routes/reminderRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import initChatSocket from './socket/chatSocket.js';
import { initReminderScheduler } from './services/reminderScheduler.js';

import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { setSocketIO } from './utils/notificationHelper.js';
import { initDQFCronJob } from './jobs/dqfCronJob.js';

// Middleware
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

// Create Express app
const app = express();
let publicRateLimiter = null;
let dashboardRateLimiter = null;

// Sentry (optional) - dynamic import to avoid hard dependency
if (process.env.SENTRY_DSN) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0'),
    });
    app.use(Sentry.Handlers.requestHandler());
    logger?.info?.('Sentry initialized');
  } catch (e) {
    logger?.warn?.('@sentry/node not installed; skipping Sentry initialization');
  }
}

// ─── CORS Configuration ───
const parseAllowedOrigins = () => {
  const defaultOrigins = [
    'https://dkrtrucking.com',
    'https://www.dkrtrucking.com',
    'https://backend-dkr-v2-production.up.railway.app',
    'http://backend-dkr-v2-production.up.railway.app',
    'https://avencix-agency.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  const rawOrigins = process.env.CLIENT_URL || process.env.FRONTEND_URL || '';

  let configuredOrigins = [];

  if (rawOrigins) {
    try {
      const parsed = JSON.parse(rawOrigins);
      configuredOrigins = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      configuredOrigins = rawOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    }
  }

  return Array.from(new Set([...defaultOrigins, ...configuredOrigins]));
};

const allowedOrigins = parseAllowedOrigins();

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser tools / same-origin requests without an Origin header.
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      /^https:\/\/.*\.vercel\.app$/.test(origin) ||
      /^https:\/\/(.*\.)?dkrtrucking\.com$/.test(origin)
    ) {
      return callback(null, true);
    }

    logger?.warn?.(`CORS blocked origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ─── Middleware ───
app.use(express.json({ limit: process.env.BODY_PARSER_LIMIT || '50mb' }));
app.use(express.urlencoded({ limit: process.env.BODY_PARSER_LIMIT || '50mb', extended: true }));
app.use(cookieParser());

// Morgan HTTP Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: logger.stream }));
}

// Security middlewares - load optionally and synchronously before routes
if (process.env.NODE_ENV === 'production') {
  try {
    // Use top-level await to ensure middleware order
    await (async () => {
      try {
        const { default: helmet } = await import('helmet');
        app.use(helmet());
        logger?.info?.('Helmet enabled');
      } catch (e) {
        logger?.warn?.('helmet not installed; skipping');
      }

      try {
        const { default: rateLimit } = await import('express-rate-limit');

        publicRateLimiter = rateLimit({
          windowMs: parseInt(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || '60000', 10),
          max: parseInt(process.env.PUBLIC_RATE_LIMIT_MAX || '30', 10),
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req) => req.ip || 'unknown-ip',
          handler: (req, res) => {
            const route = req.originalUrl || req.url || 'unknown-route';
            const ip = req.ip || 'unknown-ip';
            logger.warn(`[rate-limit][public] ${route} blocked for IP ${ip}`);
            res.status(429).json({
              success: false,
              message: 'Too many requests. Please slow down and try again shortly.',
            });
          },
        });

        dashboardRateLimiter = rateLimit({
          windowMs: parseInt(process.env.DASHBOARD_RATE_LIMIT_WINDOW_MS || '60000', 10),
          max: parseInt(process.env.DASHBOARD_RATE_LIMIT_MAX || '300', 10),
          standardHeaders: true,
          legacyHeaders: false,
          keyGenerator: (req) => {
            const userId = req.user?._id ? String(req.user._id) : req.ip || 'unknown-ip';
            return userId;
          },
          handler: (req, res) => {
            const route = req.originalUrl || req.url || 'unknown-route';
            const user = req.user ? `${req.user._id} (${req.user.role || 'unknown-role'})` : 'anonymous';
            const ip = req.ip || 'unknown-ip';
            logger.warn(`[rate-limit][dashboard] ${route} blocked for user ${user} IP ${ip}`);
            res.status(429).json({
              success: false,
              message: 'Dashboard request limit reached. Please wait a moment and retry.',
            });
          },
        });

        logger?.info?.('Rate limiters enabled');
      } catch (e) {
        logger?.warn?.('express-rate-limit not installed; skipping');
      }
    })();
  } catch (e) {
    logger?.warn?.('Security middleware setup failed', e?.message || e);
  }
}

app.use('/uploads', express.static(path.resolve('uploads')));

if (publicRateLimiter && dashboardRateLimiter) {
  app.use([
    '/api/inquiries',
    '/api/auth/login',
    '/api/auth/admin-setup',
    '/api/auth/admin-exists',
    '/api/carriers/public-setup',
    '/api/owner-operators/public-apply',
    '/api/shippers/public-quote',
  ], publicRateLimiter);

  app.use([
    '/api/cms',
    '/api/notifications',
    '/api/blogs',
    '/api/workspace',
    '/api/trucks',
    '/api/truck-pipeline',
    '/api/analytics',
    '/api/carriers',
    '/api/loads',
    '/api/users',
    '/api/attendance',
    '/api/work-schedules',
    '/api/tasks',
    '/api/announcements',
    '/api/meetings',
    '/api/drivers',
    '/api/shippers',
    '/api/owner-operators',
    '/api/company-settings',
    '/api/academy',
    '/api/chat',
    '/api/leads',
    '/api/reminders',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/auth/change-password',
    '/api/auth/me/avatar',
  ], dashboardRateLimiter);
}

// ─── Routes ───
app.use('/api/auth', authRoutes);
app.use('/api/cms', cmsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/trucks', truckRoutes);
app.use('/api/truck-pipeline', truckPipelineRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/inquiries', contactRoutes);
app.use('/api/carriers', carrierRoutes);
app.use('/api/loads', loadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/work-schedules', workScheduleRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/shippers', shipperRoutes);
app.use('/api/owner-operators', ownerOperatorRoutes);
app.use('/api/company-settings', companySettingsRoutes);
app.use('/api/academy', academyRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/documents', documentRoutes);

// Development-only: expose registered routes for debugging
if (process.env.NODE_ENV === 'development') {
  app.get('/api/debug/routes', (req, res) => {
    try {
      const routes = [];
      const stack = app._router && app._router.stack ? app._router.stack : [];
      stack.forEach((layer) => {
        if (layer.route && layer.route.path) {
          const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
          routes.push({ path: layer.route.path, methods });
        } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
          layer.handle.stack.forEach((r) => {
            if (r.route && r.route.path) {
              const methods = Object.keys(r.route.methods).join(',').toUpperCase();
              routes.push({ path: r.route.path, methods });
            }
          });
        }
      });
      res.json({ success: true, routes });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to enumerate routes', error: err?.message });
    }
  });
}

// ─── Health Check ───
app.get('/health', async (req, res) => {
  const checks = {
    server: true,
    mongo: false,
  };

  try {
    // lazy require to avoid circular deps
    const { isMongoConnected } = await import('./config/db.js');
    checks.mongo = isMongoConnected();
  } catch (err) {
    checks.mongo = false;
  }

  const ok = checks.server && checks.mongo;
  res.status(ok ? 200 : 500).json({ ok, checks });
});

// Prometheus metrics (optional) - dynamic import to avoid hard dependency
try {
  const prom = await import('prom-client');
  const promClient = prom.default || prom;
  promClient.collectDefaultMetrics();
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  });
  logger?.info?.('prom-client metrics enabled');
} catch (e) {
  logger?.warn?.('prom-client metrics not available; skipping');
}

// ─── Error Handling ───
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ───
const PORT = process.env.PORT || 5000;
let server = null;

async function startServer() {
  try {
    const dbConnected = await connectDB({
      allowFailure: process.env.NODE_ENV !== 'production' || process.env.START_WITHOUT_DB === 'true',
    });

    if (dbConnected) {
      logger.info('MongoDB ready for requests');
    } else {
      logger.warn('Starting server without a MongoDB connection');
    }

    const httpServer = http.createServer(app);

    const io = new SocketIOServer(httpServer, {
      cors: corsOptions,
    });

    global.io = io;
    setSocketIO(io);
    initDQFCronJob();
    initReminderScheduler();
    initChatSocket(io);

    io.on('connection', (socket) => {
      logger.info(`Socket connected: ${socket.id}`);
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });

    if (typeof io.engine?.on === 'function') {
      io.engine.on('connection_error', (err) => {
        logger?.warn?.('Socket.IO connection_error:', err?.message || err);
      });
    }

    server = httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Failed to start server: port ${PORT} is already in use. Stop the existing process or change PORT.`);
      } else {
        logger.error('Server error', err);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      try {
        logger.info(`Received ${signal}, shutting down`);
        if (server) {
          server.close(() => {
            logger.info('HTTP server closed');
          });
        }
        // close mongoose connection
        try {
          const mongoose = (await import('mongoose')).default;
          await mongoose.connection.close(false);
          logger.info('Mongoose connection closed');
        } catch (err) {
          logger.warn('Error closing mongoose connection', err);
        }
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception', err);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection', reason);
      shutdown('unhandledRejection');
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only start server if this file is run directly
if (process.env.NODE_ENV !== 'production' || !globalThis.vercelFunctionHandler) {
  startServer();
}

// ─── Vercel Serverless Export ───
export default app;
