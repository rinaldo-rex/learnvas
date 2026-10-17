import assert from 'node:assert/strict'
import test from 'node:test'
import { setMergeScope, sourceContext } from './mergeContext.ts'
import { captureDeletion, restoreDeletion } from './deletion.ts'
import { buildConversation } from './conversation.ts'
import { canvasToDocument, createThreadMetadata, documentToCanvas } from './learnDocument.ts'

const prompt = (id, extra = {}) => ({ id, type: 'prompt', position: { x: 0, y: 0 }, data: { kind: 'prompt', text: id, sent: false, collapsed: false, ...extra } })
const edge = (source, target, scope) => ({ id: `${source}-${target}`, source, target, ...(scope ? { data: { mergeContext: scope } } : {}) })
const graph = () => ({
  nodes: [prompt('history-a'), prompt('a'), prompt('history-b'), prompt('b'), prompt('merge', { mergeContext: 'histories' }), prompt('other')],
  edges: [edge('history-a', 'a'), edge('history-b', 'b'), edge('a', 'merge'), edge('b', 'merge'), edge('b', 'other')],
})

test('one source choice preserves the default, other edges, ordering, and input state', () => {
  const g = graph()
  const before = structuredClone(g)
  const next = setMergeScope(g.nodes, g.edges, 'merge', 'selected', 'b')
  assert.deepEqual(g, before)
  assert.equal(next.nodes, g.nodes)
  assert.deepEqual(next.edges.map(e => e.id), g.edges.map(e => e.id))
  assert.equal(next.edges[2], g.edges[2])
  assert.equal(sourceContext('histories', next.edges[3]), 'selected')
  assert.equal(next.edges[4], g.edges[4])
})

test('whole-merge choices reset overrides without altering unrelated edge data', () => {
  const g = graph()
  g.edges[2].data = { mergeContext: 'histories', other: 'untouched' }
  const next = setMergeScope(g.nodes, g.edges, 'merge', 'selected')
  assert.equal(next.nodes.find(n => n.id === 'merge').data.mergeContext, 'selected')
  assert.deepEqual(next.edges[2].data, { other: 'untouched' })
  assert.ok(next.edges.filter(e => e.target === 'merge').every(e => sourceContext('selected', e) === 'selected'))
  const reset = setMergeScope(next.nodes, next.edges, 'merge', 'histories')
  assert.ok(reset.edges.filter(e => e.target === 'merge').every(e => sourceContext('histories', e) === 'histories'))
  assert.equal(g.edges[2].data.mergeContext, 'histories')
})

test('sent and ordinary prompts cannot acquire editable source overrides', () => {
  const g = graph()
  g.nodes.find(n => n.id === 'merge').data.sent = true
  for (const id of ['missing', 'a', 'merge']) {
    const next = setMergeScope(g.nodes, g.edges, id, 'selected', 'b')
    assert.equal(next.nodes, g.nodes)
    assert.equal(next.edges, g.edges)
  }
})

test('source deletion and undo carry overrides, survive saving, and retain context boundaries', () => {
  const g = graph()
  const mixed = setMergeScope(g.nodes, g.edges, 'merge', 'selected', 'b')
  mixed.edges.find(e => e.source === 'a' && e.target === 'merge').data = { mergeContext: 'histories' }
  const deleted = captureDeletion(mixed, 'a')
  const current = {
    nodes: mixed.nodes.filter(n => !deleted.nodes.some(d => d.id === n.id)),
    edges: mixed.edges.filter(e => !deleted.edges.some(d => d.id === e.id)),
  }
  assert.equal(current.edges.find(e => e.source === 'b' && e.target === 'merge').data.mergeContext, 'selected')
  const restored = restoreDeletion(current, deleted)
  assert.equal(restored.edges.find(e => e.source === 'a' && e.target === 'merge').data.mergeContext, 'histories')
  const saved = canvasToDocument({ ...restored, viewport: { x: 0, y: 0, zoom: 1 } }, createThreadMetadata())
  const canvas = documentToCanvas(saved)
  const messages = buildConversation(canvas.nodes, canvas.edges, 'merge')
  const material = JSON.parse(messages[0].content.slice(messages[0].content.indexOf('{')))
  assert.ok(material.cards.some(c => c.id === 'history-a'))
  assert.ok(!material.cards.some(c => c.id === 'history-b'))
  assert.equal(canvas.edges.find(e => e.source === 'b' && e.target === 'merge').data.mergeContext, 'selected')
})
