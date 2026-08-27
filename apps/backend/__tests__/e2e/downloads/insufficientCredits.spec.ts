import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { randomBytes } from 'crypto'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { AccountsUseCases } from '../../../src/core/index.js'
import { DownloadUseCase } from '../../../src/core/downloads/index.js'
import { downloadService } from '../../../src/infrastructure/services/download/index.js'
import { PaymentRequiredError } from '../../../src/errors/index.js'

jest.setTimeout(120_000)

/**
 * A download that cannot be paid for must not leave a stream behind.
 *
 * downloadService.download forks the source for caching before it returns, and
 * the forks are only reachable through the value it hands back. If the charge
 * is taken after that and throws, the caller never receives the stream and
 * nothing can close it: a paused source, a paused fork and an open cache write,
 * leaked per attempt — on the very path (out of credits) where a client retries
 * hardest.
 */
describe('a download the reader cannot pay for', () => {
  const user = createMockUser()

  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
    await AccountsUseCases.getOrCreateAccount(user)
  })
  // Each test mocks the credit accounting, which the upload path also consults.
  // Restore between tests so one test's "no budget" does not fail the next
  // test's upload.
  afterEach(() => {
    jest.restoreAllMocks()
    mockRabbitPublish()
  })
  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
    jest.clearAllMocks()
  })

  it('is refused without ever constructing a stream', async () => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      `credits-${v4()}.bin`,
      'application/octet-stream',
      null,
    )
    await UploadsUseCases.uploadChunk(user, created.id, 0, randomBytes(64 * 1024))
    const cid = await UploadsUseCases.completeUpload(user, created.id)

    // No download budget at all.
    jest
      .spyOn(AccountsUseCases, 'getPendingCreditsByUserAndType')
      .mockResolvedValue(0)
    // Kept honest: if the pre-check is removed, the charge still rejects, so the
    // test would pass on the strength of the throw alone. The spy below is what
    // makes it a real assertion.
    jest
      .spyOn(AccountsUseCases, 'registerInteraction')
      .mockRejectedValue(new PaymentRequiredError('Insufficient credits'))

    const downloadSpy = jest.spyOn(downloadService, 'download')

    const result = await DownloadUseCase.downloadObjectByUser(user, cid, {})
    if (result.isErr()) throw new Error('expected metadata to resolve')

    await expect(result.value.startDownload()).rejects.toBeInstanceOf(
      PaymentRequiredError,
    )

    // The point: no stream was ever built, so there is nothing to leak.
    expect(downloadSpy).not.toHaveBeenCalled()
  })

  it('destroys the stream if the budget disappears after it is built', async () => {
    const created = await UploadsUseCases.createFileUpload(
      user,
      `credits-race-${v4()}.bin`,
      'application/octet-stream',
      null,
    )
    await UploadsUseCases.uploadChunk(user, created.id, 0, randomBytes(64 * 1024))
    const cid = await UploadsUseCases.completeUpload(user, created.id)

    // Pre-check passes, then a concurrent download eats the budget: the stream
    // exists by the time the charge rejects.
    jest
      .spyOn(AccountsUseCases, 'getPendingCreditsByUserAndType')
      .mockResolvedValue(Number.MAX_SAFE_INTEGER)
    jest
      .spyOn(AccountsUseCases, 'registerInteraction')
      .mockRejectedValue(new PaymentRequiredError('Insufficient credits'))

    const realDownload = downloadService.download.bind(downloadService)
    let built: Awaited<ReturnType<typeof realDownload>> | undefined
    jest.spyOn(downloadService, 'download').mockImplementation(async (c, o) => {
      built = await realDownload(c, o)
      return built
    })

    const result = await DownloadUseCase.downloadObjectByUser(user, cid, {})
    if (result.isErr()) throw new Error('expected metadata to resolve')

    await expect(result.value.startDownload()).rejects.toBeInstanceOf(
      PaymentRequiredError,
    )

    // Drained to completion rather than left paused: the source and both cache
    // branches finish, so nothing is leaked. (Destroying it instead would throw
    // from inside stream-fork, which writes to every branch unconditionally.)
    expect(built).toBeDefined()
    await new Promise<void>((resolve, reject) => {
      if (built!.readableEnded) return resolve()
      built!.once('end', resolve)
      built!.once('close', resolve)
      setTimeout(() => reject(new Error('stream never finished — leaked')), 10_000)
    })
    expect(built!.readableEnded || built!.destroyed).toBe(true)
  })
})
