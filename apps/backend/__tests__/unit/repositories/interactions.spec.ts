import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  interactionsRepository,
  type Executor,
} from '../../../src/infrastructure/repositories/objects/interactions.js'
import { InteractionType, InteractionSource } from '@auto-drive/models'

describe('interactionsRepository — getInteractionsByAccountIdAndTypeInTimeRange', () => {
  let queryMock: jest.Mock
  let executor: Executor

  beforeEach(() => {
    queryMock = jest.fn().mockResolvedValue({ rows: [] } as never)
    executor = { query: queryMock } as unknown as Executor
  })

  it('omits upper bound when end is undefined', async () => {
    await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
      'acc-1',
      InteractionType.Upload,
      new Date('2026-01-01T00:00:00.000Z'),
      undefined,
      InteractionSource.FreeTier,
      executor,
    )

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('created_at <')
    expect(sql).not.toContain('created_at <=')
    expect(params).toEqual([
      'acc-1',
      InteractionType.Upload,
      '2026-01-01T00:00:00.000Z',
      InteractionSource.FreeTier,
    ])
  })

  it('expands upper bound to next millisecond boundary to protect against microsecond truncation', async () => {
    const end = new Date('2026-10-19T12:00:00.123Z')
    await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
      'acc-1',
      InteractionType.Upload,
      new Date('2026-10-01T00:00:00.000Z'),
      end,
      InteractionSource.FreeTier,
      executor,
    )

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('created_at < $4')
    // 123ms + 1ms = 124ms
    expect(params[3]).toBe('2026-10-19T12:00:00.124Z')
    expect(params[4]).toBe(InteractionSource.FreeTier)
  })

  it('omits source filter when source is undefined', async () => {
    await interactionsRepository.getInteractionsByAccountIdAndTypeInTimeRange(
      'acc-1',
      InteractionType.Download,
      new Date('2026-01-01T00:00:00.000Z'),
      undefined,
      undefined,
      executor,
    )

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('source =')
    expect(params).toEqual([
      'acc-1',
      InteractionType.Download,
      '2026-01-01T00:00:00.000Z',
    ])
  })
})
