import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  canvasToDocument, createThreadMetadata, documentToCanvas, LearnDocumentError,
  parseDocument, serializeDocument, validateDocument,
} from './learnDocument.ts'
import { CANVAS_STORE_KEY, loadCanvas, saveCanvas } from './canvasStorage.ts'

const fixtureUrl = new URL('./fixtures/branched.learn', import.meta.url)
const fixture = () => JSON.parse(readFileSync(fixtureUrl, 'utf8'))
const metadata = d => ({ threadId: d.threadId, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, ...(d.tutorNotes !== undefined ? { tutorNotes: d.tutorNotes } : {}) })
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

for (const name of ['branched', 'empty']) {
  test(`${name} fixture round-trips through JSON and UI canvas without losing canonical fields`, () => {
    const raw = readFileSync(new URL(`./fixtures/${name}.learn`, import.meta.url), 'utf8')
    const d = parseDocument(raw)
    const original = structuredClone(d)
    const canvas = documentToCanvas(freeze(d))
    const restored = canvasToDocument(canvas, metadata(d))
    assert.deepEqual(restored, original)
    assert.deepEqual(parseDocument(serializeDocument(restored)), original)
    assert.ok(serializeDocument(restored).endsWith('\n'))
    assert.ok(serializeDocument(restored).includes('\n  "format"'))
  })
}

test('branched fixture preserves multiple roots, quotes, drafts, models, sizes, partial text, and viewport', () => {
  const d = validateDocument(fixture())
  const roots = d.cards.filter(c => !d.connections.some(e => e.target === c.id))
  assert.equal(roots.length, 3)
  assert.equal(d.cards.find(c => c.id === 'unsent-branch').text, '')
  assert.equal(d.cards.find(c => c.id === 'unsent-branch').sent, false)
  assert.equal(d.cards.find(c => c.id === 'quote-draft').quote, 'Plants convert light into chemical energy.')
  assert.equal(d.cards.find(c => c.id === 'root-empty').quote, '')
  assert.equal(d.cards.find(c => c.id === 'partial-answer').status, 'stopped')
  assert.ok(d.cards.find(c => c.id === 'partial-answer').text.endsWith('such as'))
  assert.deepEqual(d.cards.filter(c => c.kind === 'response').map(c => c.model), [
    'anthropic/claude-sonnet-4', 'openai/gpt-4.1', 'pi default',
  ])
  assert.deepEqual(new Set(d.connections.map(e => e.sourceHandle)), new Set(['s', 's-top', 's-bottom', 's-left', 's-corner']))
  assert.deepEqual(new Set(d.connections.map(e => e.targetHandle)), new Set(['t', 't-top', 't-bottom', 't-right']))
  assert.deepEqual(d.viewport, { x: -325.5, y: 118.25, zoom: 0.75 })
  const canvas = documentToCanvas(d)
  const collapsed = canvas.nodes.find(n => n.id === 'answer-biology')
  assert.equal(collapsed.style.width, 480)
  assert.equal(collapsed.style.height, undefined)
  assert.equal(collapsed.data.height, 360) // expanded size remains saved while collapsed
  const expanded = canvas.nodes.find(n => n.id === 'partial-answer')
  assert.deepEqual(expanded.style, { width: 420, height: 280 })
  assert.equal(expanded.data.height, 280)
  assert.deepEqual(canvas.nodes.find(n => n.id === 'quote-draft').style, { width: 300, height: 210 })
})

