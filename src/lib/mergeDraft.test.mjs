import assert from 'node:assert/strict'
import test from 'node:test'
import { createMergeDraft } from './mergeDraft.ts'
import { canvasToDocument, createThreadMetadata } from './learnDocument.ts'

const prompt = (id, x = 0, y = 0) => ({ id, type: 'prompt', position: { x, y }, data: { kind: 'prompt', text: id, sent: false, collapsed: false } })

test('merging needs at least two distinct, existing sources', () => {
  const nodes = [prompt('a'), prompt('b')]
  for (const ids of [[], ['a'], ['a', 'a'], ['a', 'missing']]) assert.equal(createMergeDraft(nodes, ids), null)
})

test('draft creation preserves originals, source order, and supports arbitrary roots', () => {
  const nodes = [prompt('a'), prompt('b', 0, 300), prompt('other', 400, 150)]
  const before = structuredClone(nodes)
  const draft = createMergeDraft(nodes, ['b', 'a', 'b', 'missing'])
  assert.deepEqual(nodes, before)
  assert.equal(draft.node.data.text, '')
  assert.equal(draft.node.data.sent, false)
  assert.equal(draft.node.data.focus, true)
  assert.equal(draft.node.data.mergeContext, 'histories')
  assert.deepEqual(draft.edges.map(e => e.source), ['b', 'a'])
  assert.ok(draft.edges.every(e => e.target === draft.node.id))
  assert.ok(draft.node.position.y > nodes[2].position.y + 180)
  const document = canvasToDocument({ nodes: [...nodes, draft.node], edges: draft.edges, viewport: { x: 0, y: 0, zoom: 1 } }, createThreadMetadata())
  assert.equal(document.cards.find(c => c.id === draft.node.id).mergeContext, 'histories')
  assert.equal(document.cards.find(c => c.id === draft.node.id).focus, undefined)
})
