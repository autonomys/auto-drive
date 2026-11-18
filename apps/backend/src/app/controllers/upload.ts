import { json, Router, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { UploadsUseCases } from '../../core/uploads/uploads.js'
import multer from 'multer'
import { FolderTreeFolderSchema, uploadOptionsSchema } from '@auto-drive/models'
import { z } from 'zod'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'
import { config } from '../../config.js'
import { parseCustomerReference } from '../../core/uploads/customerReference.js'

const logger = createLogger('http:controllers:upload')

// The caller's optional reference for the customer an upload is for (#892).
// Read when a file or folder upload is created; a file in a folder upload
// inherits the folder's.
const CUSTOMER_REFERENCE_HEADER = 'x-customer-reference'

// apis/frontend.ts mounts this router before its body parsers, so each route
// reads its JSON body here, after the credential check. Resolves false once it
// has answered a body it could not read. The limit defaults to 100 KB.
const readJson = (req: Request, res: Response, limit?: string) =>
  new Promise<boolean>((resolve) => {
    json({ limit })(req, res, (err?: { status?: number; message?: string }) => {
      if (err) {
        res.status(err.status ?? 400).json({ error: err.message })
      }
      resolve(!err)
    })
  })

const uploadController = Router()

const chunkParser = multer({
  limits: {
    // The parser rejects a file that reaches fileSize, so a part of exactly the
    // maximum needs one byte more.
    fileSize: config.express.uploadChunkMaxBytes + 1,
    files: 1,
    fields: 4,
    fieldSize: 1024,
  },
}).single('file')

// Reads the multipart chunk body. Resolves false once it has answered a body it
// could not read: 413 for a part that is too large, 400 for anything else (with
// memory storage every parser error is about the body or the connection).
const parseChunk = (req: Request, res: Response) =>
  new Promise<boolean>((resolve) => {
    chunkParser(req, res, (err: unknown) => {
      if (!err) {
        resolve(true)
        return
      }
      const tooLarge =
        err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? `Chunk exceeds the ${config.express.uploadChunkMaxBytes} byte limit`
          : `Invalid chunk form: ${err instanceof Error ? err.message : err}`,
      })
      resolve(false)
    })
  })

uploadController.post(
  '/file',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    if (!(await readJson(req, res))) {
      return
    }

    const { mimeType, filename, uploadOptions } = req.body

    if (typeof filename !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid field: filename',
      })
      return
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      res.status(400).json({
        error: 'Invalid upload options',
      })
      return
    }

    const customerReference = parseCustomerReference(
      req.headers[CUSTOMER_REFERENCE_HEADER],
    )
    if (customerReference.isErr()) {
      handleError(customerReference.error, res)
      return
    }

    const uploadResult = await handleInternalError(
      UploadsUseCases.createFileUpload(
        user,
        filename,
        mimeType ?? null,
        safeUploadOptions.data,
        null,
        null,
        customerReference.value,
      ),
      'Failed to create file upload',
    )

    if (uploadResult.isErr()) {
      logger.error('Failed to create file upload', {
        error: uploadResult.error,
      })
      handleError(uploadResult.error, res)
      return
    }

    res.status(200).json(uploadResult.value)
  }),
)

uploadController.post(
  '/folder',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    // A folder tree grows with the number of files in it.
    if (!(await readJson(req, res, config.express.requestSizeLimit))) {
      return
    }
    const { fileTree, uploadOptions } = req.body
    const safeFileTree = FolderTreeFolderSchema.safeParse(fileTree)
    if (!safeFileTree.success) {
      logger.error('Invalid file tree', {
        error: safeFileTree.error,
      })
      res.status(400).json({
        error: 'Invalid file tree',
      })
      return
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      logger.error('Invalid upload options', {
        error: safeUploadOptions.error,
      })
      res.status(400).json({
        error: 'Invalid upload options',
      })
      return
    }

    const customerReference = parseCustomerReference(
      req.headers[CUSTOMER_REFERENCE_HEADER],
    )
    if (customerReference.isErr()) {
      handleError(customerReference.error, res)
      return
    }

    const upload = await handleInternalError(
      UploadsUseCases.createFolderUpload(
        user,
        safeFileTree.data.name,
        safeFileTree.data,
        safeUploadOptions.data,
        customerReference.value,
      ),
      'Failed to create folder upload',
    )

    if (upload.isErr()) {
      logger.error('Failed to create folder upload', {
        error: upload.error,
      })
      handleError(upload.error, res)
      return
    }

    res.status(200).json(upload.value)
  }),
)

