import { jest } from '@jest/globals'
import express from 'express'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { uploadFile } from '../../utils/uploads.js'
import { AccountsUseCases, ObjectUseCases } from '../../../src/core/index.js'
import { downloadController } from '../../../src/app/controllers/download.js'
import { objectController } from '../../../src/app/controllers/object.js'
import { SERVICE_WORKER_KILL_SWITCH } from '../../../src/shared/utils/userContent.js'
import { config } from '../../../src/config.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'

jest.setTimeout(120_000)

const navigation = {
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
}

describe('user content served from the shared origin', () => {
  const user = createMockUser()
  let server: Server
  let BASE: string
  let htmlCid: string
  let publishedHtmlId: string

  const page = '<!doctype html><script>document.title = "ran"</script>'

  beforeAll(async () => {
    // As on the public gateway, which serves anonymous visitors
    jest.replaceProperty(config.params, 'optionalAuth', true)
    await dbMigration.up()
    mockRabbitPublish()
    await AccountsUseCases.getOrCreateAccount(user)

    const app = express()
    app.use('/downloads', downloadController)
    app.use('/objects', objectController)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    BASE = `http://localhost:${(server.address() as AddressInfo).port}`

    htmlCid = await uploadFile(user, 'index.html', page, 'text/html')
    publishedHtmlId = (await ObjectUseCases.publishObject(user, htmlCid)).id
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await dbMigration.down()
    unmockMethods()
    jest.restoreAllMocks()
  })

  it('sandboxes an HTML page opened from the gateway', async () => {
    const response = await fetch(`${BASE}/downloads/${htmlCid}`, {
      headers: navigation,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
    expect(response.headers.get('vary')).toMatch(/sec-fetch-dest/i)
    expect(await response.text()).toBe(page)
  })

  it.each([
    ['iframe', 'navigate'],
    ['frame', 'navigate'],
    ['embed', 'no-cors'],
    ['object', 'no-cors'],
  ])(
    'renders HTML loaded by <%s> with scripts, still sandboxed',
    async (dest, mode) => {
      const response = await fetch(`${BASE}/downloads/${htmlCid}`, {
        headers: { 'sec-fetch-dest': dest, 'sec-fetch-mode': mode },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toBe(
        'sandbox allow-scripts',
      )
      expect(response.headers.get('content-disposition')).toBe(
        'inline; filename="index.html"; filename*=UTF-8\'\'index.html',
      )
      expect(response.headers.get('vary')).toMatch(/sec-fetch-dest/i)
    },
  )

  it('renders a public share link loaded in a frame with scripts, still sandboxed', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)

    const response = await fetch(
      `${BASE}/objects/${publishedHtmlId}/public`,
      { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts',
    )
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/)
  })

  it('still downloads framed HTML when ?download is asked for', async () => {
    const response = await fetch(`${BASE}/downloads/${htmlCid}?download`, {
      headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('leaves the disposition of framed non-HTML files alone', async () => {
    const cid = await uploadFile(user, 'notes.json', '{}', 'application/json')

    const response = await fetch(`${BASE}/downloads/${cid}`, {
      headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts',
    )
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('keeps the strict sandbox when the request does not say where it is loaded', async () => {
    const response = await fetch(`${BASE}/downloads/${htmlCid}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })

  it('sandboxes an HTML page opened from a public share link', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)

    const response = await fetch(
      `${BASE}/objects/${publishedHtmlId}/public`,
      { headers: navigation },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/html/)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })

  it.each([
    ['an SVG', 'drawing.svg', 'image/svg+xml'],
    ['an HTML page stored as octet-stream', 'page.html', 'application/octet-stream'],
    ['an XHTML page', 'page.xhtml', 'application/xhtml+xml'],
    ['an image', 'photo.png', 'image/png'],
    ['a JSON file', 'data.json', 'application/json'],
  ])('sandboxes %s', async (_, name, mimeType) => {
    const cid = await uploadFile(user, name, '<svg/>', mimeType)

    const response = await fetch(`${BASE}/downloads/${cid}`, {
      headers: navigation,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })

  it('leaves PDFs unsandboxed so browser PDF viewers still render them', async () => {
    const cid = await uploadFile(user, 'doc.pdf', '%PDF-1.4', 'application/pdf')

    const response = await fetch(`${BASE}/downloads/${cid}`, {
      headers: navigation,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-security-policy')).toBeNull()
  })

  it('sandboxes a type that only starts like a PDF', async () => {
    const cid = await uploadFile(
      user,
      'doc.html',
      page,
      'application/pdf,text/html',
    )

    const response = await fetch(`${BASE}/downloads/${cid}`, {
      headers: navigation,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toBe('sandbox')
  })

  it.each([
    ['Service-Worker', { 'service-worker': 'script' }],
    ['Sec-Fetch-Dest', { 'sec-fetch-dest': 'serviceworker' }],
  ])(
    'answers a service worker script fetch (%s) with the kill switch, not the file',
    async (_, headers) => {
      for (const path of [
        `/downloads/${htmlCid}`,
        `/objects/${publishedHtmlId}/public`,
        '/downloads/bafkr6iunknowncid',
      ]) {
        const response = await fetch(`${BASE}${path}`, { headers })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toMatch(
          /^text\/javascript/,
        )
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.text()).toBe(SERVICE_WORKER_KILL_SWITCH)
      }
    },
  )
})
