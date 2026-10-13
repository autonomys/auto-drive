import { describe, it, expect } from '@jest/globals'
import { once } from 'events'
import { Readable } from 'stream'
import { sliceReadable } from '../../../src/shared/utils/readable.js'

const countingSource = (chunkCount: number, chunkSize: number) => {
  let produced = 0
  const source = new Readable({
    read() {
      if (produced === chunkCount) {
        this.push(null)
        return
      }
      produced++
      const chunk = Buffer.alloc(chunkSize, produced)
      setImmediate(() => this.push(chunk))
    },
  })
  return { source, produced: () => produced }
}

describe('sliceReadable', () => {
  it('stops reading the source once the slice is complete', async () => {
    const chunkCount = 250
    const { source, produced } = countingSource(chunkCount, 1000)
    const errors: Error[] = []
    source.on('error', (error) => errors.push(error))

    const slice = await sliceReadable(source, 0, 1)
    const received: Buffer[] = []
    for await (const data of slice) received.push(data)
    if (!source.closed) await once(source, 'close')

    expect(Buffer.concat(received)).toEqual(Buffer.from([1]))
    expect(source.readableEnded).toBe(false)
    expect(produced()).toBeLessThan(chunkCount)
    expect(errors).toEqual([])
  })

  it('returns a slice that spans several source chunks', async () => {
    const { source } = countingSource(5, 4)

    const slice = await sliceReadable(source, 3, 6)
    const received: Buffer[] = []
    for await (const data of slice) received.push(data)

    expect(Buffer.concat(received)).toEqual(Buffer.from([1, 2, 2, 2, 2, 3]))
  })
})
