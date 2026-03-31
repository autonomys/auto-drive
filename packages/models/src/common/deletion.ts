export enum DeletionRequestStatus {
  Pending = 'pending',
  Cancelled = 'cancelled',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

export type DeletionRequest = {
  id: string
  userPublicId: string
  oauthProvider: string
  oauthUserId: string
  status: DeletionRequestStatus
  requestedAt: Date
  scheduledAnonymisationAt: Date
  completedAt: Date | null
  cancelledAt: Date | null
  reason: string | null
  adminNotes: string | null
  createdAt: Date
  updatedAt: Date
}

export type DeletionRequestWithUser = DeletionRequest & {
  oauthUsername: string | null
}

export type DeletionAuditEntry = {
  id: string
  userPublicId: string
  action: string
  details: Record<string, unknown> | null
  performedAt: Date
}
