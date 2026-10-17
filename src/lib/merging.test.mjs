import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { canvasToDocument, documentToCanvas, parseDocument, serializeDocument, validateDocument } from './learnDocument.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/branched.learn', import.meta.url), 'utf8'))
const prompt = (id, mergeContext) => ({
  id, kind: 'prompt', position: { x: 100, y: 100 }, text: `Question ${id}`, collapsed: false, sent: false,
  ...(mergeContext ? { mergeContext } : {}),
})
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: 's', targetHandle: 't' })
const merged = (scope = 'histories') => ({
  ...fixture(), cards: [prompt('a'), prompt('b'), prompt('merge', scope)],
  connections: [edge('a', 'merge'), edge('b', 'merge')],
})

test('current merges unrelated sources and round-trips scope, source order, and connections', () => {
  for (const scope of ['selected', 'histories']) {
    const d = merged(scope)
    const restored = canvasToDocument(documentToCanvas(d), d)
    assert.deepEqual(restored, d)
    assert.deepEqual(parseDocument(serializeDocument(restored)), d)
  }
})

test('per-source scopes round-trip separately from the merge-wide default without aliasing', () => {
  const d = merged()
  d.connections[1].mergeContext = 'selected'
  const before = structuredClone(d)
  const canvas = documentToCanvas(d)
  assert.equal(canvas.edges[1].data.mergeContext, 'selected')
  canvas.edges[1].data.apiKey = 'must-not-export'
  canvas.edges[1].data.callback = () => {}
  assert.deepEqual(canvasToDocument(canvas, d), before)
  assert.deepEqual(parseDocument(serializeDocument(d)), before)
  canvas.edges[1].data.mergeContext = 'histories'
  assert.deepEqual(d, before)
})

test('per-source overrides reject malformed scopes and non-merge targets', () => {
  for (const scope of [null, '', true, 'everything', undefined]) {
    const d = merged()
    d.connections[0].mergeContext = scope
    assert.throws(() => validateDocument(d), /expected selected or histories/)
  }
  const ordinary = fixture()
  ordinary.connections[0].mergeContext = 'selected'
  assert.throws(() => validateDocument(ordinary), /require a merge prompt target/)
  const d = merged()
  d.cards.push(prompt('ordinary'))
  d.connections.push({ ...edge('a', 'ordinary'), mergeContext: 'histories' })
  assert.throws(() => validateDocument(d), /require a merge prompt target/)
})

test('merge validation rejects invalid scopes, quotes, duplicate sources, missing sources, and cycles', () => {
  for (const scope of [null, '', true, 'everything']) {
    const d = merged()
    d.cards[2].mergeContext = scope
    assert.throws(() => validateDocument(d), /expected selected or histories/)
  }
  const quoted = merged()
  quoted.cards[2].quote = 'ambiguous source'
  assert.throws(() => validateDocument(quoted), /cannot have.*quote/)
  const duplicate = merged()
  duplicate.connections.push({ ...duplicate.connections[0], id: 'extra' })
  assert.throws(() => validateDocument(duplicate), /duplicate source/)
  const root = merged()
  root.connections = []
  assert.throws(() => validateDocument(root), /at least one source/)
  const cycle = merged()
  cycle.connections.push(edge('merge', 'a'))
  assert.throws(() => validateDocument(cycle), /cycles/)
  const ordinary = merged()
  delete ordinary.cards[2].mergeContext
  assert.throws(() => validateDocument(ordinary), /only merge prompts/)
})

test('responses still require exactly one matching prompt parent, even in a merged graph', () => {
  const d = merged()
  d.cards.push({ id: 'answer', kind: 'response', position: { x: 0, y: 0 }, text: 'Combined answer', collapsed: false, model: 'test/model', status: 'done', sourcePromptId: 'merge' })
  d.connections.push(edge('merge', 'answer'))
  assert.equal(validateDocument(d).cards.length, 4)
  d.connections.push(edge('a', 'answer'))
  assert.throws(() => validateDocument(d), /only merge prompts/)
})
