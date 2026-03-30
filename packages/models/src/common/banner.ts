export enum BannerCriticality {
  Info = 'info',
  Warning = 'warning',
  Critical = 'critical',
}

export enum BannerInteractionType {
  Acknowledged = 'acknowledged',
  Dismissed = 'dismissed',
}

export type Banner = {
  id: string
  title: string
  body: string
  criticality: BannerCriticality
  dismissable: boolean
  requiresAcknowledgement: boolean
  displayStart: Date
  displayEnd: Date | null
  active: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type BannerInteraction = {
  id: string
  userId: string
  bannerId: string
  interactionType: BannerInteractionType
  createdAt: Date
}

export type BannerWithStats = Banner & {
  acknowledgementCount: number
  dismissalCount: number
}
