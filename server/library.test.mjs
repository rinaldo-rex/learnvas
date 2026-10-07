import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ThreadLibrary, MAX_DOCUMENT_BYTES, filenameForTitle } from './library.mjs'
import { TutorNotesStore } from './tutorNotes.mjs'
import { createBridgeServer, trustedOrigins, guardRequest, MAX_REQUEST_BYTES } from './http.mjs'

const fixture = JSON.parse(await fs.readFile(new URL('../src/lib/fixtures/branched.learn', import.meta.url), 'utf8'))
const document = (title = 'Physics', overrides = {}) => ({ ...structuredClone(fixture), threadId: randomUUID(), title, ...overrides })
const code = expected => error => { assert.equal(error.code, expected); return true }
const injected = name => Object.assign(new Error(name), { code: name })

test('tutor-notes endpoint validates, persists, and answers reads from the store', async t => {
  const context = await setup(t)
  const { request } = await api(t, {
    tutorNotes: new TutorNotesStore({ directory: context.directory }),
  })
  const empty = await request('/api/tutor-notes')
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.body, { global: '', updatedAt: null })
  const saved = await request('/api/tutor-notes', 'PUT', { global: 'Keep answers focused.' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.global, 'Keep answers focused.')
  assert.match(saved.body.updatedAt, /^\d{4}-/)
  const bad = [
    [{ }, 400, 'invalid-request'], [{ global: {} }, 400, 'invalid-request'],
    [{ global: 1 }, 400, 'invalid-request'],
    [{ global: 'x', extra: 1 }, 400, 'invalid-request'],
    [{ global: 'x'.repeat(4001) }, 413, 'notes-too-large'],
    ['{', 400, 'invalid-json'],
  ]
  for (const [body, status, codeExpected] of bad) {
    const response = await request('/api/tutor-notes', 'PUT', body)
    assert.equal(response.status, status, JSON.stringify(body))
    assert.equal(response.body.code, codeExpected, JSON.stringify(body))
  }
  const wrongMethod = await request('/api/tutor-notes', 'POST', { global: 'x' })
  assert.equal(wrongMethod.status, 405)
  const reloaded = await request('/api/tutor-notes')
  assert.equal(reloaded.body.global, 'Keep answers focused.')
  assert.equal(reloaded.body.updatedAt, saved.body.updatedAt)
})
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'learnvas-library-test-'))
  const directory = path.join(root, 'library')
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, directory, library: new ThreadLibrary({ directory, ...options }) }
}
async function api(t, options = {}) {
  const context = await setup(t, options)
  const origins = trustedOrigins()
  const server = createBridgeServer({ library: context.library, tutorNotes: options.tutorNotes ?? null, origins, fallback: (_req, res) => { res.writeHead(200); res.end('{}') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  origins.add(origin)
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  // http.request lets security tests actually send an arbitrary Host header;
  // Node's fetch may replace that header with the URL's host.
  const request = (endpoint, method = 'GET', body, headers = {}) => new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = http.request(`${origin}${endpoint}`, {
      method, headers: { origin: 'http://localhost:5173', ...(bytes === undefined ? {} : {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes),
      }), ...headers },
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }) } catch (error) { reject(error) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(bytes)
  })
  return { ...context, request, origin }
}

test('library APIs initialize isolated directories, CRUD a full document, and reopen after restart', async t => {
  const { request, directory } = await api(t)
  assert.equal((await request('/api/threads')).status, 200)
  assert.deepEqual((await request('/api/trash')).body.threads, [])
  const original = document('Quantum physics')
  const created = await request('/api/threads', 'POST', { document: original })
  assert.equal(created.status, 201)
  assert.equal(created.body.filename, 'Quantum physics.learn')
  assert.deepEqual(created.body.document, original)
  assert.match(created.body.revision, /^[a-f0-9]{64}$/)
  const id = original.threadId
  assert.deepEqual((await request(`/api/threads/${id}`)).body, created.body)
  const edited = { ...original, updatedAt: new Date().toISOString() }
  edited.cards[0].text = 'new draft 🌱'
  edited.viewport = { x: -271, y: 83, zoom: 0.7 }
  const saved = await request(`/api/threads/${id}`, 'PUT', { document: edited, revision: created.body.revision })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.document, edited)
  assert.notEqual(saved.body.revision, created.body.revision)
  assert.deepEqual((await new ThreadLibrary({ directory }).read(id)).document, edited)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, saved.body.filename), 'utf8')), edited)
  assert.equal((await request('/api/threads')).body.threads.length, 1)
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700)
  assert.equal((await fs.stat(path.join(directory, saved.body.filename))).mode & 0o777, 0o600)
})

