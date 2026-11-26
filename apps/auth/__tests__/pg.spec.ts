import { jest } from '@jest/globals'
import pg from 'pg'
import {
  closeDatabase,
  createDB,
  getDatabase,
  TransactionConflictError,
  withTransaction,
} from '../src/drivers/pg.js'

describe('getDatabase', () => {
  afterEach(async () => {
    jest.restoreAllMocks()
    await closeDatabase()
  })

  it('gives callers that arrive together one connection', async () => {
    const connect = jest.spyOn(pg.Client.prototype, 'connect')

    const clients = await Promise.all([
      getDatabase(),
      getDatabase(),
      getDatabase(),
    ])

    expect(new Set(clients).size).toBe(1)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('connects again after the server ends the connection', async () => {
    const dropped = await getDatabase()
    const { rows } = await dropped.query('SELECT pg_backend_pid() AS pid')
    const ended = new Promise((resolve) => dropped.once('end', resolve))

    const other = await createDB()
    try {
      await other.query('SELECT pg_terminate_backend($1)', [rows[0].pid])
    } finally {
      await other.end()
    }
    await ended

    const client = await getDatabase()
    expect(client).not.toBe(dropped)
    const result = await client.query('SELECT 1 AS one')
    expect(result.rows).toEqual([{ one: 1 }])
  })

  it('tries again after a connection that failed', async () => {
    jest
      .spyOn(pg.Client.prototype, 'connect')
      .mockImplementationOnce(() => Promise.reject(new Error('refused')))

    await expect(getDatabase()).rejects.toThrow('refused')

    const client = await getDatabase()
    const result = await client.query('SELECT 1 AS one')
    expect(result.rows).toEqual([{ one: 1 }])
  })
})

describe('withTransaction', () => {
  // What Aurora DSQL answers when another transaction committed first.
  const conflict = () =>
    Object.assign(new Error('change conflicts with another transaction'), {
      code: '40001',
    })

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('runs a transaction that conflicted again', async () => {
    let runs = 0
    const result = await withTransaction(async (db) => {
      runs++
      if (runs < 3) throw conflict()
      const { rows } = await db.query('SELECT 1 AS one')
      return rows[0]
    })

    expect(result).toEqual({ one: 1 })
    expect(runs).toBe(3)
  })

  it('gives up after five runs', async () => {
    let runs = 0
    const error = conflict()

    const result = withTransaction(async () => {
      runs++
      throw error
    })

    await expect(result).rejects.toBeInstanceOf(TransactionConflictError)
    await expect(result).rejects.toMatchObject({ cause: error })
    expect(runs).toBe(5)
  })

  it('runs a transaction that failed otherwise once', async () => {
    let runs = 0
    const error = Object.assign(new Error('duplicate key'), { code: '23505' })

    await expect(
      withTransaction(async () => {
        runs++
        throw error
      }),
    ).rejects.toBe(error)
    expect(runs).toBe(1)
  })
})