uploadController.post(
  '/folder/:uploadId/file',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    if (!(await readJson(req, res))) {
      return
    }

    const { uploadId } = req.params
    const { name, mimeType, relativeId, uploadOptions } = req.body

    if (typeof name !== 'string') {
      logger.error('Invalid name', {
        name,
      })
      res.status(400).json({
        error: 'Missing or invalid field: name',
      })
      return
    }

    if (typeof relativeId !== 'string') {
      logger.error('Invalid relativeId', {
        relativeId,
      })
      res.status(400).json({
        error: 'Missing or invalid field: relativeId',
      })
      return
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      logger.error('Invalid upload options', {
        error: safeUploadOptions.error,
      })
      res.status(400).json({
        error: 'Invalid upload options',
      })
      return
    }

    const customerReference = parseCustomerReference(
      req.headers[CUSTOMER_REFERENCE_HEADER],
    )
    if (customerReference.isErr()) {
      handleError(customerReference.error, res)
      return
    }

    const uploadResult = await handleInternalError(
      UploadsUseCases.createFileInFolder(
        user,
        uploadId,
        relativeId,
        name,
        mimeType ?? null,
        safeUploadOptions.data,
        customerReference.value,
      ),
      'Failed to create file in folder',
    )

    if (uploadResult.isErr()) {
      logger.error('Failed to create file in folder', {
        error: uploadResult.error,
      })
      handleError(uploadResult.error, res)
      return
    }

    res.status(200).json(uploadResult.value)
  }),
)

uploadController.post(
  '/file/:uploadId/chunk',
  asyncSafeHandler(async (req: Request, res: Response) => {
    // Credentials are checked before the body is read.
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    if (!(await parseChunk(req, res))) {
      return
    }

    const { uploadId } = req.params
    const chunk = req.file?.buffer
    let { index } = req.body ?? {} // unset when the body is not multipart

    if (!chunk) {
      logger.error('Missing chunk', {
        uploadId,
      })
      res.status(400).json({
        error: 'Missing chunk: expected formData entry in field `file`',
      })
      return
    }

    index = parseInt(index)
    // A negative index reads as an already-processed part, which uploadChunk
    // skips, so it would be answered 200 without being stored.
    if (isNaN(index) || index < 0) {
      logger.error('Invalid index', {
        index,
      })
      res.status(400).json({
        error: 'Invalid index',
      })
      return
    }

    const uploadChunkResult = await handleInternalError(
      UploadsUseCases.uploadChunk(user, uploadId, index, chunk),
      'Failed to upload chunk',
    )
    if (uploadChunkResult.isErr()) {
      logger.error('Failed to upload chunk', {
        error: uploadChunkResult.error,
      })
      handleError(uploadChunkResult.error, res)
      return
    }

    res.status(200).json({
      message: 'Chunk uploaded',
    })
  }),
)

uploadController.post(
  '/:uploadId/complete',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    const { uploadId } = req.params

    const completeResult = await handleInternalError(
      UploadsUseCases.completeUpload(user, uploadId),
      'Failed to complete upload',
    )

    if (completeResult.isErr()) {
      handleError(completeResult.error, res)
      return
    }

    res.status(200).json({
      cid: completeResult.value,
    })
  }),
)

export { uploadController }