test('create and rename collisions require exact numbered-name confirmation, without silent writes', async t => {
  const { request, directory } = await api(t)
  const a = document('Physics')
  const b = document('Physics')
  const first = (await request('/api/threads', 'POST', { document: a })).body
  const warning = await request('/api/threads', 'POST', { document: b })
  assert.equal(warning.status, 409)
  assert.equal(warning.body.code, 'filename-conflict')
  assert.equal(warning.body.proposedFilename, 'Physics (2).learn')
  assert.equal(warning.body.confirmationRequired, true)
  assert.equal((await request('/api/threads')).body.threads.length, 1)
  const confirmed = await request('/api/threads', 'POST', { document: b, confirmFilename: warning.body.proposedFilename })
  assert.equal(confirmed.status, 201)
  assert.equal(confirmed.body.filename, 'Physics (2).learn')
  const third = (await request('/api/threads', 'POST', { document: document('Chemistry') })).body
  const renameWarning = await request(`/api/threads/${third.document.threadId}/rename`, 'POST', { title: 'Physics', revision: third.revision })
  assert.equal(renameWarning.body.proposedFilename, 'Physics (3).learn')
  assert.equal((await request(`/api/threads/${third.document.threadId}`)).body.document.title, 'Chemistry')
  const renamed = await request(`/api/threads/${third.document.threadId}/rename`, 'POST', {
    title: 'Physics', revision: third.revision, confirmFilename: 'Physics (3).learn',
  })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.document.threadId, third.document.threadId)
  assert.equal(renamed.body.document.createdAt, third.document.createdAt)
  assert.deepEqual(renamed.body.document.cards, third.document.cards)
  await assert.rejects(fs.stat(path.join(directory, 'Chemistry.learn')), { code: 'ENOENT' })
  assert.deepEqual((await request(`/api/threads/${a.threadId}`)).body.document, first.document)
})

test('collision confirmations cannot select arbitrary paths or stale proposals', async t => {
  const { library } = await setup(t)
  await library.create(document())
  await assert.rejects(library.create(document(), '../escape.learn'), code('invalid-filename'))
  await library.create(document(), 'Physics (2).learn')
  await assert.rejects(library.create(document(), 'Physics (2).learn'), error => {
    assert.equal(error.details.proposedFilename, 'Physics (3).learn'); return true
  })
  await assert.rejects(library.create(document('Unoccupied'), 'Chosen.learn'), code('filename-conflict'))
})

test('case-insensitive, Unicode and sanitized filename collisions preserve every existing entry', async t => {
  const { directory, library } = await setup(t)
  const names = ['../a/b\\c', 'CON', '???', 'x'.repeat(200), '文'.repeat(180)]
  for (const name of names) {
    const filename = filenameForTitle(name)
    assert.equal(path.basename(filename), filename)
    assert.ok(Buffer.byteLength(filename) < 220)
    assert.ok(!filename.startsWith('.'))
    await library.create(document(name))
  }
  await library.create(document('Physics'))
  await assert.rejects(library.create(document('physics')), error => {
    assert.equal(error.details.proposedFilename, 'physics (2).learn'); return true
  })
  await fs.writeFile(path.join(directory, 'Reserved.learn'), 'broken')
  await assert.rejects(library.create(document('Reserved')), code('filename-conflict'))
  assert.equal(await fs.readFile(path.join(directory, 'Reserved.learn'), 'utf8'), 'broken')
})

