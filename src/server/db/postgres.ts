import { Pool } from 'pg'

// Must go through Supabase's transaction-mode pooler (port 6543), never the
// direct connection — serverless functions spawn per request and a direct
// connection exhausts the database's connection limit.
declare global {
  var _pgPool: Pool | undefined
}

export function getPool(): Pool {
  if (!global._pgPool) {
    global._pgPool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      max: 15,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return global._pgPool
}