test('export allowlist drops runtime objects, credentials, arbitrary properties, and measurements without touching live state', () => {
  const d = fixture()
  const canvas = documentToCanvas(d)
  const controller = new AbortController()
  const secret = 'PRIVATE_API_TOKEN_123'
  for (const node of canvas.nodes) {
    node.selected = true
    node.dragging = true
    node.measured = { width: 777, height: 888 }
    node.width = 777
    node.height = 888
    node.style = { width: 999, height: 999, background: secret }
    node.credentials = { apiKey: secret }
    node.data.apiKey = secret
    node.data.abortController = controller
    node.data.extension = { handler: () => {}, key: secret }
    node.data.circular = node
    if (node.type === 'prompt') node.data.focus = true
    else { node.data.status = 'streaming'; node.data.activity = `Searching ${secret}` }
  }
  canvas.theme = 'dark'
  canvas.undo = [canvas]
  for (const edge of canvas.edges) {
    edge.animated = true
    edge.selected = true
    edge.data = { apiKey: secret, controller }
  }
  const projected = canvasToDocument(canvas, { ...metadata(d), apiKey: secret })
  const raw = serializeDocument(projected)
  for (const forbidden of [secret, 'measured', 'selected', 'dragging', 'focus', 'activity', 'abortController', 'extension', 'undo', 'theme', 'animated', 'style']) {
    assert.equal(raw.includes(forbidden), false, forbidden)
  }
  assert.equal(projected.cards.find(c => c.id === 'root-biology').width, undefined)
  assert.equal(projected.cards.find(c => c.id === 'answer-biology').width, 480)
  for (const node of canvas.nodes.filter(n => n.type === 'response')) {
    assert.equal(node.data.status, 'streaming')
    const card = projected.cards.find(c => c.id === node.id)
    assert.equal(card.status, 'stopped')
    assert.equal(card.text, node.data.text)
  }
  const loaded = documentToCanvas(projected)
  for (const node of loaded.nodes) {
    assert.equal(node.selected, false)
    assert.equal(node.dragging, false)
    assert.equal(node.measured, undefined)
    assert.equal(node.data.activity, undefined)
    assert.equal(node.data.abortController, undefined)
    if (node.type === 'prompt') assert.equal(node.data.focus, false)
    else assert.equal(node.data.status, 'stopped')
  }
  assert.ok(loaded.edges.every(e => e.animated === false))
})

test('only runtime streaming is normalized; terminal statuses are preserved', () => {
  const d = fixture()
  assert.deepEqual(canvasToDocument(documentToCanvas(d), metadata(d)).cards.filter(c => c.kind === 'response').map(c => c.status), ['done', 'stopped', 'error'])
})

test('missing legacy UI handles are projected to explicit canonical s/t ports', () => {
  const d = fixture()
  const canvas = documentToCanvas(d)
  delete canvas.edges[0].sourceHandle
  canvas.edges[0].targetHandle = null
  const result = canvasToDocument(canvas, metadata(d))
  assert.equal(result.connections[0].sourceHandle, 's')
  assert.equal(result.connections[0].targetHandle, 't')
})

test('validation returns detached JSON and never mutates valid or rejected inputs', () => {
  const original = fixture()
  const result = validateDocument(freeze(original))
  result.cards[0].position.x = 123
  result.cards[0].text = 'Changed'
  result.connections[0].source = 'Changed'
  result.viewport.zoom = 2
  assert.deepEqual(original, fixture())
})

test('long prompt chains validate iteratively and sparse runtime arrays fail as document errors', () => {
  const d = fixture()
  d.cards = Array.from({ length: 5000 }, (_, i) => ({
    id: `p${i}`, kind: 'prompt', position: { x: i * 10, y: 0 },
    text: '', sent: false, collapsed: false,
  }))
  d.connections = d.cards.slice(1).map((c, i) => ({
    id: `e${i}`, source: `p${i}`, target: c.id, sourceHandle: 's', targetHandle: 't',
  }))
  assert.equal(validateDocument(d).cards.length, 5000)
  d.connections.push({ id: 'cycle', source: 'p4999', target: 'p0', sourceHandle: 's', targetHandle: 't' })
  assert.throws(() => validateDocument(d), /cycles are not allowed/)
  for (const field of ['cards', 'connections']) {
    const sparse = fixture()
    sparse[field] = Array(1)
    assert.throws(() => validateDocument(sparse), LearnDocumentError)
  }
})

test('title and filename changes do not determine identity; fresh threads receive distinct IDs', () => {
  const d = fixture()
  d.title = 'Renamed thread'
  assert.equal(validateDocument(d).threadId, fixture().threadId)
  const first = createThreadMetadata('A title', '2026-02-01T10:00:00.000Z')
  const second = createThreadMetadata('A title', first.createdAt)
  assert.notEqual(first.threadId, second.threadId)
  assert.equal(first.createdAt, first.updatedAt)
})

