import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

/**
 * MongoDB Connection
 * Uses mongoose connection caching for serverless compatibility
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

function buildOptions() {
  return {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10', 10),
    serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '5000', 10),
    socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS || '45000', 10),
  };
}

export async function connectDB({ allowFailure = false } = {}) {
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = buildOptions();
    cached.promise = mongoose.connect(mongoUri, opts)
      .then((mongooseInstance) => {
        logger.info('MongoDB connected successfully');
        return mongooseInstance;
      })
      .catch((err) => {
        cached.promise = null;
        cached.conn = null;

        if (allowFailure || process.env.NODE_ENV !== 'production') {
          logger.warn('MongoDB connection failed; continuing without database', err.message);
          return null;
        }

        throw err;
      });

    mongoose.connection.on('connected', () => {
      logger.info('Mongoose event: connected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('Mongoose event: reconnected');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Mongoose event: disconnected');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('Mongoose event: error', err);
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export function isMongoConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

export default connectDB;
