import { Router } from 'express'
import { handleAuth } from '../services/authManager/express.js'
import { UploadsUseCases } from '../useCases/uploads/uploads.js'
import multer from 'multer'
import { FolderTreeFolderSchema } from '../models/objects/folderTree.js'
import { uploadOptionsSchema } from '../models/uploads/upload.js'
import { z } from 'zod'
import { logger } from '../drivers/logger.js'

const uploadController = Router()

uploadController.post('/file', async (req, res) => {
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
    logger.error(error as string)

    res.status(500).json({
      error: 'Failed to create upload',
    })
    return
  }
})

uploadController.post('/folder', async (req, res) => {
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
})

uploadController.post('/folder/:uploadId/file', async (req, res) => {
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
})

uploadController.post(
  '/file/:uploadId/chunk',
  multer().single('file'),
  async (req, res) => {
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
  },
)

uploadController.post('/:uploadId/complete', async (req, res) => {
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
})

export { uploadController }