const invalidCases = [
  ['missing marker', d => { delete d.format }, 'invalid-format'],
  ['wrong marker', d => { d.format = 'other' }, 'invalid-format'],
  ['nonstring marker', d => { d.format = 1 }, 'invalid-format'],
  ['retired v1', d => { d.version = 1 }, 'unsupported-version'],
  ['future version', d => { d.version = 99 }, 'unsupported-version'],
  ['missing version', d => { delete d.version }],
  ['string version', d => { d.version = '1' }],
  ['fractional version', d => { d.version = 1.5 }],
  ['zero version', d => { d.version = 0 }],
  ['negative version', d => { d.version = -1 }],
  ['null card', d => { d.cards[0] = null }],
  ['empty card ID', d => { d.cards[0].id = '' }],
  ['empty connection ID', d => { d.connections[0].id = '' }],
  ['missing response status', d => { delete d.cards[1].status }],
  ['missing source prompt ID', d => { delete d.cards[1].sourcePromptId }],
  ['nonboolean collapsed', d => { d.cards[0].collapsed = 'false' }],
  ['missing ID', d => { delete d.threadId }],
  ['empty ID', d => { d.threadId = ' ' }],
  ['empty title', d => { d.title = '' }],
  ['invalid date', d => { d.createdAt = 'yesterday' }],
  ['impossible date', d => { d.createdAt = '2026-02-30T10:00:00.000Z' }],
  ['non-UTC date', d => { d.createdAt = '2026-01-01T10:00:00+00:00' }],
  ['backwards timestamps', d => { d.updatedAt = '2025-01-01T10:00:00.000Z' }],
  ['nonarray cards', d => { d.cards = {} }],
  ['nonarray connections', d => { d.connections = null }],
  ['missing text', d => { delete d.cards[0].text }],
  ['missing collapsed', d => { delete d.cards[0].collapsed }],
  ['nonboolean sent', d => { d.cards[0].sent = 1 }],
  ['invalid kind', d => { d.cards[0].kind = 'note' }],
  ['duplicate card', d => { d.cards.push(structuredClone(d.cards[0])) }],
  ['duplicate connection', d => { d.connections.push(structuredClone(d.connections[0])) }],
  ['missing position', d => { delete d.cards[0].position }],
  ['string coordinate', d => { d.cards[0].position.x = '0' }],
  ['bad width', d => { d.cards[0].width = -1 }],
  ['zero height', d => { d.cards[0].height = 0 }],
  ['null size', d => { d.cards[0].width = null }],
  ['missing viewport', d => { delete d.viewport }],
  ['nonpositive zoom', d => { d.viewport.zoom = 0 }],
  ['string zoom', d => { d.viewport.zoom = '1' }],
  ['missing source', d => { d.connections[0].source = 'missing' }],
  ['missing target', d => { d.connections[0].target = 'missing' }],
  ['self edge', d => { d.connections[0].target = d.connections[0].source }],
  ['missing source port', d => { delete d.connections[0].sourceHandle }],
  ['invalid source port', d => { d.connections[0].sourceHandle = 't' }],
  ['invalid target port', d => { d.connections[0].targetHandle = 's' }],
  ['missing source prompt', d => { d.cards[1].sourcePromptId = 'missing' }],
  ['source prompt is a response', d => { d.cards[1].sourcePromptId = 'partial-answer' }],
  ['mismatched source prompt', d => { d.cards[1].sourcePromptId = 'root-math' }],
  ['response has no edge', d => { d.connections.shift() }],
  ['response parent is a response', d => { d.connections[0].source = 'partial-answer'; d.cards[1].sourcePromptId = 'partial-answer' }],
  ['two parents', d => { d.connections.push({ ...d.connections[1], id: 'extra-parent', source: 'root-math' }) }],
  ['cycle', d => { d.connections.push({ id: 'cycle', source: 'quote-draft', target: 'root-biology', sourceHandle: 's', targetHandle: 't' }) }],
  ['missing model', d => { delete d.cards[1].model }],
  ['empty model', d => { d.cards[1].model = ' ' }],
  ['active status', d => { d.cards[1].status = 'streaming' }],
  ['invalid status', d => { d.cards[1].status = 'ready' }],
  ['nonstring quote', d => { d.cards[2].quote = null }],
  ['null tutorNotes', d => { d.tutorNotes = null }],
  ['empty tutorNotes', d => { d.tutorNotes = '   ' }],
  ['unknown top-level field', d => { d.apiKey = 'secret' }],
  ['unknown card field', d => { d.cards[0].selected = true }],
  ['wrong kind field', d => { d.cards[1].sent = true }],
  ['unknown position field', d => { d.cards[0].position.z = 0 }],
  ['unknown viewport field', d => { d.viewport.theme = 'dark' }],
  ['unknown connection field', d => { d.connections[0].animated = true }],
]