test('revision CAS rejects two-tab saves, missing revisions, stale rename and externally replaced identical files', async t => {
  const { request, directory } = await api(t)
  const d = document()
  const created = (await request('/api/threads', 'POST', { document: d })).body
  const id = d.threadId
  const missing = await request(`/api/threads/${id}`, 'PUT', { document: d, revision: '' })
  assert.equal(missing.status, 428)
  const both = await Promise.all([
    request(`/api/threads/${id}`, 'PUT', { document: d, revision: created.revision }),
    request(`/api/threads/${id}`, 'PUT', { document: d, revision: created.revision }),
  ])
  assert.deepEqual(both.map(x => x.status).sort(), [200, 409])
  assert.equal((await request(`/api/threads/${id}/rename`, 'POST', { title: 'New', revision: created.revision })).status, 409)
  const current = (await request(`/api/threads/${id}`)).body
  const file = path.join(directory, current.filename)
  const bytes = await fs.readFile(file)
  const replacement = path.join(directory, 'replacement')
  await fs.writeFile(replacement, bytes)
  await fs.rename(replacement, file)
  const stale = await request(`/api/threads/${id}`, 'PUT', { document: d, revision: current.revision })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.code, 'revision-conflict')
  assert.deepEqual(await fs.readFile(file), bytes)
})

test('save preserves immutable metadata; same-filename rename updates title atomically', async t => {
  const { library } = await setup(t)
  const r = await library.create(document('A/B'))
  for (const patch of [{ threadId: 'different' }, { title: 'different' }, { createdAt: '2025-01-01T00:00:00.000Z' }]) {
    await assert.rejects(library.save(r.document.threadId, { ...r.document, ...patch }, r.revision), code('immutable-metadata'))
  }
  const renamed = await library.rename(r.document.threadId, 'A\\B', r.revision)
  assert.equal(renamed.filename, r.filename)
  assert.equal(renamed.document.title, 'A\\B')
  assert.notEqual(renamed.revision, r.revision)
})

test('malformed, future-version, oversized, duplicate-ID and non-document files cannot break valid listing', async t => {
  const { library, directory } = await setup(t)
  const good = await library.create(document('Good'))
  const files = {
    'Broken.learn': '{bad',
    'Future.learn': JSON.stringify(document('Future', { version: 99 })),
    'Retired.learn': JSON.stringify(document('Retired', { version: 1 })),
    'Unknown.learn': JSON.stringify(document('Unknown', { extra: true })),
    'Empty.learn': '',
  }
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(directory, name), bytes)
  await fs.writeFile(path.join(directory, 'Huge.learn'), Buffer.alloc(MAX_DOCUMENT_BYTES + 1))
  await fs.writeFile(path.join(directory, 'ignore.txt'), 'ignored')
  await fs.mkdir(path.join(directory, 'Directory.learn'))
  let listing = await library.list()
  assert.equal(listing.threads.length, 1)
  assert.equal(listing.warnings.length, 7)
  assert.ok(listing.warnings.some(w => w.code === 'unsupported-version'))
  assert.ok(listing.warnings.some(w => w.code === 'document-too-large'))
  for (const [name, bytes] of Object.entries(files)) assert.equal(await fs.readFile(path.join(directory, name), 'utf8'), bytes)
  await fs.copyFile(path.join(directory, good.filename), path.join(directory, 'Duplicate.learn'))
  listing = await library.list()
  assert.equal(listing.threads.length, 0)
  assert.equal(listing.warnings.filter(w => w.code === 'id-conflict').length, 2)
  await assert.rejects(library.read(good.document.threadId), code('id-conflict'))
  await assert.rejects(library.create(good.document), code('id-conflict'))
})

