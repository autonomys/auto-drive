import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { isTaskQueueBusy } from '../../../src/shared/utils/queue.js'
import { Rabbit } from '../../../src/infrastructure/drivers/rabbit.js'

describe('isTaskQueueBusy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('defers on any pending message in task-manager by default (threshold 0)', async () => {
    jest.spyOn(Rabbit, 'getMessageCount').mockResolvedValue(1)
    await expect(isTaskQueueBusy('caller')).resolves.toBe(true)
  })

  it('does not defer when the default queue is empty', async () => {
    jest.spyOn(Rabbit, 'getMessageCount').mockResolvedValue(0)
    await expect(isTaskQueueBusy('caller')).resolves.toBe(false)
  })

  it('inspects the requested queue', async () => {
    const spy = jest.spyOn(Rabbit, 'getMessageCount').mockResolvedValue(0)
    await isTaskQueueBusy('caller', 'publish-manager', 100)
    expect(spy).toHaveBeenCalledWith('publish-manager')
  })

  it('does not defer while depth is at or below the threshold', async () => {
    jest.spyOn(Rabbit, 'getMessageCount').mockResolvedValue(100)
    await expect(
      isTaskQueueBusy('caller', 'publish-manager', 100),
    ).resolves.toBe(false)
  })

  it('defers once depth exceeds the threshold', async () => {
    jest.spyOn(Rabbit, 'getMessageCount').mockResolvedValue(101)
    await expect(
      isTaskQueueBusy('caller', 'publish-manager', 100),
    ).resolves.toBe(true)
  })

  it('proceeds (returns false) when the depth check throws', async () => {
    jest
      .spyOn(Rabbit, 'getMessageCount')
      .mockRejectedValue(new Error('broker unavailable'))
    await expect(
      isTaskQueueBusy('caller', 'publish-manager', 100),
    ).resolves.toBe(false)
  })
})
