export enum TouChangeType {
  Material = 'material',
  NonMaterial = 'non-material',
}

export enum TouVersionStatus {
  Draft = 'draft',
  Pending = 'pending',
  Active = 'active',
  Archived = 'archived',
}

export type TouVersion = {
  id: string
  versionLabel: string
  effectiveDate: Date
  contentUrl: string
  changeType: TouChangeType
  status: TouVersionStatus
  adminNotes: string | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type TouAcceptance = {
  id: string
  userId: string
  versionId: string
  ipAddress: string | null
  acceptedAt: Date
}

export type TouVersionWithStats = TouVersion & {
  acceptanceCount: number
}

export type TouStatus = {
  accepted: boolean
  currentVersion: {
    id: string
    versionLabel: string
    contentUrl: string
    changeType: TouChangeType
    effectiveDate: Date
  } | null
  pendingVersion: {
    versionLabel: string
    effectiveDate: Date
    contentUrl: string
    changeType: TouChangeType
  } | null
}
