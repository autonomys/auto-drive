import { Router, Request, Response } from 'express'
import { handleAuth } from '../../services/auth/express.js'
import { UploadsUseCases } from '../../useCases/uploads/uploads.js'
import multer from 'multer'
import { FolderTreeFolderSchema, uploadOptionsSchema } from '@auto-drive/models'
import { z } from 'zod'
import { createLogger } from '../../drivers/logger.js'
import { asyncSafeHandler } from '../../utils/express.js'

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

    try {
      const upload = await UploadsUseCases.createFileUpload(
        user,
        filename,
        mimeType ?? null,
        safeUploadOptions.data,
      )

      res.status(200).json(upload)
      return
    } catch (error) {
      logger.error(error as Error, 'Failed to create upload')

      res.status(500).json({
        error: 'Failed to create upload',
      })
      return
    }
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

    try {
      const upload = await UploadsUseCases.createFolderUpload(
        user,
        safeFileTree.data.name,
        safeFileTree.data,
        safeUploadOptions.data,
      )

      res.status(200).json(upload)
      return
    } catch (error) {
      logger.error(error)
      res.status(500).json({
        error: 'Failed to create upload',
      })
      return
    }
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

    try {
      const upload = await UploadsUseCases.createFileInFolder(
        user,
        uploadId,
        relativeId,
        name,
        mimeType ?? null,
        safeUploadOptions.data,
      )

      res.status(200).json(upload)
      return
    } catch (error) {
      logger.error(error)
      res.status(500).json({
        error: 'Failed to create file in folder',
      })
      return
    }
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

    try {
      await UploadsUseCases.uploadChunk(user, uploadId, index, chunk)

      res.status(200).json({
        message: 'Chunk uploaded',
      })
      return
    } catch (error) {
      logger.error(error)

      res.status(500).json({
        error: 'Failed to upload chunk',
      })
      return
    }
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

    try {
      const cid = await UploadsUseCases.completeUpload(user, uploadId)

      res.status(200).json({
        cid,
      })
      return
    } catch (error) {
      logger.error(error)
      res.status(500).json({
        error: 'Failed to complete upload',
      })
      return
    }
  }),
)

export { uploadController }
