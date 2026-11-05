import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import pg from 'pg'
import { config } from '../../config.js'
import { createLogger } from './logger.js'
import { sendMetricToVictoria } from './vmetrics.js'

// Cache the pending promise, not the resolved pool: concurrent first callers
// must share one pool instead of each creating their own.
let db: Promise<pg.Pool> | undefined
let stopRuntimeMetrics: (() => void) | undefined

const logger = createLogger('drivers:pg')

const RUNTIME_METRICS_INTERVAL_MS = 10_000

// Short host/database label for the connection log line
const describeTarget = (url: string) => {
  try {
    const { hostname, port, pathname } = new URL(url)
    return `${hostname}:${port}${pathname}`
  } catch {
    return '<unparseable DATABASE_URL>'
  }
}

// Which backend process this is (frontend, frontendWorker, publishWorker, …),
// taken from the entry script so the API and workers on one host stay apart.
const processName = path.basename(process.argv[1] ?? 'unknown', '.js')

// Pool saturation and event-loop delay, sampled together so a slow request can
// be attributed to waiting for a pool client or to a blocked loop. Every
// backend process owns exactly one pool, so this covers each process's loop.
const startRuntimeMetrics = (pool: pg.Pool) => {
  const resolutionMs = 10
  const loopDelay = monitorEventLoopDelay({ resolution: resolutionMs })
  loopDelay.enable()
  // The histogram records the time between its timer ticks, so an idle loop
  // reads as the resolution. Report only the delay beyond it.
  const nsToMs = (ns: number) => Math.max(0, ns / 1e6 - resolutionMs)

  const timer = setInterval(() => {
    sendMetricToVictoria({
      measurement: 'auto_drive_runtime',
      tags: {
        chain: config.monitoring.metricEnvironmentTag,
        process: processName,
      },
      fields: {
        pg_pool_total: pool.totalCount,
        pg_pool_idle: pool.idleCount,
        pg_pool_waiting: pool.waitingCount,
        event_loop_delay_p50_ms: nsToMs(loopDelay.percentile(50)),
        event_loop_delay_p99_ms: nsToMs(loopDelay.percentile(99)),
        event_loop_delay_max_ms: nsToMs(loopDelay.max),
      },
    })
    loopDelay.reset()
  }, RUNTIME_METRICS_INTERVAL_MS)
  timer.unref()

  return () => {
    clearInterval(timer)
    loopDelay.disable()
  }
}

const createDB = async (): Promise<pg.Pool> => {
  const pool = new pg.Pool({
    connectionString: config.postgres.url,
    max: config.postgres.poolMax,
    ...(process.env.ACCEPT_UNAUTHORIZED_CERTS === 'true'
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  })

  // Verify the connection works, then release the client back to the pool
  const client = await pool.connect()
  client.release()

  logger.info(
    'Connected to PostgreSQL at %s (pool max %d)',
    describeTarget(config.postgres.url),
    config.postgres.poolMax,
  )

  // Nothing would receive the samples without an endpoint
  if (config.monitoring.victoriaEndpoint) {
    stopRuntimeMetrics = startRuntimeMetrics(pool)
  }

  // DEBUG: wrap query for tracing
  const origQuery = pool.query.bind(pool)
  pool.query = ((...args: Parameters<typeof pool.query>) => {
    logger.trace(
      'SQL Query: %s',
      typeof args[0] === 'string' ? args[0] : '<prepared>',
    )
    return origQuery(...args)
  }) as typeof pool.query

  return pool
}

export const getDatabase = async () => {
  if (!db) {
    db = createDB().catch((error) => {
      db = undefined
      throw error
    })
  }

  return db
}

export const closeDatabase = async () => {
  stopRuntimeMetrics?.()
  stopRuntimeMetrics = undefined
  if (db) {
    const pending = db
    db = undefined
    // A pool that never connected has nothing to end
    const pool = await pending.catch(() => undefined)
    await pool?.end()
  }
}

process.on('beforeExit', closeDatabase)