test('API validates envelopes/documents, size bounds, UTF-8, traversal, and unknown operations', async t => {
  const { request } = await api(t)
  const cases = [
    ['/api/threads', 'POST', '{', 400, 'invalid-json'],
    ['/api/threads', 'POST', [], 400, 'invalid-request'],
    ['/api/threads', 'POST', {}, 400, 'invalid-request'],
    ['/api/threads', 'POST', { document: document(), path: '/tmp/escape.learn' }, 400, 'invalid-request'],
    ['/api/threads', 'POST', { document: document('Bad', { version: 3 }) }, 422, 'unsupported-version'],
    ['/api/threads', 'POST', { document: document('Bad', { version: 1 }) }, 422, 'unsupported-version'],
    ['/api/threads', 'POST', { document: document('Bad', { extra: 1 }) }, 422, 'invalid-document'],
    ['/api/threads', 'POST', { document: document('', {}) }, 422, 'invalid-document'],
    ['/api/threads', 'POST', { document: document('Bad', { threadId: '../escape' }) }, 400, 'invalid-id'],
    ['/api/threads', 'POST', { document: document('Too long ' + 'x'.repeat(200)) }, 400, 'invalid-title'],
    ['/api/threads', 'POST', ' '.repeat(MAX_REQUEST_BYTES + 1), 413, 'request-too-large'],
    ['/api/threads?path=/tmp', 'GET', undefined, 400, 'invalid-request'],
    ['/api/threads/%2Ftmp%2Ffile', 'GET', undefined, 400, 'invalid-id'],
    ['/api/threads/%5Cescape', 'GET', undefined, 400, 'invalid-request'],
    ['/api/threads/%00escape', 'GET', undefined, 400, 'invalid-request'],
    ['/api/threads/%zz', 'GET', undefined, 400, 'invalid-request'],
    ['/api/threads/no-such-id', 'GET', undefined, 404, 'not-found'],
    ['/api/threads/id/purge', 'POST', {}, 405, 'method-not-allowed'],
  ]
  for (const [endpoint, method, body, status, expected] of cases) {
    const result = await request(endpoint, method, body)
    assert.equal(result.status, status, `${endpoint} ${JSON.stringify(body)?.slice(0, 50)}`)
    assert.equal(result.body.code, expected)
  }
  const oversizeDocument = document('Large')
  oversizeDocument.cards[0].text = 'x'.repeat(MAX_DOCUMENT_BYTES)
  const oversized = await request('/api/threads', 'POST', { document: oversizeDocument })
  assert.equal(oversized.body.code, 'document-too-large')
  assert.equal((await request('/api/threads', 'POST', '{}', { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await request('/api/threads', 'POST', '{}', { 'content-encoding': 'gzip' })).status, 415)
})

test('trusted origins and Host checks protect all endpoints, including read-only ones and fallback APIs', async t => {
  const { request, origin } = await api(t)
  for (const endpoint of ['/api/threads', '/api/trash', '/api/models', '/api/extensions', '/api/chat']) {
    assert.equal((await request(endpoint, 'GET', undefined, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await request(endpoint, 'GET', undefined, { host: 'evil.example' })).status, 403)
    assert.equal((await request(endpoint, 'GET', undefined, { origin: 'null' })).status, 403)
    assert.equal((await request(endpoint, 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403)
  }
  const get = await fetch(`${origin}/api/threads`, { headers: { referer: `${origin}/canvas` } })
  assert.equal(get.status, 200)
  assert.equal(get.headers.get('access-control-allow-origin'), null)
  assert.equal(get.headers.get('cache-control'), 'no-store')
  assert.equal((await fetch(`${origin}/api/threads`)).status, 403)
  const noOriginPost = await fetch(`${origin}/api/threads`, {
    method: 'POST', headers: { referer: `${origin}/`, 'content-type': 'application/json' }, body: JSON.stringify({ document: document() }),
  })
  assert.equal(noOriginPost.status, 403)
  const options = await request('/api/threads', 'OPTIONS', undefined, { origin: 'https://evil.example' })
  assert.equal(options.status, 403)
  assert.throws(() => trustedOrigins(5178, 'http://evil.example:5173'))
  assert.throws(() => trustedOrigins(5178, 'http://localhost:5173/path'))
  assert.ok(trustedOrigins(5178, 'http://localhost:6000').has('http://localhost:6000'))
  assert.throws(() => guardRequest({ socket: { remoteAddress: '192.168.1.1' }, headers: {} }, trustedOrigins()), code('untrusted-request'))
})

test('trash and restore retain identity/content, require revisions, and never erase or overwrite', async t => {
  const { request, directory } = await api(t)
  const original = document()
  const created = (await request('/api/threads', 'POST', { document: original })).body
  const endpoint = `/api/threads/${original.threadId}/trash`
  assert.equal((await request(endpoint, 'POST', { revision: '0'.repeat(64) })).status, 409)
  const trashed = await request(endpoint, 'POST', { revision: created.revision })
  assert.equal(trashed.status, 200)
  assert.deepEqual(trashed.body.document, original)
  assert.equal((await request('/api/threads')).body.threads.length, 0)
  assert.equal((await request('/api/trash')).body.threads.length, 1)
  assert.deepEqual((await request(`/api/trash/${original.threadId}`)).body.document, original)
  const trashBytes = await fs.readFile(path.join(directory, '.trash', trashed.body.filename))
  const other = (await request('/api/threads', 'POST', { document: document() })).body
  const restoreEndpoint = `/api/trash/${original.threadId}/restore`
  const warning = await request(restoreEndpoint, 'POST', { revision: trashed.body.revision })
  assert.equal(warning.status, 409)
  assert.equal(warning.body.proposedFilename, 'Physics (2).learn')
  assert.deepEqual(await fs.readFile(path.join(directory, '.trash', trashed.body.filename)), trashBytes)
  const restored = await request(restoreEndpoint, 'POST', { revision: trashed.body.revision, confirmFilename: warning.body.proposedFilename })
  assert.equal(restored.status, 200)
  assert.deepEqual(restored.body.document, original)
  assert.equal((await request('/api/trash')).body.threads.length, 0)
  assert.equal((await request('/api/threads')).body.threads.length, 2)
  assert.deepEqual((await request(`/api/threads/${other.document.threadId}`)).body.document, other.document)
})

test('trash ID/filename collisions and restore ID conflicts leave all copies intact', async t => {
  const { library, directory } = await setup(t)
  const a = await library.create(document())
  const trash = await library.trash(a.document.threadId, a.revision)
  await assert.rejects(library.create(a.document), code('id-conflict'))
  const b = await library.create(document())
  await assert.rejects(library.trash(b.document.threadId, b.revision), error => {
    assert.equal(error.details.proposedFilename, 'Physics (2).learn'); return true
  })
  await library.trash(b.document.threadId, b.revision, 'Physics (2).learn')
  await fs.writeFile(path.join(directory, 'External.learn'), JSON.stringify(a.document))
  await assert.rejects(library.restore(a.document.threadId, trash.revision), code('id-conflict'))
  assert.equal((await library.list(true)).threads.length, 2)
  assert.equal((await library.list()).threads.length, 1)
})

test('symlink ancestors, library/trash directories, document links and hardlinks cannot escape', async t => {
  const { root, library, directory } = await setup(t)
  const outside = path.join(root, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(root, 'linked'))
  const escape = new ThreadLibrary({ directory: path.join(root, 'linked', 'child') })
  await assert.rejects(escape.list(), code('unsafe-path'))
  assert.deepEqual(await fs.readdir(outside), [])
  const target = path.join(outside, 'valuable.learn')
  const secret = JSON.stringify(document('Private'))
  await fs.writeFile(target, secret)
  await library.list()
  await fs.symlink(target, path.join(directory, 'Private.learn'))
  await fs.link(target, path.join(directory, 'Hard.learn'))
  const listing = await library.list()
  assert.equal(listing.threads.length, 0)
  assert.equal(listing.warnings.length, 2)
  assert.ok(listing.warnings.every(w => w.code === 'unsafe-path'))
  await assert.rejects(library.create(document('Private')), code('filename-conflict'))
  await library.create(document('Private'), 'Private (2).learn')
  assert.equal(await fs.readFile(target, 'utf8'), secret)
  await fs.rm(path.join(directory, '.trash'), { recursive: true })
  await fs.symlink(outside, path.join(directory, '.trash'))
  await assert.rejects(library.list(), code('unsafe-path'))
  assert.deepEqual(await fs.readdir(outside), ['valuable.learn'])
})

test('invalid document and staged write/sync/rename failures leave the old file byte-for-byte intact', async t => {
  const { directory, library } = await setup(t)
  const original = await library.create(document())
  const oldBytes = await fs.readFile(path.join(directory, original.filename))
  await assert.rejects(library.save(original.document.threadId, { ...original.document, unknown: 1 }, original.revision), code('invalid-document'))
  for (const failure of ['write', 'sync', 'rename']) {
    const io = {
      ...fs,
      rename: async (...args) => { if (failure === 'rename') throw injected('EIO'); return fs.rename(...args) },
      open: async (file, flags, mode) => {
        const h = await fs.open(file, flags, mode)
        if (!path.basename(String(file)).startsWith('.pending-')) return h
        return new Proxy(h, { get(target, key) {
          if ((failure === 'write' && key === 'writeFile') || (failure === 'sync' && key === 'sync')) return async () => { throw injected('ENOSPC') }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        } })
      },
    }
    const failing = new ThreadLibrary({ directory, io })
    await assert.rejects(failing.save(original.document.threadId, original.document, original.revision), code('io-error'))
    assert.deepEqual(await fs.readFile(path.join(directory, original.filename)), oldBytes)
    assert.ok(!(await fs.readdir(directory)).some(f => f.startsWith('.pending-')))
  }
})

test('an external change during staging is detected again before atomic replacement', async t => {
  const { directory, library } = await setup(t)
  const r = await library.create(document())
  const external = { ...r.document, title: 'Externally edited' }
  let changed = false
  const io = { ...fs, open: async (file, flags, mode) => {
    const h = await fs.open(file, flags, mode)
    if (!changed && path.basename(String(file)).startsWith('.pending-')) {
      changed = true
      await fs.writeFile(path.join(directory, r.filename), JSON.stringify(external))
    }
    return h
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).save(r.document.threadId, r.document, r.revision), code('revision-conflict'))
  assert.deepEqual((await library.read(r.document.threadId)).document, external)
})

test('publish races do not overwrite a raced-in filename', async t => {
  const { directory, library } = await setup(t)
  await library.list()
  const io = { ...fs, link: async (from, to) => {
    if (String(to).endsWith('Physics.learn')) await fs.writeFile(to, 'external file')
    return fs.link(from, to)
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).create(document()), code('filename-conflict'))
  assert.equal(await fs.readFile(path.join(directory, 'Physics.learn'), 'utf8'), 'external file')
})

test('permission errors are clear and never report success', async t => {
  const { directory } = await setup(t)
  const io = { ...fs, mkdir: async () => { throw injected('EACCES') } }
  await assert.rejects(new ThreadLibrary({ directory, io }).create(document()), error => {
    assert.equal(error.code, 'permission-denied'); assert.equal(error.status, 403); return true
  })
})

test('directory fsync failure after save returns an error, not a false durable-success response', async t => {
  const { directory, library } = await setup(t)
  const r = await library.create(document())
  const io = { ...fs, open: async (file, flags, mode) => {
    const h = await fs.open(file, flags, mode)
    if (!(flags & constants.O_DIRECTORY)) return h
    return new Proxy(h, { get(target, key) {
      if (key === 'sync') return async () => { throw injected('EIO') }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).save(r.document.threadId, r.document, r.revision), code('io-error'))
  assert.deepEqual((await library.read(r.document.threadId)).document, r.document)
})

test('interrupted rename/trash/restore recovers from a journal after restart without data loss', async t => {
  const { library, directory } = await setup(t)
  let r = await library.create(document())
  for (const operation of ['rename', 'trash', 'restore']) {
    let failed = false
    const io = { ...fs, unlink: async file => {
      const source = operation === 'restore' ? path.join(directory, '.trash', r.filename) : path.join(directory, r.filename)
      if (!failed && file === source) { failed = true; throw injected('EIO') }
      return fs.unlink(file)
    } }
    const failing = new ThreadLibrary({ directory, io })
    if (operation === 'rename') await assert.rejects(failing.rename(r.document.threadId, 'Renamed', r.revision), code('io-error'))
    if (operation === 'trash') await assert.rejects(failing.trash(r.document.threadId, r.revision), code('io-error'))
    if (operation === 'restore') await assert.rejects(failing.restore(r.document.threadId, r.revision), code('io-error'))
    assert.ok(failed)
    await fs.stat(path.join(directory, '.transaction.json'))
    const restarted = new ThreadLibrary({ directory })
    r = await restarted.read(r.document.threadId, operation === 'trash')
    assert.deepEqual(r.document.cards, fixture.cards)
    assert.equal(r.document.title, 'Renamed')
    await assert.rejects(fs.stat(path.join(directory, '.transaction.json')), { code: 'ENOENT' })
    assert.equal((await restarted.list()).threads.length, operation === 'trash' ? 0 : 1)
    assert.equal((await restarted.list(true)).threads.length, operation === 'trash' ? 1 : 0)
  }
})

test('recovery preserves externally changed copies and rejects tampered path journals', async t => {
  const { directory, library } = await setup(t)
  const r = await library.create(document())
  const io = { ...fs, unlink: async file => {
    if (file === path.join(directory, r.filename)) throw injected('EIO')
    return fs.unlink(file)
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).trash(r.document.threadId, r.revision), code('io-error'))
  const altered = { ...r.document, title: 'External change' }
  await fs.writeFile(path.join(directory, r.filename), JSON.stringify(altered))
  await assert.rejects(library.list(), code('recovery-conflict'))
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, r.filename), 'utf8')), altered)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, '.trash', r.filename), 'utf8')), r.document)
  const journalFile = path.join(directory, '.transaction.json')
  const journal = JSON.parse(await fs.readFile(journalFile, 'utf8'))
  journal.destination.filename = '../outside.learn'
  await fs.writeFile(journalFile, JSON.stringify(journal))
  await assert.rejects(library.list(), code('invalid-filename'))
})

