import { Pool } from 'pg'
import { logger } from '@/lib/logger'

// Must go through Supabase's transaction-mode pooler (port 6543), never the
// direct connection — serverless functions spawn per request and a direct
// connection exhausts the database's connection limit.
declare global {
  var _pgPool: Pool | undefined
}

/**
 * Error classes that mean "the connection was bad", as opposed to "the statement was bad".
 *
 * Only these are retried. The list is an allowlist on purpose: a denylist would silently retry the
 * next error class someone adds, and re-running a statement that failed on its *content* just
 * doubles the latency before the same failure.
 *
 * - `Connection terminated unexpectedly` / `Connection terminated due to connection timeout` are
 *   pg-pool's own strings (`pg-pool/index.js`) for a socket that died mid-handshake or in the idle
 *   pool. This is the observed failure: the shared Supabase pooler drops idle connections, and a
 *   cold re-handshake occasionally overruns `connectionTimeoutMillis`.
 * - `08xxx` are the SQL-standard connection-exception classes; `57P01`–`57P03` are Postgres'
 *   admin-shutdown / crash-shutdown / cannot-connect-now, all of which the pooler can emit when it
 *   recycles a backend underneath us.
 * - `ECONNRESET`/`EPIPE`/`ETIMEDOUT`/`ENOTFOUND`/`EAI_AGAIN` are the socket- and DNS-level versions.
 */
const RETRYABLE_PG_CODES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
])

const RETRYABLE_PG_MESSAGES = [
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error and is not queryable',
]

function isRetryableConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && RETRYABLE_PG_CODES.has(code)) return true
  return RETRYABLE_PG_MESSAGES.some((m) => err.message.includes(m))
}

export function getPool(): Pool {
  if (!global._pgPool) {
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      max: 15,

      // Was 10s. The pooler sits ~87ms away (measured RTT on `SELECT 1`), and a *cold* acquire —
      // DNS + TCP + TLS + pooler auth — measures ~368ms against ~84ms for a warm query. At 10s any
      // gap between two user interactions guaranteed a fresh handshake, so most "first click of a
      // burst" requests paid ~300ms for nothing. 30s keeps connections alive across an interaction
      // burst while still releasing them on a genuinely idle app.
      idleTimeoutMillis: 30_000,

      // Was 10s, which the shared pooler's slow handshakes occasionally exceeded — that surfaced as
      // `Connection terminated due to connection timeout`, a 500, and a map layer that silently
      // failed to render until the user reloaded. 15s is still well inside any sane request budget.
      connectionTimeoutMillis: 15_000,

      // Keep the socket warm so an intermediary (Azure's outbound NAT, the pooler itself) doesn't
      // silently drop a connection we still believe is good. Without this, a dropped-but-pooled
      // socket is only discovered when the next query tries to use it.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,

      // Recycle a connection before the pooler decides to. Bounds how long a single socket can be
      // reused, which is the cheapest defence against a server-side connection we think is healthy.
      maxLifetimeSeconds: 900,
    })

    // Without this listener a dropped idle connection is *fatal*: pg-pool does
    // `pool.emit('error', err, client)` for an error on an idle client, and Node's EventEmitter
    // throws on an unhandled 'error' event. Next installs a process-level `uncaughtException`
    // handler so the server survives, but every dropped connection still produced an
    // unhandled-exception stack in the Azure log stream — and anything else importing this module
    // (a script, a worker) would simply die. There is nothing to do about it but note it: the pool
    // has already discarded the client, and the next `query()` opens a fresh one.
    pool.on('error', (err) => {
      logger.warn({ err: err.message }, 'idle postgres client error (connection discarded)')
    })

    // Retry a connection-class failure exactly once, at the single choke point every caller goes
    // through. This is safe *because* the PostGIS layer is read-only: all 30 `pool.query()` call
    // sites under src/ are pure SELECTs, and nothing uses `pool.connect()`, so there is no
    // multi-statement transaction whose replay could double a write. Any code that adds a write —
    // or a transaction — must take its own client via `pool.connect()`, which deliberately bypasses
    // this wrapper.
    //
    // Wrapping here rather than adding a `pgQuery()` helper means no route can forget it, and the
    // "which errors are retryable" rule lives in exactly one place.
    const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>
    const retryingQuery = async (...args: unknown[]) => {
      // pg also supports a callback form, which never rejects and so can't be retried here. Nothing
      // in this codebase uses it; pass it straight through rather than silently mis-handling it.
      if (typeof args[args.length - 1] === 'function') return originalQuery(...args)

      try {
        return await originalQuery(...args)
      } catch (err) {
        if (!isRetryableConnectionError(err)) throw err
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'retrying postgres query after connection error',
        )
        return await originalQuery(...args)
      }
    }
    pool.query = retryingQuery as typeof pool.query

    global._pgPool = pool
  }
  return global._pgPool
}