for (const [name, change, code = 'invalid-document'] of invalidCases) {
  test(`rejects ${name} without changing the input file`, () => {
    const d = fixture()
    change(d)
    const dir = mkdtempSync(join(tmpdir(), 'learnvas-document-'))
    try {
      const file = join(dir, 'bad.learn')
      const raw = JSON.stringify(d, null, 2)
      writeFileSync(file, raw)
      assert.throws(() => parseDocument(readFileSync(file, 'utf8')), error => error instanceof LearnDocumentError && error.code === code)
      assert.equal(readFileSync(file, 'utf8'), raw)
      assert.throws(() => validateDocument(freeze(d)), LearnDocumentError)
      assert.equal(JSON.stringify(d, null, 2), raw)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test('schema version 1 remains retired without migration', () => {
  const d = fixture()
  d.version = 1
  assert.throws(() => validateDocument(d), error => error instanceof LearnDocumentError && error.code === 'unsupported-version' && /version 1/.test(error.message))
})

test('per-thread tutorNotes round-trips and must be omitted rather than empty', () => {
  const d = fixture()
  assert.equal(validateDocument(d).tutorNotes, undefined) // omission is canonical for "no notes"
  d.tutorNotes = 'Prefer mermaid diagrams for structure.'
  const round = parseDocument(serializeDocument(d))
  assert.equal(round.tutorNotes, 'Prefer mermaid diagrams for structure.')
  const canvas = documentToCanvas(round)
  const restored = canvasToDocument(canvas, metadata(round))
  assert.equal(restored.tutorNotes, 'Prefer mermaid diagrams for structure.')
  assert.deepEqual(parseDocument(serializeDocument(restored)), round)
})

test('rejects malformed JSON, nonobjects, and nonfinite numbers before JSON can silently replace them', () => {
  for (const raw of ['{', '', '{"format":', 'not JSON']) {
    assert.throws(() => parseDocument(raw), error => error.code === 'invalid-json')
  }
  for (const value of [null, [], true, 1, 'learnvas', new Date()]) assert.throws(() => validateDocument(value), LearnDocumentError)
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const change of [d => { d.cards[0].position.x = value }, d => { d.cards[0].width = value }, d => { d.viewport.zoom = value }]) {
      const d = fixture()
      change(d)
      assert.throws(() => validateDocument(d), LearnDocumentError)
      assert.throws(() => serializeDocument(d), LearnDocumentError)
    }
  }
  const d = fixture()
  d.cards[0].width = undefined
  assert.throws(() => serializeDocument(d), LearnDocumentError)
})

const memoryStorage = initial => {
  const values = new Map(initial)
  const writes = []
  return {
    values, writes,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
}

test('browser storage uses the document format and preserves stable metadata and viewport across reloads', () => {
  const storage = memoryStorage()
  assert.deepEqual(loadCanvas(storage), { kind: 'empty' })
  const d = fixture()
  saveCanvas(storage, d)
  assert.deepEqual(loadCanvas(storage), { kind: 'loaded', document: d })
  assert.equal(storage.writes[0][0], CANVAS_STORE_KEY)
  assert.deepEqual(JSON.parse(storage.writes[0][1]), d)
  assert.equal(storage.writes.length, 1) // reading never writes
})

test('discarded MVP storage is ignored rather than converted or removed', () => {
  const storage = memoryStorage([['learnvas:v1', '{"nodes":[],"edges":[]}']])
  assert.deepEqual(loadCanvas(storage), { kind: 'empty' })
  assert.equal(storage.values.get('learnvas:v1'), '{"nodes":[],"edges":[]}')
  assert.equal(storage.writes.length, 0)
})

test('invalid and unsupported browser documents remain byte-for-byte intact on load', () => {
  for (const raw of ['', '{bad', JSON.stringify({ ...fixture(), version: 99 }), JSON.stringify({ ...fixture(), version: 1 }), JSON.stringify({ ...fixture(), format: 'other' })]) {
    const storage = memoryStorage([[CANVAS_STORE_KEY, raw]])
    const loaded = loadCanvas(storage)
    assert.equal(loaded.kind, 'error')
    assert.ok(loaded.message)
    assert.equal(storage.values.get(CANVAS_STORE_KEY), raw)
    assert.equal(storage.writes.length, 0)
  }
})

test('invalid exports and blocked/full storage fail clearly without changing existing storage', () => {
  const storage = memoryStorage([[CANVAS_STORE_KEY, 'original']])
  assert.throws(() => saveCanvas(storage, { ...fixture(), apiKey: 'secret' }), LearnDocumentError)
  assert.equal(storage.values.get(CANVAS_STORE_KEY), 'original')
  assert.equal(storage.writes.length, 0)
  const unavailable = {
    getItem() { throw new Error('Storage blocked') },
    setItem() { throw new Error('Storage full') },
  }
  assert.deepEqual(loadCanvas(unavailable), { kind: 'error', message: 'Storage blocked' })
  assert.throws(() => saveCanvas(unavailable, fixture()), /Storage full/)
})
