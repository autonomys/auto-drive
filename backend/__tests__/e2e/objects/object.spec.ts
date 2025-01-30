import { UserWithOrganization } from '../../../src/models/users'
import { AuthManager } from '../../../src/services/auth'
import { ObjectUseCases } from '../../../src/useCases'
import { dbMigration } from '../../utils/dbMigrate'
import { PreconditionError } from '../../utils/error'
import { createMockUser } from '../../utils/mocks'
import { uploadFile } from '../../utils/uploads'
import { jest } from '@jest/globals'

describe('Object', () => {
  let user: UserWithOrganization
  let fileCid: string

  beforeAll(async () => {
    await dbMigration.up()
    user = createMockUser()
    fileCid = await uploadFile(user, 'test.txt', 'test', 'text/plain')
  })

  afterAll(async () => {
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
  })
})
