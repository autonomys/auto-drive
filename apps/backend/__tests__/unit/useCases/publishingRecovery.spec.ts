import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { PublishingRecoveryUseCases } from '../../../src/core/objects/publishingRecovery.js'
import { nodesRepository } from '../../../src/infrastructure/repositories/index.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { config } from '../../../src/config.js'

describe('PublishingRecoveryUseCases.processPublishingRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('re-enqueues unpublished node CIDs in batches for stuck objects', async () => {
    const rootCids = ['root-1']
    const unpublishedCids = Array.from({ length: 75 }, (_, i) => `cid-${i}`)

    jest
      .spyOn(nodesRepository, 'getUnrecoverablePublishingRootCids')
      .mockResolvedValue([])
    jest
      .spyOn(nodesRepository, 'getStuckPublishingRootCids')
      .mockResolvedValue(rootCids)
    jest
      .spyOn(nodesRepository, 'getUnpublishedNodeCidsByRootCid')
      .mockResolvedValue(unpublishedCids)
    const touchSpy = jest
      .spyOn(nodesRepository, 'touchUnpublishedNodesByRootCid')
      .mockResolvedValue(undefined)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await PublishingRecoveryUseCases.processPublishingRecovery()

    // 75 nodes with batch size 50 = 2 batches (50, 25)
    expect(publishSpy).toHaveBeenCalledTimes(2)
    const tasks = publishSpy.mock.calls.map(
      (call) => call[0] as { id: string; params: { nodes: string[] } },
    )
    expect(tasks[0].id).toBe('publish-nodes')
    expect(tasks[0].params.nodes).toHaveLength(50)

    expect(tasks[1].id).toBe('publish-nodes')
    expect(tasks[1].params.nodes).toHaveLength(25)
    expect(touchSpy).toHaveBeenCalledWith('root-1')
  })

  it('queries getStuckPublishingRootCids with configured limit, staleness blocks, and retry cooldown', async () => {
    const getUnrecSpy = jest
      .spyOn(nodesRepository, 'getUnrecoverablePublishingRootCids')
      .mockResolvedValue([])
    const getStuckSpy = jest
      .spyOn(nodesRepository, 'getStuckPublishingRootCids')
      .mockResolvedValue([])

    await PublishingRecoveryUseCases.processPublishingRecovery()

    expect(getUnrecSpy).toHaveBeenCalledWith(
      config.publishingRecovery.maxObjectsPerCycle,
    )
    expect(getStuckSpy).toHaveBeenCalledWith(
      config.publishingRecovery.maxObjectsPerCycle,
      config.publishingRecovery.stalenessThresholdBlocks,
      config.publishingRecovery.retryCooldownMs,
    )
  })

  it('does nothing when no stuck objects are found', async () => {
    jest
      .spyOn(nodesRepository, 'getUnrecoverablePublishingRootCids')
      .mockResolvedValue([])
    jest
      .spyOn(nodesRepository, 'getStuckPublishingRootCids')
      .mockResolvedValue([])
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await PublishingRecoveryUseCases.processPublishingRecovery()

    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('skips objects that have no unpublished nodes remaining', async () => {
    jest
      .spyOn(nodesRepository, 'getUnrecoverablePublishingRootCids')
      .mockResolvedValue([])
    jest
      .spyOn(nodesRepository, 'getStuckPublishingRootCids')
      .mockResolvedValue(['root-already-done'])
    jest
      .spyOn(nodesRepository, 'getUnpublishedNodeCidsByRootCid')
      .mockResolvedValue([])
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await PublishingRecoveryUseCases.processPublishingRecovery()

    expect(publishSpy).not.toHaveBeenCalled()
  })
})
