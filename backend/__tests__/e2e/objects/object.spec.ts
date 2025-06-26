import { UserWithOrganization } from '@auto-drive/models'
import { AuthManager } from '../../../src/services/auth/index.js'
import { ObjectUseCases } from '../../../src/useCases/index.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { PreconditionError } from '../../utils/error.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { uploadFile } from '../../utils/uploads.js'
import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { downloadService } from '../../../src/services/download/index.js'
import { Readable } from 'stream'

describe('Object', () => {
  let user: UserWithOrganization
  let fileCid: string

  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
    user = createMockUser()
    fileCid = await uploadFile(user, 'test.txt', 'test', 'text/plain')
  })

  afterAll(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should get object summary by cid', async () => {
    const summary = await ObjectUseCases.getObjectSummaryByCID(fileCid)
    expect(summary).toBeDefined()
  })

  it('should not get listed in deleted objects', async () => {
    const summary = await ObjectUseCases.getMarkedAsDeletedRoots(user)
    expect(summary.rows.length).toBe(0)
  })

  it('for not admin user should not be able to share object', async () => {
    const mockUser = createMockUser()
    await expect(
      ObjectUseCases.shareObject(mockUser, fileCid, user.publicId!),
    ).rejects.toThrow(new Error('User is not an admin of this object'))
  })

  it('User that is not owner should not be able to delete object', async () => {
    const mockUser = createMockUser()
    await expect(
      ObjectUseCases.markAsDeleted(mockUser, fileCid),
    ).rejects.toThrow(new Error('User is not an owner of this object'))
  })

  it('User that is not owner should not be able to restore object', async () => {
    const mockUser = createMockUser()
    await expect(
      ObjectUseCases.restoreObject(mockUser, fileCid),
    ).rejects.toThrow(new Error('User is not an owner of this object'))
  })

  it('isArchived should return false for not archived object', async () => {
    const isArchived = await ObjectUseCases.isArchived(v4())
    expect(isArchived).toBe(false)
  })

  it('isArchived should return true for archived object', async () => {
    const downloadSpy = jest.spyOn(downloadService, 'download')
    downloadSpy.mockResolvedValueOnce(
      new Readable({
        read: async function () {
          this.push(null)
        },
      }),
    )
    await ObjectUseCases.onObjectArchived(fileCid)
    const isArchived = await ObjectUseCases.isArchived(fileCid)
    expect(isArchived).toBe(true)
    expect(downloadSpy).toHaveBeenCalledTimes(1)
  })

  it('should get listed in user objects', async () => {
    const summary = await ObjectUseCases.getRootObjects(
      {
        scope: 'user',
        user,
      },
      1,
      0,
    )
    expect(summary.rows).toMatchObject([
      {
        headCid: fileCid,
      },
    ])
  })

  it('should get listed in global objects', async () => {
    const summary = await ObjectUseCases.getRootObjects(
      {
        scope: 'global',
      },
      1,
      0,
    )
    expect(summary.rows).toMatchObject([
      {
        headCid: fileCid,
      },
    ])
  })

  it('should be able to mark as deleted and get listed in deleted objects', async () => {
    await expect(
      ObjectUseCases.markAsDeleted(user, fileCid),
    ).resolves.not.toThrow()

    const deletedSummary = await ObjectUseCases.getMarkedAsDeletedRoots(user)
    expect(deletedSummary.rows).toMatchObject([
      {
        headCid: fileCid,
      },
    ])
  })

  it('should be able to restore object', async () => {
    await expect(
      ObjectUseCases.restoreObject(user, fileCid),
    ).resolves.not.toThrow()

    const deletedSummary = await ObjectUseCases.getMarkedAsDeletedRoots(user)
    expect(deletedSummary.rows).toMatchObject([])

    const summary = await ObjectUseCases.getRootObjects(
      {
        scope: 'user',
        user,
      },
      1,
      0,
    )

    expect(summary.rows).toMatchObject([
      {
        headCid: fileCid,
      },
    ])

    const globalSummary = await ObjectUseCases.getRootObjects(
      {
        scope: 'global',
      },
      1,
      0,
    )

    expect(globalSummary.rows).toMatchObject([
      {
        headCid: fileCid,
      },
    ])
  })

  it('should be able to search object by name', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')

    const search = await ObjectUseCases.searchMetadataByName(
      metadata.name!,
      5,
      {
        scope: 'user',
        user,
      },
    )
    expect(search).toMatchObject([{ metadata }])
  })

  it('should be able to see another user with user scope', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')
    const mockUser = createMockUser()
    const search = await ObjectUseCases.searchMetadataByName(
      metadata.name!,
      5,
      {
        scope: 'user',
        user: mockUser,
      },
    )
    expect(search).toMatchObject([])
  })

  it('should be able to see another user with global scope', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')
    const search = await ObjectUseCases.searchMetadataByName(
      metadata.name!,
      5,
      {
        scope: 'global',
      },
    )
    expect(search).toMatchObject([{ metadata }])
  })

  it('should be able to search object by cid', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')

    const search = await ObjectUseCases.searchMetadataByCID(fileCid, 5, {
      scope: 'user',
      user,
    })
    expect(search).toMatchObject([{ metadata }])
  })

  it('should be able to search object by name (using common method)', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')

    const search = await ObjectUseCases.searchByCIDOrName(metadata.name!, 5, {
      scope: 'user',
      user,
    })
    expect(search).toMatchObject([
      {
        cid: fileCid,
        name: metadata.name,
      },
    ])
  })

  it('should be able to search object by cid (using common method)', async () => {
    const metadata = await ObjectUseCases.getMetadata(fileCid)
    if (!metadata) throw new PreconditionError('Metadata not found')

    const search = await ObjectUseCases.searchByCIDOrName(fileCid, 5, {
      scope: 'user',
      user,
    })
    expect(search).toMatchObject([
      {
        cid: fileCid,
        name: metadata.name,
      },
    ])
  })

  const sharedWithUser = createMockUser()
  describe('Share object', () => {
    let randomFile: string
    it('should be able to share object', async () => {
      const mockUser = createMockUser()
      randomFile = await uploadFile(
        mockUser,
        'test.txt',
        Buffer.from(Math.random().toString()),
        'text/plain',
      )

      jest
        .spyOn(AuthManager, 'getUserFromPublicId')
        .mockResolvedValueOnce(sharedWithUser)

      await expect(
        ObjectUseCases.shareObject(mockUser, randomFile, user.publicId!),
      ).resolves.not.toThrow()

      const sharedRoots = await ObjectUseCases.getSharedRoots(sharedWithUser)
      expect(sharedRoots.rows).toMatchObject([
        {
          headCid: randomFile,
        },
      ])
    })

    it('should be able to delete shared object', async () => {
      await expect(
        ObjectUseCases.markAsDeleted(sharedWithUser, randomFile),
      ).resolves.not.toThrow()
    })

    it('should not be listed in shared objects', async () => {
      const sharedRoots = await ObjectUseCases.getSharedRoots(sharedWithUser)
      expect(sharedRoots.rows).toMatchObject([])
    })

    it('should be able to restore shared object', async () => {
      await expect(
        ObjectUseCases.restoreObject(sharedWithUser, randomFile),
      ).resolves.not.toThrow()

      const sharedRoots = await ObjectUseCases.getSharedRoots(sharedWithUser)
      expect(sharedRoots.rows).toMatchObject([
        {
          headCid: randomFile,
        },
      ])
    })

    it('should be able to add tag to object', async () => {
      await expect(
        ObjectUseCases.addTag(fileCid, 'test'),
      ).resolves.not.toThrow()
    })

    it('should be able to search object by tag', async () => {
      const object = await ObjectUseCases.publishObject(user, fileCid)
      expect(object).toBeDefined()
    })

    it('should be able to unpublish object', async () => {
      await expect(
        ObjectUseCases.unpublishObject(user, fileCid),
      ).resolves.not.toThrow()

      const object = await ObjectUseCases.getObjectInformation(fileCid)
      expect(object?.publishedObjectId).toBeDefined()
    })

    it('should return undefined if object is not published', async () => {
      const object = await ObjectUseCases.getObjectInformation(fileCid)
      expect(object?.publishedObjectId).toBeNull()
    })
  })
})
