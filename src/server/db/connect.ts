import mongoose from 'mongoose'
import { logger } from '@/lib/logger'

type MongooseCache = {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

// Cached on globalThis so HMR in dev doesn't open a new connection per reload.
const globalForMongoose = globalThis as unknown as { mongoose?: MongooseCache }

const cache: MongooseCache = globalForMongoose.mongoose ?? { conn: null, promise: null }
globalForMongoose.mongoose = cache

export async function dbConnect() {
  if (cache.conn) return cache.conn

  if (!cache.promise) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('Missing MONGODB_URI environment variable')

    cache.promise = mongoose.connect(uri, {
      bufferCommands: false,
    })
  }

  try {
    cache.conn = await cache.promise
    logger.info('MongoDB connected')
  } catch (err) {
    cache.promise = null
    logger.error({ err }, 'MongoDB connection failed')
    throw err
  }

  return cache.conn
}
