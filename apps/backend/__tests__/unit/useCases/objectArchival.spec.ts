import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'

// Mock repositories before importing the module under test
jest.unstable_mockModule(
  '../../../src/infrastructure/repositories/index.js',
  () => ({
    metadataRepository: {
      markAsArchived: jest.fn(),
      getMetadata: jest.fn(),
      getMetadataByIsArchived: jest.fn(),
    },
    nodesRepository: {
      getNodesByRootCid: jest.fn(),
      removeNodeDataByRootCid: jest.fn(),
    },
    ownershipRepository: {
      getOwnerships: jest.fn(),
    },
  }),
)

// These imports must come after the mocks are registered
const { ObjectUseCases } = await import(
  '../../../src/core/objects/object.js'
)
const { metadataRepository, nodesRepository } = await import(
  '../../../src/infrastructure/repositories/index.js'
)

describe('ObjectUseCases.onObjectArchived', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('skips archival and does not delete encoded_node when object has no nodes', async () => {
    // Simulates the broken state: is_archived=true was set without nodes existing,
    // which previously caused permanent download failure.
    jest
      .spyOn(nodesRepository, 'getNodesByRootCid')
      .mockResolvedValue([])

    await ObjectUseCases.onObjectArchived('cid-with-no-nodes')

    expect(nodesRepository.getNodesByRootCid).toHaveBeenCalledWith(
      'cid-with-no-nodes',
    )
    // Guard must prevent these from being called
    expect(metadataRepository.markAsArchived).not.toHaveBeenCalled()
    expect(nodesRepository.removeNodeDataByRootCid).not.toHaveBeenCalled()
  })

  it('archives normally when nodes exist', async () => {
    const mockNodes = [
      {
        cid: 'node-cid-1',
        root_cid: 'cid-with-nodes',
        head_cid: 'cid-with-nodes',
        type: 'file',
        piece_index: 1,
        piece_offset: 100,
      },
    ]

    jest
      .spyOn(nodesRepository, 'getNodesByRootCid')
      .mockResolvedValue(mockNodes as never)

    jest.spyOn(metadataRepository, 'markAsArchived').mockResolvedValue()
    jest
      .spyOn(nodesRepository, 'removeNodeDataByRootCid')
      .mockResolvedValue()

    await ObjectUseCases.onObjectArchived('cid-with-nodes')

    expect(metadataRepository.markAsArchived).toHaveBeenCalledWith(
      'cid-with-nodes',
    )
    expect(nodesRepository.removeNodeDataByRootCid).toHaveBeenCalledWith(
      'cid-with-nodes',
    )
  })
})