test('chunked requests, invalid UTF-8 and raw traversal are rejected at the HTTP boundary', async t => {
  const { origin } = await api(t)
  const raw = (pathname, chunks) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: new URL(origin).port, path: pathname, method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }) } catch (error) { reject(error) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
  const oversized = await raw('/api/threads', [Buffer.alloc(MAX_REQUEST_BYTES + 1, 32)])
  assert.equal(oversized.status, 413)
  assert.equal(oversized.body.code, 'request-too-large')
  const invalidUtf8 = await raw('/api/threads', [Buffer.from([0xff])])
  assert.equal(invalidUtf8.status, 400)
  assert.equal(invalidUtf8.body.code, 'invalid-json')
  for (const pathname of ['/api/threads/../trash', '/api/threads/%2e%2e/trash', '/api/threads/%2E/trash']) {
    assert.equal((await raw(pathname, ['{}'])).status, 400)
  }
})

test('a failed move publish preserves the source and cancels an uncommitted filename race', async t => {
  const { directory, library } = await setup(t)
  const r = await library.create(document())
  let raced = false
  const io = { ...fs, link: async (from, to) => {
    if (!raced && String(to).endsWith('Renamed.learn')) {
      raced = true
      await fs.writeFile(to, 'a raced-in external file')
    }
    return fs.link(from, to)
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).rename(r.document.threadId, 'Renamed', r.revision), code('filename-conflict'))
  assert.deepEqual((await library.read(r.document.threadId)).document, r.document)
  assert.equal(await fs.readFile(path.join(directory, 'Renamed.learn'), 'utf8'), 'a raced-in external file')
  await assert.rejects(fs.stat(path.join(directory, '.transaction.json')), { code: 'ENOENT' })
})

