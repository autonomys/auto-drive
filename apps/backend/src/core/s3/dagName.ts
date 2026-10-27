import { MAX_NAME_SIZE } from '@autonomys/auto-dag-data'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const truncateToBytes = (text: string, maxBytes: number): string => {
  let result = ''
  let size = 0
  for (const { segment } of graphemes.segment(text)) {
    const segmentSize = Buffer.byteLength(segment, 'utf8')
    if (size + segmentSize > maxBytes) break
    result += segment
    size += segmentSize
  }
  return result
}

export const fitDagName = (name: string): string => {
  if (Buffer.byteLength(name, 'utf8') <= MAX_NAME_SIZE) return name

  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  const extensionSize = Buffer.byteLength(extension, 'utf8')
  if (extensionSize === 0 || extensionSize >= MAX_NAME_SIZE) {
    return truncateToBytes(name, MAX_NAME_SIZE)
  }

  return (
    truncateToBytes(name.slice(0, dot), MAX_NAME_SIZE - extensionSize) +
    extension
  )
}
