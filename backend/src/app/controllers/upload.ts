import { Router, Request, Response } from 'express'
import { handleAuth } from '../../infrastructure/services/auth/express.js'
import { UploadsUseCases } from '../../core/uploads/uploads.js'
import multer from 'multer'
import { FolderTreeFolderSchema, uploadOptionsSchema } from '@auto-drive/models'
import { z } from 'zod'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

const logger = createLogger('http:controllers:upload')

const uploadController = Router()

uploadController.post(
  '/file',
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
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

    const uploadResult = await handleInternalError(
      UploadsUseCases.createFileUpload(
        user,
        filename,
        mimeType ?? null,
        safeUploadOptions.data,
      ),
      'Failed to create file upload',
    )

    if (uploadResult.isErr()) {
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
    const { fileTree, uploadOptions } = req.body
    const safeFileTree = FolderTreeFolderSchema.safeParse(fileTree)
    if (!safeFileTree.success) {
      res.status(400).json({
        error: 'Invalid file tree',
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

    const upload = await handleInternalError(
      UploadsUseCases.createFolderUpload(
        user,
        safeFileTree.data.name,
        safeFileTree.data,
        safeUploadOptions.data,
      ),
      'Failed to create folder upload',
    )

    if (upload.isErr()) {
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

    const { uploadId } = req.params
    const { name, mimeType, relativeId, uploadOptions } = req.body

    if (typeof name !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid field: name',
      })
      return
    }

    if (typeof relativeId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid field: relativeId',
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

    const uploadResult = await handleInternalError(
      UploadsUseCases.createFileInFolder(
        user,
        uploadId,
        relativeId,
        name,
        mimeType ?? null,
        safeUploadOptions.data,
      ),
      'Failed to create file in folder',
    )

    if (uploadResult.isErr()) {
      handleError(uploadResult.error, res)
      return
    }

    res.status(200).json(uploadResult.value)
  }),
)

uploadController.post(
  '/file/:uploadId/chunk',
  multer().single('file'),
  asyncSafeHandler(async (req: Request, res: Response) => {
    const user = await handleAuth(req, res)
    if (!user) {
      return
    }
    const { uploadId } = req.params
    const chunk = req.file?.buffer
    let { index } = req.body

    if (!chunk) {
      res.status(400).json({
        error: 'Missing chunk: expected formData entry in field `file`',
      })
      return
    }

    index = parseInt(index)
    if (isNaN(index)) {
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
