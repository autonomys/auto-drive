import {
  Body,
  Controller,
  Request,
  Path,
  Post,
  Route,
  SuccessResponse,
  UploadedFile,
  FormField,
  Security,
  Response,
} from 'tsoa'
import { Request as TRequest } from 'express'

import { AuthType, handleAuth } from '../../services/auth/express.js'
import { UploadsUseCases } from '../../useCases/uploads/uploads.js'
import {
  FolderTreeFolderSchema,
  uploadOptionsSchema,
  UserWithOrganization,
} from '@auto-drive/models'
import { z } from 'zod'
import { logger } from '../../drivers/logger.js'
import {
  FolderUpload,
  FileUpload,
  ApiResponse,
  ErrorResponse,
} from '@auto-drive/dtos'

interface AuthenticatedRequest extends TRequest {
  user: UserWithOrganization
}

@Route('/uploads')
export class UploadController extends Controller {
  @SuccessResponse(200, 'File upload created')
  @Response<ErrorResponse>(400, 'Bad Request')
  @Post('/file')
  @Security(AuthType.Auth)
  public async createFileUpload(
    @Body()
    requestBody: {
      mimeType?: string
      filename: string
      uploadOptions?: unknown
    },
    @Request() request: AuthenticatedRequest,
  ): Promise<ApiResponse<FileUpload>> {
    const user = await handleAuth(request)
    if (!user) {
      this.setStatus(401)
      return { error: 'Unauthorized' }
    }

    const { mimeType, filename, uploadOptions } = requestBody

    if (typeof filename !== 'string') {
      this.setStatus(400)
      return {
        error: 'Invalid or missing filename',
      }
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      this.setStatus(400)
      return { error: 'Invalid upload options' }
    }

    try {
      const upload = await UploadsUseCases.createFileUpload(
        user,
        filename,
        mimeType ?? null,
        safeUploadOptions.data,
      )

      this.setStatus(200)
      return upload
    } catch (error) {
      logger.error(error)
      this.setStatus(500)
      return { error: 'Failed to create upload' }
    }
  }

  @SuccessResponse(200, 'Folder upload created')
  @Response<ErrorResponse>(400, 'Bad Request')
  @Post('/folder')
  public async createFolderUpload(
    @Body() requestBody: { fileTree: unknown; uploadOptions?: unknown },
    @Request() request: AuthenticatedRequest,
  ): Promise<ApiResponse<FolderUpload>> {
    const { fileTree, uploadOptions } = requestBody
    const safeFileTree = FolderTreeFolderSchema.safeParse(fileTree)
    if (!safeFileTree.success) {
      this.setStatus(400)
      return { error: 'Invalid file tree' }
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      this.setStatus(400)
      return { error: 'Invalid upload options' }
    }

    try {
      const upload = await UploadsUseCases.createFolderUpload(
        request.user,
        safeFileTree.data.name,
        safeFileTree.data,
        safeUploadOptions.data,
      )

      this.setStatus(200)
      return upload
    } catch (error) {
      logger.error(error)
      this.setStatus(500)
      return { error: 'Failed to create upload' }
    }
  }

  @SuccessResponse(200, 'File in folder upload created')
  @Response<ErrorResponse>(400, 'Bad Request')
  @Response<ErrorResponse>(500, 'Internal Server Error')
  @Post('/folder/{uploadId}/file')
  public async createFileInFolder(
    @Path() uploadId: string,
    @Body()
    requestBody: {
      name: string
      mimeType?: string
      relativeId: string
      uploadOptions?: unknown
    },
    @Request() request: AuthenticatedRequest,
  ): Promise<ApiResponse<FileUpload>> {
    const { name, mimeType, relativeId, uploadOptions } = requestBody

    if (typeof name !== 'string') {
      this.setStatus(400)
      return { error: 'Missing or invalid field: name' }
    }

    if (typeof relativeId !== 'string') {
      this.setStatus(400)
      return { error: 'Missing or invalid field: relativeId' }
    }

    const safeUploadOptions = z
      .union([uploadOptionsSchema, z.null()])
      .safeParse(uploadOptions)
    if (!safeUploadOptions.success) {
      this.setStatus(400)
      return { error: 'Invalid upload options' }
    }

    try {
      const upload = await UploadsUseCases.createFileInFolder(
        request.user,
        uploadId,
        relativeId,
        name,
        mimeType ?? null,
        safeUploadOptions.data,
      )

      this.setStatus(200)
      return upload
    } catch (error) {
      logger.error(error)
      this.setStatus(500)
      return { error: 'Failed to create file in folder' }
    }
  }

  @SuccessResponse(200, 'Chunk uploaded')
  @Post('/file/{uploadId}/chunk')
  public async uploadChunk(
    @Path() uploadId: string,
    @UploadedFile('file') file: Express.Multer.File,
    @FormField() index: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<ApiResponse<{}>> {
    const chunk = file?.buffer
    const parsedIndex = parseInt(index)

    if (!chunk) {
      this.setStatus(400)
      return { error: 'Missing chunk: expected formData entry in field `file`' }
    }

    if (isNaN(parsedIndex)) {
      this.setStatus(400)
      return { error: 'Invalid index' }
    }

    try {
      await UploadsUseCases.uploadChunk(
        request.user,
        uploadId,
        parsedIndex,
        chunk,
      )

      this.setStatus(200)
      return {}
    } catch (error) {
      logger.error(error)
      this.setStatus(500)
      return { error: 'Failed to upload chunk' }
    }
  }

  @SuccessResponse(200, 'Upload completed')
  @Post('/{uploadId}/complete')
  @Response<ErrorResponse>(500, 'Internal Server Error')
  public async completeUpload(
    @Path() uploadId: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<ApiResponse<{ cid: string }>> {
    try {
      const cid = await UploadsUseCases.completeUpload(request.user, uploadId)

      this.setStatus(200)
      return { cid }
    } catch (error) {
      logger.error(error)
      this.setStatus(500)
      return { error: 'Failed to complete upload' }
    }
  }
}
