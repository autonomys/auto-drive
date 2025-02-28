export enum InteractionType {
  Download = 'download',
  Upload = 'upload',
}

export type Interaction = {
  type: InteractionType
  size: number
}
