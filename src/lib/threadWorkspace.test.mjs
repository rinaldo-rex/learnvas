import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ThreadWorkspace } from './threadWorkspace.ts'
import { ThreadApiError } from './threadApi.ts'
import { StreamOwner } from './streamOwner.ts'

const fixture = JSON.parse(await readFile(new URL('./fixtures/branched.learn', import.meta.url), 'utf8'))
function setup() {
  const docs = new Map()
  const trashed = new Map()
  let revision = 0
  const calls = []
  const pack = document => ({ document: structuredClone(document), revision: `${++revision}`, filename: `${document.title}.learn` })
  for (const id of ['a', 'b']) docs.set(id, pack({ ...fixture, threadId: id, title: id }))
  const api = {
    async list(trash = false) { return { threads: [...(trash ? trashed : docs).values()].map(r => ({ ...r.document, revision: r.revision, filename: r.filename })), warnings: [] } },
    async read(id) { calls.push(['read', id]); if (!docs.has(id)) throw new Error('Missing'); return structuredClone(docs.get(id)) },
    async create(document) { calls.push(['create', document.threadId]); const r = pack(document); docs.set(document.threadId, r); return r },
    async save(id, document, rev) {
      calls.push(['save', id]);
      if (docs.get(id).revision !== rev) throw new ThreadApiError('Changed elsewhere', 'revision-conflict')
      const r = pack(document); docs.set(id, r); return r
    },
    async rename(id, title, rev) { return this.save(id, { ...docs.get(id).document, title }, rev) },
    async trash(id, rev) {
      calls.push(['trash', id]); assert.equal(docs.get(id).revision, rev)
      const r = docs.get(id); docs.delete(id); trashed.set(id, r); return r
    },
    async restore(id) { const r = trashed.get(id); trashed.delete(id); docs.set(id, r); return r },
  }
  const remembered = []
  const confirmations = []
  const workspace = new ThreadWorkspace(api, id => remembered.push(id), filename => { confirmations.push(filename); return true })
  return { workspace, api, docs, trashed, calls, remembered, confirmations }
}
function bind(workspace) {
  const document = structuredClone(workspace.getSnapshot().active.document)
  let stopped = 0
  const unbind = workspace.bind(document.threadId, { snapshot: () => document, stop: () => { stopped++; document.cards.filter(c => c.kind === 'response').forEach(c => { c.status = 'stopped' }) } })
  return { document, unbind, stopped: () => stopped }
}
test('startup is idempotent, remembers last selection, ignores missing convenience ID', async () => {
  const { workspace, calls, remembered } = setup()
  await Promise.all([workspace.start('b'), workspace.start('b')])
  assert.equal(calls.filter(c => c[0] === 'read').length, 1)
  assert.equal(remembered[0], 'b')
  const another = setup().workspace
  await another.start('missing')
  assert.equal(another.getSnapshot().active.document.threadId, 'a')
})
test('switch stops and saves outgoing partial text/layout before replacing canvas', async () => {
  const { workspace, docs, calls } = setup()
  await workspace.start('a')
  const current = bind(workspace)
  current.document.cards[0].text = 'draft edited'
  const answer = current.document.cards.find(c => c.kind === 'response')
  answer.text = 'partial output'
  current.document.viewport = { x: -54, y: 102, zoom: 0.8 }
  current.document.cards[0].width = 420
  await workspace.select('b')
  assert.equal(current.stopped(), 1)
  assert.equal(docs.get('a').document.cards[0].text, 'draft edited')
  assert.equal(docs.get('a').document.cards.find(c => c.kind === 'response').status, 'stopped')
  assert.equal(docs.get('a').document.cards.find(c => c.kind === 'response').text, 'partial output')
  assert.deepEqual(docs.get('a').document.viewport, current.document.viewport)
  assert.equal(docs.get('a').document.cards[0].width, 420)
  assert.equal(workspace.getSnapshot().active.document.threadId, 'b')
  assert.deepEqual(calls.slice(-2), [['read', 'b'], ['save', 'a']])
  await workspace.select('a')
  assert.deepEqual(workspace.getSnapshot().active.document, docs.get('a').document)
})
test('failed save and stale revision keep active canvas and edits, recovery copy is safe', async () => {
  for (const conflict of [false, true]) {
    const { workspace, api, docs } = setup()
    await workspace.start('a')
    const current = bind(workspace)
    current.document.cards[0].text = 'unsaved work'
    if (conflict) docs.get('a').revision = 'external'
    else api.save = async () => { throw new Error('Disk full') }
    await assert.rejects(workspace.select('b'))
    assert.equal(workspace.getSnapshot().active.document.threadId, 'a')
    assert.equal(current.document.cards[0].text, 'unsaved work')
    assert.equal(workspace.getSnapshot().status, conflict ? 'conflict' : 'error')
    await workspace.recoverCopy('Recovered')
    assert.equal(workspace.getSnapshot().active.document.title, 'Recovered')
    assert.notEqual(workspace.getSnapshot().active.document.threadId, 'a')
    assert.notEqual(docs.get('a').document.cards[0].text, 'unsaved work')
  }
})
test('failed destination read does not stop generation or change canvas', async () => {
  const { workspace } = setup()
  await workspace.start('a')
  const current = bind(workspace)
  await assert.rejects(workspace.select('missing'))
  assert.equal(current.stopped(), 0)
  assert.equal(workspace.getSnapshot().active.document.threadId, 'a')
})
test('edits during save remain unsaved; outgoing switch cannot abandon them', async () => {
  const { workspace, api } = setup()
  await workspace.start('a')
  const current = bind(workspace)
  current.document.cards[0].text = 'first'
  const save = api.save
  api.save = async (...args) => { const result = await save(...args); current.document.cards[0].text = 'second'; return result }
  await assert.rejects(workspace.select('b'), /changed while saving/)
  assert.equal(workspace.getSnapshot().active.document.threadId, 'a')
  // Clear pending autosave without losing test isolation.
  api.save = save
  await workspace.retry()
  assert.equal(workspace.getSnapshot().active.document.cards[0].text, 'second')
})
test('per-thread tutor notes patch, save, and clear to key-omission (no resurrection)', async () => {
  const { workspace } = setup()
  await workspace.start('a')
  const document = structuredClone(workspace.getSnapshot().active.document)
  let stopped = 0
  workspace.bind('a', { snapshot: () => document, stop: () => { stopped++ } })

  workspace.patchMetadata({ tutorNotes: 'Use mermaid diagrams.' })
  assert.equal(workspace.getSnapshot().status, 'unsaved')
  await workspace.retry()
  assert.equal(workspace.getSnapshot().active.document.tutorNotes, 'Use mermaid diagrams.')

  // Deleting all notes must save a document WITHOUT the key, and the value
  // must not resurrect from a binding snapshot made before the deletion.
  workspace.patchMetadata({ tutorNotes: '' })
  await workspace.retry()
  const saved = workspace.getSnapshot().active.document
  assert.equal('tutorNotes' in saved, false, 'cleared notes must omit the field entirely')
  assert.equal(workspace.getSnapshot().status, 'saved')

  // Re-typing works after a clear (override replaces, never merges stale).
  workspace.patchMetadata({ tutorNotes: 'Back again.' })
  await workspace.retry()
  assert.equal(workspace.getSnapshot().active.document.tutorNotes, 'Back again.')
})