test('destination directory sync failure retains the original until restart recovery', async t => {
  const { directory, library } = await setup(t)
  const r = await library.create(document())
  const io = { ...fs, open: async (file, flags, mode) => {
    const h = await fs.open(file, flags, mode)
    if (!(flags & constants.O_DIRECTORY) || file !== path.join(directory, '.trash')) return h
    return new Proxy(h, { get(target, key) {
      if (key === 'sync') return async () => { throw injected('EIO') }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }
  await assert.rejects(new ThreadLibrary({ directory, io }).trash(r.document.threadId, r.revision), code('io-error'))
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, r.filename), 'utf8')), r.document)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, '.trash', r.filename), 'utf8')), r.document)
  const restarted = new ThreadLibrary({ directory })
  assert.deepEqual((await restarted.read(r.document.threadId, true)).document, r.document)
  assert.equal((await restarted.list()).threads.length, 0)
})

test('staged-but-unpublished moves and the link/unlink crash window recover idempotently', async t => {
  const { directory, library } = await setup(t)
  let r = await library.create(document())
  for (const phase of ['publish', 'staging-unlink', 'source-directory-sync', 'journal-unlink']) {
    let triggered = false
    const target = `Recovered ${phase}.learn`
    let sourceRemoved = false
    const io = {
      ...fs,
      link: async (from, to) => {
        if (phase === 'publish' && !triggered && to === path.join(directory, target)) { triggered = true; throw injected('EIO') }
        return fs.link(from, to)
      },
      unlink: async file => {
        if (phase === 'staging-unlink' && !triggered && path.basename(file).startsWith('.pending-') &&
            (await fs.readdir(directory)).includes(target)) { triggered = true; throw injected('EIO') }
        if (phase === 'journal-unlink' && !triggered && file === path.join(directory, '.transaction.json')) { triggered = true; throw injected('EIO') }
        await fs.unlink(file)
        if (file === path.join(directory, r.filename)) sourceRemoved = true
      },
      open: async (file, flags, mode) => {
        const h = await fs.open(file, flags, mode)
        if (!(flags & constants.O_DIRECTORY) || file !== directory || phase !== 'source-directory-sync') return h
        return new Proxy(h, { get(handle, key) {
          if (key === 'sync') return async () => {
            if (!triggered && sourceRemoved) { triggered = true; throw injected('EIO') }
            return handle.sync()
          }
          const value = Reflect.get(handle, key, handle)
          return typeof value === 'function' ? value.bind(handle) : value
        } })
      },
    }
    await assert.rejects(new ThreadLibrary({ directory, io }).rename(r.document.threadId, `Recovered ${phase}`, r.revision), code('io-error'))
    assert.ok(triggered, phase)
    const restarted = new ThreadLibrary({ directory })
    r = await restarted.read(r.document.threadId)
    assert.equal(r.filename, target)
    assert.deepEqual(r.document.cards, fixture.cards)
    assert.equal((await restarted.list()).threads.length, 1)
    await assert.rejects(fs.stat(path.join(directory, '.transaction.json')), { code: 'ENOENT' })
  }
})

test('live writer locks reject concurrent bridges; dead-PID locks recover safely', async t => {
  const { directory, library } = await setup(t)
  await library.list()
  const lock = path.join(directory, '.writer-lock')
  await fs.writeFile(lock, String(process.pid))
  await assert.rejects(library.list(), code('library-busy'))
  await fs.writeFile(lock, '2147483647')
  assert.deepEqual((await library.list()).threads, [])
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' })
  await fs.writeFile(lock, '')
  await assert.rejects(library.list(), code('library-busy'))
})
