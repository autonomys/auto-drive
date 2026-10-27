import { fitDagName } from '../../../src/core/s3/dagName.js'

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

describe('fitDagName', () => {
  it.each([
    ['255 ASCII bytes', 'a'.repeat(255)],
    ['85 three-byte characters', '€'.repeat(85)],
  ])('keeps a name of %s unchanged', (_, name) => {
    expect(fitDagName(name)).toBe(name)
  })

  it('cuts an ASCII name to 255 bytes', () => {
    expect(fitDagName('a'.repeat(256))).toBe('a'.repeat(255))
  })

  it('stops before a character that does not fit, rather than splitting it', () => {
    const name = 'a' + '€'.repeat(85)
    expect(bytes(name)).toBe(256)

    expect(fitDagName(name)).toBe('a' + '€'.repeat(84))
  })

  it('keeps the extension and shortens the rest', () => {
    expect(fitDagName(`${'€'.repeat(86)}.txt`)).toBe(`${'€'.repeat(83)}.txt`)
  })

  it('does not split a character made of several code points', () => {
    const family = '👨‍👩‍👧'
    const name = 'a'.repeat(240) + family
    expect(bytes(family)).toBe(18)

    expect(fitDagName(name)).toBe('a'.repeat(240))
  })

  it('cuts the whole name when a leading dot is not an extension', () => {
    expect(fitDagName('.' + 'a'.repeat(300))).toBe('.' + 'a'.repeat(254))
  })

  it('cuts the whole name when the extension alone is too long', () => {
    const name = 'x.' + 'a'.repeat(300)

    expect(fitDagName(name)).toBe(name.slice(0, 255))
  })
})
