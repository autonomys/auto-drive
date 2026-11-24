import { Request, Response } from 'express'

// PDF viewers run no document script with the page's origin, and the explorer
// embeds gateway PDFs, so PDFs are served unsandboxed.
const SANDBOX_EXEMPT_CONTENT_TYPES = new Set(['application/pdf'])

// A framed file is shown under the embedding site's address, not ours, so it
// may run scripts; the sandbox still keeps it off our origin.
const FRAME_DESTINATIONS = new Set(['iframe', 'frame', 'embed', 'object'])

// The download headers make HTML loaded in a frame an attachment, which
// browsers download instead of rendering.
const FRAMED_INLINE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
])

export const USER_CONTENT_CSP = 'sandbox'
export const FRAMED_USER_CONTENT_CSP = 'sandbox allow-scripts'

const contentTypeEssence = (value: unknown) =>
  typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''

const isFrameRequest = (req: Request) => {
  const dest = req.headers['sec-fetch-dest']
  return typeof dest === 'string' && FRAME_DESTINATIONS.has(dest.toLowerCase())
}

const isExplicitDownload = (req: Request) =>
  req.query.download === 'true' || req.query.download === ''

const inlineDisposition = (res: Response) => {
  const disposition = res.getHeader('Content-Disposition')
  if (typeof disposition !== 'string') return
  res.setHeader(
    'Content-Disposition',
    disposition.replace(/^attachment\b/, 'inline'),
  )
}

export const applyUserContentHeaders = (req: Request, res: Response) => {
  const essence = contentTypeEssence(res.getHeader('Content-Type'))
  if (SANDBOX_EXEMPT_CONTENT_TYPES.has(essence)) return
  res.vary('Sec-Fetch-Dest')

  if (!isFrameRequest(req)) {
    res.setHeader('Content-Security-Policy', USER_CONTENT_CSP)
    return
  }
  res.setHeader('Content-Security-Policy', FRAMED_USER_CONTENT_CSP)
  if (FRAMED_INLINE_CONTENT_TYPES.has(essence) && !isExplicitDownload(req)) {
    inlineDisposition(res)
  }
}

export const isServiceWorkerScriptRequest = (req: Request) =>
  req.headers['service-worker'] === 'script' ||
  req.headers['sec-fetch-dest'] === 'serviceworker'

// Served in place of any file fetched as a service worker script. Refusing the
// fetch would leave an already installed worker running; replacing it with one
// that unregisters removes it.
export const SERVICE_WORKER_KILL_SWITCH = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(self.registration.unregister()),
)
`

export const sendServiceWorkerKillSwitch = (res: Response) => {
  res.status(200)
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(SERVICE_WORKER_KILL_SWITCH)
}
