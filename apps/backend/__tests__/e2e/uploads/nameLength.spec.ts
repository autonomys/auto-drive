import { jest } from '@jest/globals'
import { FolderTreeFolder, UserWithOrganization } from '@auto-drive/models'
import {
  cidToString,
  processFileToIPLDFormat,
  processFolderToIPLDFormat,
  stringToCid,
} from '@autonomys/auto-dag-data'
import { MemoryBlockstore } from 'blockstore-core'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { BadRequestError } from '../../../src/errors/index.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { uploadFile, uploadFolder } from '../../utils/uploads.js'

const fittingNames: [string, string][] = [
  ['255 ASCII bytes', 'a'.repeat(255)],
  ['85 three-byte characters (255 bytes)', '€'.repeat(85)],
]

const tooLongNames: [string, string, number][] = [
  ['256 ASCII bytes', 'a'.repeat(256), 256],
  ['86 euro signs (258 bytes)', '€'.repeat(86), 258],
  ['86 CJK characters (258 bytes)', '文'.repeat(86), 258],
]

const expectTooLong = async (
  attempt: Promise<unknown>,
  name: string,
  bytes: number,
) => {
  await expect(attempt).rejects.toBeInstanceOf(BadRequestError)
  await expect(attempt).rejects.toThrow(
    `Name "${name}" is too long: ${bytes} > 255 bytes`,
  )
}

describe('Upload name byte length', () => {
  let user: UserWithOrganization

  beforeAll(async () => {
    await dbMigration.up()
    user = createMockUser()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(() => {
    mockRabbitPublish()
  })

  afterEach(() => {
    unmockMethods()
  })

  describe('createFileUpload', () => {
    it.each(fittingNames)(
      'accepts %s and completes with the name in the DAG',
      async (_, name) => {
        const content = Buffer.from('content')
        const cid = await uploadFile(user, name, content, 'text/plain')

        const expected = await processFileToIPLDFormat(
          new MemoryBlockstore(),
          [content],
          BigInt(content.length),
          name,
        )
        expect(cid).toBe(cidToString(expected))
      },
    )

    it.each(tooLongNames)(
      'rejects %s before creating the upload',
      async (_, name, bytes) => {
        const createUploadEntry = jest.spyOn(
          uploadsRepository,
          'createUploadEntry',
        )

        await expectTooLong(
          UploadsUseCases.createFileUpload(user, name, null, null),
          name,
          bytes,
        )
        expect(createUploadEntry).not.toHaveBeenCalled()
      },
    )
  })

  describe('createFileInFolder', () => {
    let folderUploadId: string

    beforeAll(async () => {
      const folderUpload = await UploadsUseCases.createFolderUpload(
        user,
        'folder',
        { name: 'folder', type: 'folder', id: 'folder', children: [] },
        null,
      )
      folderUploadId = folderUpload.id
    })

    it.each(fittingNames)('accepts %s', async (_, name) => {
      const upload = await UploadsUseCases.createFileInFolder(
        user,
        folderUploadId,
        'file',
        name,
        null,
      )
      expect(upload.name).toBe(name)
    })

    it.each(tooLongNames)(
      'rejects %s before creating the upload',
      async (_, name, bytes) => {
        const createUploadEntry = jest.spyOn(
          uploadsRepository,
          'createUploadEntry',
        )

        await expectTooLong(
          UploadsUseCases.createFileInFolder(
            user,
            folderUploadId,
            'file',
            name,
            null,
          ),
          name,
          bytes,
        )
        expect(createUploadEntry).not.toHaveBeenCalled()
      },
    )
  })

  describe('createFolderUpload', () => {
    const tree = ({
      root = 'root',
      subfolder = 'subfolder',
      file = 'file.txt',
    }): FolderTreeFolder => ({
      name: root,
      type: 'folder',
      id: 'root',
      children: [
        {
          name: subfolder,
          type: 'folder',
          id: 'subfolder',
          children: [{ name: file, type: 'file', id: 'file' }],
        },
      ],
    })

    it.each(fittingNames)(
      'accepts %s and completes with the name in the DAG',
      async (_, name) => {
        const content = Buffer.from('content')
        const { folderCid, childCids } = await uploadFolder(user, name, [
          { name, content, mimeType: 'text/plain' },
        ])

        const expected = await processFolderToIPLDFormat(
          new MemoryBlockstore(),
          [stringToCid(childCids[name])],
          name,
          BigInt(content.length),
        )
        expect(folderCid).toBe(cidToString(expected))
      },
    )

    it.each(fittingNames)(
      'accepts %s as every nested name',
      async (_, name) => {
        const upload = await UploadsUseCases.createFolderUpload(
          user,
          name,
          tree({ root: name, subfolder: name, file: name }),
          null,
        )
        expect(upload.fileTree.name).toBe(name)
      },
    )

    describe.each(tooLongNames)('rejects %s', (_, name, bytes) => {
      it.each([
        ['as the root folder name', tree({ root: name })],
        ['as a nested folder name', tree({ subfolder: name })],
        ['as a nested file name', tree({ file: name })],
      ])('%s, before creating the upload', async (_, fileTree) => {
        const createUploadEntry = jest.spyOn(
          uploadsRepository,
          'createUploadEntry',
        )

        await expectTooLong(
          UploadsUseCases.createFolderUpload(
            user,
            fileTree.name,
            fileTree,
            null,
          ),
          name,
          bytes,
        )
        expect(createUploadEntry).not.toHaveBeenCalled()
      })
    })
  })
})
