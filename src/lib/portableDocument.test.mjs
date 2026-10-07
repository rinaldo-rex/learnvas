import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { MAX_DOCUMENT_BYTES, canvasToDocument, documentToCanvas } from './learnDocument.ts'
import { parsePortableDocument, readPortableFile, validatePortableDocument } from './portableDocument.ts'
import { ThreadWorkspace } from './threadWorkspace.ts'
import { ThreadApiError } from './threadApi.ts'
import { ThreadLibrary, LibraryError } from '../../server/library.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/branched.learn', import.meta.url), 'utf8'))
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
function apiFor(library) {
  const wrap = method => async (...args) => {
    try { return await library[method](...args) }
    catch (error) { if (error instanceof LibraryError) throw new ThreadApiError(error.message, error.code, error.details.proposedFilename); throw error }
  }
  return Object.fromEntries(['list', 'read', 'create', 'save', 'rename', 'trash', 'restore'].map(method => [method, wrap(method)]))
}
async function setup(t, confirmation = () => true, id = 'active') {
  const directory = await mkdtemp(`${tmpdir()}/learnvas-portable-`)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const library = new ThreadLibrary({ directory })
  await library.create({ ...fixture, threadId: id, title: id === 'active' ? 'Active' : 'Destination' })
  const api = apiFor(library)
  const workspace = new ThreadWorkspace(api, () => {}, confirmation)
  await workspace.start(id)
  const active = structuredClone(workspace.getSnapshot().active.document)
  let stops = 0
  workspace.bind(id, { snapshot: () => active, stop: () => { stops++ } })
  return { library, api, workspace, active, stops: () => stops }
}
test('portable parsing rejects malformed JSON, marker, versions, unknown fields and active statuses', () => {
  for (const [input, code] of [
    ['{oops', 'invalid-json'], [{ ...fixture, format: 'other' }, 'invalid-format'],
    [{ ...fixture, version: 99 }, 'unsupported-version'], [{ ...fixture, version: 1 }, 'unsupported-version'], [{ ...fixture, credentials: 'secret' }, 'invalid-document'],
    [{ ...fixture, cards: fixture.cards.map(c => c.kind === 'response' ? { ...c, status: 'streaming' } : c) }, 'invalid-document'],
  ]) assert.throws(() => parsePortableDocument(bytes(input)), error => error.code === code)
  assert.throws(() => parsePortableDocument(new Uint8Array([255])), /UTF-8/)
  assert.deepEqual(parsePortableDocument(bytes(fixture)), fixture)
})
test('8 MiB bounds apply to upload size, raw bytes and canonical serialization', async () => {
  let allocated = false
  await assert.rejects(readPortableFile({ size: MAX_DOCUMENT_BYTES + 1, async arrayBuffer() { allocated = true } }), /8 MiB/)
  assert.equal(allocated, false)
  assert.throws(() => parsePortableDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1)), /8 MiB/)
  const large = structuredClone(fixture)
  large.cards[0].text = 'x'.repeat(MAX_DOCUMENT_BYTES)
  assert.throws(() => validatePortableDocument(large), /8 MiB/)
  // Compact bytes can fit while canonical indentation pushes the document over the limit.
  const compact = structuredClone(fixture)
  compact.cards[0].text = ''
  compact.cards[0].text = 'x'.repeat(MAX_DOCUMENT_BYTES - bytes(compact).byteLength)
  assert.equal(bytes(compact).byteLength, MAX_DOCUMENT_BYTES)
  assert.throws(() => parsePortableDocument(bytes(compact)), /8 MiB/)
  const validBytes = bytes(fixture)
  assert.deepEqual(await readPortableFile({ size: validBytes.byteLength, async arrayBuffer() { return validBytes.buffer } }), fixture)
})
test('export from one library and import into another preserves complete semantics and identity', async t => {
  const source = await setup(t)
  const exported = await source.workspace.exportActive()
  assert.equal(exported.filename, 'Active.learn')
  const target = await setup(t, () => true, 'destination')
  const doc = parsePortableDocument(bytes(exported.json))
  const record = await target.workspace.importDocument(doc, () => true)
  const imported = (await target.library.read(record.document.threadId)).document
  assert.deepEqual(imported, doc)
  assert.deepEqual(imported.cards, source.active.cards)
  assert.deepEqual(imported.connections, source.active.connections)
  assert.deepEqual(imported.viewport, source.active.viewport)
  assert.equal(target.workspace.getSnapshot().active.document.threadId, 'destination')
  assert.equal(target.stops(), 0)
})
test('cancelled initial, duplicate-ID and filename confirmations never mutate library or canvas', async t => {
  for (const phase of ['import', 'copy', 'filename']) {
    const { workspace, library, active, stops } = await setup(t, () => false)
    const before = await library.list()
    const canvas = structuredClone(active)
    const document = phase === 'filename' ? { ...fixture, threadId: 'new-id', title: 'Active' } : { ...fixture, threadId: 'active', title: 'Active' }
    const result = await workspace.importDocument(document, kind => kind !== phase)
    assert.equal(result, null)
    assert.deepEqual(await library.list(), before)
    assert.deepEqual(active, canvas)
    assert.equal(workspace.getSnapshot().active.document.threadId, 'active')
    assert.equal(stops(), 0)
  }
})
test('duplicate active and trash IDs only create separate confirmed copies', async t => {
  for (const trash of [false, true]) {
    const proposals = []
    const { workspace, library } = await setup(t, filename => { proposals.push(filename); return true })
    const original = await library.read('active')
    if (trash) await library.trash('active', original.revision)
    const choices = []
    const imported = await workspace.importDocument({ ...fixture, threadId: 'active', title: 'Active' }, kind => { choices.push(kind); return true })
    assert.deepEqual(choices, ['import', 'copy'])
    assert.notEqual(imported.document.threadId, 'active')
    assert.deepEqual(imported.document.cards, fixture.cards)
    assert.deepEqual((await library.read('active', trash)).document, original.document)
    if (!trash) assert.deepEqual(proposals, ['Active (2).learn'])
  }
})
test('distinct IDs with filename collision require explicit numbered filename confirmation', async t => {
  const confirmations = []
  const { workspace, library } = await setup(t, name => { confirmations.push(name); return true })
  const original = await library.read('active')
  const imported = await workspace.importDocument({ ...fixture, threadId: 'new', title: 'Active' }, () => true)
  assert.equal(imported.filename, 'Active (2).learn')
  assert.deepEqual(confirmations, ['Active (2).learn'])
  assert.deepEqual(await library.read('active'), original)
})
test('invalid imports and bridge write failures preserve active canvas, revisions and autosave state', async t => {
  const { workspace, library, api, active, stops } = await setup(t)
  const original = await library.read('active')
  const canvas = structuredClone(active)
  await assert.rejects(workspace.importDocument({ ...fixture, version: 22 }, () => { throw new Error('Must not ask') }), /unsupported/)
  assert.equal(workspace.getSnapshot().status, 'saved')
  api.create = async () => { throw new Error('Permission denied') }
  await assert.rejects(workspace.importDocument({ ...fixture, threadId: 'new' }, () => true), /Permission denied/)
  assert.deepEqual(await library.read('active'), original)
  assert.deepEqual(active, canvas)
  assert.equal(stops(), 0)
  assert.equal(workspace.getSnapshot().status, 'saved')
})
test('cancelled import does not cancel an already pending autosave', async t => {
  const { workspace, library, active } = await setup(t)
  active.cards[0].text = 'Pending before import'
  workspace.changed()
  await workspace.importDocument(fixture, () => false)
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.equal((await library.read('active')).document.cards[0].text, 'Pending before import')
})
test('export rejects an externally changed saved revision even when there are no local edits', async t => {
  const { workspace, library } = await setup(t)
  const existing = await library.read('active')
  await library.save('active', existing.document, existing.revision)
  await assert.rejects(workspace.exportActive(), error => error.code === 'revision-conflict')
})
test('exports save latest draft, stop/flush partial output and exclude runtime state', async t => {
  const { workspace, active } = await setup(t)
  const canvas = documentToCanvas(active)
  canvas.nodes[0].data.text = 'Latest unsaved draft'
  const response = canvas.nodes.find(n => n.type === 'response')
  response.data.status = 'streaming'
  response.data.activity = 'tool running'
  response.data.credentials = 'not persisted'
  response.measured = { width: 123, height: 456 }
  let stopped = false
  workspace.bind('active', {
    snapshot: () => canvasToDocument(canvas, active),
    stop: () => { stopped = true; response.data.text = 'Buffered final partial text'; response.data.status = 'stopped' },
  })
  const exported = await workspace.exportActive()
  const document = JSON.parse(exported.json)
  assert.equal(stopped, true)
  assert.equal(document.cards[0].text, 'Latest unsaved draft')
  assert.equal(document.cards.find(c => c.kind === 'response').text, 'Buffered final partial text')
  assert.equal(document.cards.find(c => c.kind === 'response').status, 'stopped')
  for (const field of ['activity', 'credentials', 'measured', 'undo', 'animated']) assert.equal(exported.json.includes(`"${field}"`), false)
})
test('save errors, stale revisions and edits during export yield no export result', async t => {
  for (const failure of ['save', 'conflict', 'edit']) {
    const { workspace, library, api, active } = await setup(t)
    const before = await library.read('active')
    active.cards[0].text = 'Unsaved local draft'
    if (failure === 'save') api.save = async () => { throw new Error('Disk full') }
    if (failure === 'conflict') {
      const external = structuredClone(before.document); external.cards[0].text = 'Newer external draft'
      await library.save('active', external, before.revision)
    }
    if (failure === 'edit') {
      const read = api.read
      api.read = async (...args) => { const result = await read(...args); active.cards[0].text = 'Edited during export'; return result }
    }
    await assert.rejects(workspace.exportActive())
    assert.equal(workspace.getSnapshot().active.document.threadId, 'active')
    if (failure === 'save') assert.deepEqual(await library.read('active'), before)
    if (failure === 'conflict') assert.equal((await library.read('active')).document.cards[0].text, 'Newer external draft')
  }
})
