import http from 'node:http'
import { LibraryError, MAX_DOCUMENT_BYTES, ThreadLibrary, checkId } from './library.mjs'

export const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function trustedOrigins(port = 5178, configured = '') {
  const origins = new Set([
    `http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`,
    'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173',
  ])
  for (const origin of configured.split(',').map(s => s.trim()).filter(Boolean)) {
    const url = new URL(origin)
    if (!loopbackHosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || origin !== url.origin) {
      throw new Error('LEARNVAS_TRUSTED_ORIGINS must contain exact HTTP(S) loopback origins, without paths')
    }
    origins.add(url.origin)
  }
  return origins
}
export function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}
function deny(message) { throw new LibraryError('untrusted-request', message, 403) }
export function guardRequest(req, origins) {
  const peer = req.socket.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) deny('Bridge accepts loopback connections only')
  const hosts = new Set([...origins].map(o => new URL(o).host))
  if (!hosts.has(req.headers.host)) deny('Untrusted Host header')
  if (req.headers['sec-fetch-site'] === 'cross-site') deny('Cross-site requests are not allowed')
  if (req.headers.origin) {
    if (!origins.has(req.headers.origin)) deny('Untrusted Origin header')
  } else {
    // Same-origin browser GETs often omit Origin; Vite forwards their Referer.
    let origin
    try { origin = new URL(req.headers.referer).origin } catch { deny('A trusted Origin or Referer header is required') }
    if (!origins.has(origin) || new URL(origin).host !== req.headers.host) deny('Untrusted Referer header')
    if (!['GET', 'HEAD'].includes(req.method)) deny('Mutating requests require an explicit trusted Origin header')
  }
}
export async function readJson(req) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new LibraryError('invalid-request', 'Compressed requests are not supported', 415)
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new LibraryError('invalid-request', 'Content-Type must be application/json', 415)
  const length = Number(req.headers['content-length'])
  if (length > MAX_REQUEST_BYTES) { req.resume(); throw new LibraryError('request-too-large', 'Request exceeds the size limit', 413) }
  const chunks = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      // Do not destroy the socket before the HTTP error can be sent.
      req.resume()
      throw new LibraryError('request-too-large', 'Request exceeds the size limit', 413)
    }
    chunks.push(chunk)
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
  catch { throw new LibraryError('invalid-json', 'Request must contain valid UTF-8 JSON', 400) }
}
function payload(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryError('invalid-request', 'Expected a JSON object')
  for (const field of Object.keys(value)) if (![...required, ...optional].includes(field)) throw new LibraryError('invalid-request', `Unknown request field: ${field}`)
  for (const field of required) if (!Object.hasOwn(value, field)) throw new LibraryError('invalid-request', `Missing request field: ${field}`)
  return value
}
async function libraryRoute(req, res, url, library) {
  if (!/^\/api\/(threads|trash)(?:\/|$)/.test(url.pathname)) return false
  if (url.search) throw new LibraryError('invalid-request', 'Library endpoints do not accept query parameters or filesystem paths')
  const parts = url.pathname.split('/').slice(2)
  const [collection, rawId, action] = parts
  if (parts.length > 3 || rawId === '' || action === '') throw new LibraryError('not-found', 'Unknown library endpoint', 404)
  const trash = collection === 'trash'
  if (!rawId) {
    if (req.method === 'GET') json(res, 200, await library.list(trash))
    else if (req.method === 'POST' && !trash) {
      const p = payload(await readJson(req), ['document'], ['confirmFilename'])
      json(res, 201, await library.create(p.document, p.confirmFilename))
    } else throw new LibraryError('method-not-allowed', 'Method not allowed', 405)
    return true
  }
  let id
  try { id = decodeURIComponent(rawId) } catch { throw new LibraryError('invalid-id', 'Invalid ID encoding') }
  checkId(id)
  if (req.method === 'GET' && !action) json(res, 200, await library.read(id, trash))
  else if (req.method === 'PUT' && !trash && !action) {
    const p = payload(await readJson(req), ['document', 'revision'])
    json(res, 200, await library.save(id, p.document, p.revision))
  } else if (req.method === 'POST' && !trash && action === 'rename') {
    const p = payload(await readJson(req), ['title', 'revision'], ['confirmFilename'])
    json(res, 200, await library.rename(id, p.title, p.revision, p.confirmFilename))
  } else if (req.method === 'POST' && !trash && action === 'trash') {
    const p = payload(await readJson(req), ['revision'], ['confirmFilename'])
    json(res, 200, await library.trash(id, p.revision, p.confirmFilename))
  } else if (req.method === 'POST' && trash && action === 'restore') {
    const p = payload(await readJson(req), ['revision'], ['confirmFilename'])
    json(res, 200, await library.restore(id, p.revision, p.confirmFilename))
  } else throw new LibraryError('method-not-allowed', 'Unknown operation or method not allowed', 405)
  return true
}
export function createBridgeServer({ library = new ThreadLibrary(), port = 5178, origins = trustedOrigins(port), fallback } = {}) {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        guardRequest(req, origins)
        // Reject traversal before URL normalization could erase it.
        const rawPath = req.url.split('?')[0]
        let decoded
        try { decoded = decodeURIComponent(rawPath) } catch { throw new LibraryError('invalid-request', 'Invalid URL encoding') }
        if (decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..')) {
          throw new LibraryError('invalid-request', 'Paths and traversal are not allowed')
        }
        const url = new URL(req.url, `http://localhost:${port}`)
        if (await libraryRoute(req, res, url, library)) return
        if (fallback) await fallback(req, res, url)
        else json(res, 404, { error: 'not found', code: 'not-found' })
      } catch (error) {
        if (!res.headersSent) json(res, error instanceof LibraryError ? error.status : 500, {
          error: error instanceof LibraryError ? error.message : 'Bridge request failed',
          code: error instanceof LibraryError ? error.code : 'internal-error',
          ...(error instanceof LibraryError ? error.details : {}),
        })
        else res.end()
        req.resume()
      }
    })()
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.maxHeadersCount = 64
  return server
}