test('rename preserves binding and uses new immutable metadata on subsequent save', async () => {
  const { workspace } = setup()
  await workspace.start('a')
  const current = bind(workspace)
  await workspace.rename('Renamed')
  current.document.cards[0].text = 'after rename'
  await workspace.retry()
  assert.equal(workspace.getSnapshot().active.document.title, 'Renamed')
})
test('active trash saves first, detaches canvas, restores without resuming generation', async () => {
  const { workspace, docs, trashed } = setup()
  await workspace.start('a')
  const current = bind(workspace)
  current.document.cards[0].text = 'keep in trash'
  await workspace.trashActive()
  assert.equal(workspace.getSnapshot().active, null)
  assert.equal(trashed.get('a').document.cards[0].text, 'keep in trash')
  assert.equal(docs.has('a'), false)
  await workspace.restore('a', trashed.get('a').revision)
  await workspace.select('a')
  assert.equal(workspace.getSnapshot().active.document.cards[0].text, 'keep in trash')
})
test('late stream callbacks cannot modify a switched canvas or stopped answer', () => {
  let mounted = true
  const old = new StreamOwner(() => mounted)
  const current = { text: '' }
  const lateDelta = () => { if (old.accepts()) current.text += 'late' }
  old.invalidate()
  lateDelta()
  assert.equal(current.text, '')
  const unmounted = new StreamOwner(() => mounted)
  mounted = false
  assert.equal(unmounted.accepts(), false)
})
test('new thread includes starter draft; collisions must be confirmed and cancellation changes nothing', async () => {
  const { workspace, api } = setup()
  await workspace.start('a')
  await workspace.create('New')
  assert.equal(workspace.getSnapshot().active.document.cards[0].kind, 'prompt')
  assert.equal(workspace.getSnapshot().active.document.cards[0].sent, false)
  const cancelled = new ThreadWorkspace(api)
  await cancelled.start('a')
  const before = cancelled.getSnapshot().active
  api.create = async () => { throw new ThreadApiError('Collision', 'filename-conflict', 'New (2).learn') }
  await cancelled.create('New')
  assert.equal(cancelled.getSnapshot().active, before)
})
