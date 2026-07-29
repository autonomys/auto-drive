import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { NodesUseCases } from '../../../src/core/objects/nodes.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import {
  uploadsRepository,
  type UploadEntry,
} from '../../../src/infrastructure/repositories/uploads/uploads.js'

describe('UploadsUseCases.scheduleNodesPublish', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('publishes a single message when nodes < BATCH_SIZE', async () => {
    const cids = Array.from({ length: 10 }, (_, i) => `cid-${i}`)
    jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue(cids)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('root-cid')

    expect(publishSpy).toHaveBeenCalledTimes(1)
    const task = publishSpy.mock.calls[0][0] as { id: string; params: { nodes: string[] } }
    expect(task.id).toBe('publish-nodes')
    expect(task.params.nodes).toEqual(cids)
  })

  it('publishes a single message when nodes == BATCH_SIZE (50)', async () => {
    const cids = Array.from({ length: 50 }, (_, i) => `cid-${i}`)
    jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue(cids)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('root-cid')

    expect(publishSpy).toHaveBeenCalledTimes(1)
    const task = publishSpy.mock.calls[0][0] as { params: { nodes: string[] } }
    expect(task.params.nodes).toHaveLength(50)
  })

  it('splits into ceil(N/50) messages when nodes > BATCH_SIZE', async () => {
    const cids = Array.from({ length: 120 }, (_, i) => `cid-${i}`)
    jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue(cids)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('root-cid')

    // 120 nodes → 3 messages: [0..49], [50..99], [100..119]
    expect(publishSpy).toHaveBeenCalledTimes(3)
    const calls = publishSpy.mock.calls as { params: { nodes: string[] } }[][]
    expect(calls[0][0].params.nodes).toHaveLength(50)
    expect(calls[1][0].params.nodes).toHaveLength(50)
    expect(calls[2][0].params.nodes).toHaveLength(20)
  })

  it('publishes no messages when there are no nodes', async () => {
    jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue([])
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('root-cid')

    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('preserves CID ordering across batches', async () => {
    const cids = Array.from({ length: 75 }, (_, i) => `cid-${i}`)
    jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue(cids)
    const publishSpy = jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('root-cid')

    expect(publishSpy).toHaveBeenCalledTimes(2)
    const calls = publishSpy.mock.calls as { params: { nodes: string[] } }[][]
    const allPublished = [
      ...calls[0][0].params.nodes,
      ...calls[1][0].params.nodes,
    ]
    expect(allPublished).toEqual(cids)
  })

  it('uses root cid to look up nodes', async () => {
    const getCidsSpy = jest
      .spyOn(NodesUseCases, 'getCidsByRootCid')
      .mockResolvedValue(['cid-0'])
    jest.spyOn(EventRouter, 'publish').mockReturnValue()

    await UploadsUseCases.scheduleNodesPublish('my-root-cid')

    expect(getCidsSpy).toHaveBeenCalledWith('my-root-cid')
  })
})

describe('UploadsUseCases.processMigration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('skips a concurrent migration for an upload already being migrated', async () => {
    // Block the first run at the upload lookup so it stays in flight, holding
    // the per-upload guard, while we fire a second run for the same upload.
    // getUploadEntryById is called synchronously before the first await, so by
    // the time the second call runs, the upload is already marked in flight.
    let resolveLookup: (value: UploadEntry | null) => void = () => {}
    const lookupGate = new Promise<UploadEntry | null>((resolve) => {
      resolveLookup = resolve
    })
    const getSpy = jest
      .spyOn(uploadsRepository, 'getUploadEntryById')
      .mockReturnValue(lookupGate)

    const first = UploadsUseCases.processMigration('upload-1')
    // Second run for the same upload must short-circuit before touching the repo.
    await UploadsUseCases.processMigration('upload-1')
    expect(getSpy).toHaveBeenCalledTimes(1)

    // Let the first run finish; an unknown upload throws, releasing the guard.
    resolveLookup(null)
    await expect(first).rejects.toThrow('Upload not found')

    // Guard released — a later run for the same upload proceeds again.
    await expect(UploadsUseCases.processMigration('upload-1')).rejects.toThrow(
      'Upload not found',
    )
    expect(getSpy).toHaveBeenCalledTimes(2)
  })
})
