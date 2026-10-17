import assert from 'node:assert/strict'
import test from 'node:test'
import { captureDeletion, restoreDeletion } from './deletion.ts'

const prompt = (id, extra = {}) => ({
  id, type: 'prompt', position: { x: 100, y: 200 },
  data: { kind: 'prompt', text: id, sent: false, collapsed: false, ...extra },
})
const response = (id, status = 'done') => ({
  id, type: 'response', position: { x: 400, y: 200 },
  style: { width: 420, height: 300 }, selected: true,
  data: { kind: 'response', text: 'Partial answer', model: 'test/model', status, collapsed: false, sourcePromptId: 'root', activity: 'Searching…' },
})
const edge = (source, target) => ({ id: `${source}-${target}`, source, target, sourceHandle: 's', targetHandle: 't', animated: true })
const graph = () => ({
  nodes: [prompt('root'), response('answer'), prompt('child'), prompt('sibling'), prompt('other')],
  edges: [edge('root', 'answer'), edge('answer', 'child'), edge('root', 'sibling')],
})
const without = (graph, deleted) => ({
  nodes: graph.nodes.filter((node) => !deleted.nodes.some((removed) => removed.id === node.id)),
  edges: graph.edges.filter((edge) => !deleted.edges.some((removed) => removed.id === edge.id)),
})

test('deletion captures descendants and incoming edges but leaves sibling branches alone', () => {
  const source = graph()
  const deleted = captureDeletion(source, 'answer')
  assert.deepEqual(deleted.nodes.map((node) => node.id), ['answer', 'child'])
  assert.deepEqual(deleted.edges.map((edge) => edge.id), ['root-answer', 'answer-child'])
  deleted.nodes[0].data.text = 'Changed snapshot'
  deleted.nodes[0].position.x = 0
  deleted.edges[0].sourceHandle = 'different'
  assert.equal(source.nodes[1].data.text, 'Partial answer')
  assert.equal(source.nodes[1].position.x, 400)
  assert.equal(source.edges[0].sourceHandle, 's')
})

test('missing card is a no-op and cyclic edges do not loop forever', () => {
  assert.equal(captureDeletion(graph(), 'missing'), null)
  const source = graph()
  source.edges.push(edge('child', 'answer'))
  assert.deepEqual(captureDeletion(source, 'answer').nodes.map((node) => node.id), ['answer', 'child'])
})

test('restore merges a branch without rolling back edits or new cards elsewhere', () => {
  const source = graph()
  const deleted = captureDeletion(source, 'answer')
  const current = without(source, deleted)
  current.nodes.find((node) => node.id === 'other').data.text = 'New work'
  current.nodes.push(prompt('new'))
  current.edges.push(edge('other', 'new'))
  const restored = restoreDeletion(current, deleted)
  assert.deepEqual(restored.nodes.map((node) => node.id), ['root', 'sibling', 'other', 'new', 'answer', 'child'])
  assert.equal(restored.nodes.find((node) => node.id === 'other').data.text, 'New work')
  assert.deepEqual(restored.nodes.find((node) => node.id === 'answer').style, { width: 420, height: 300 })
  assert.deepEqual(restored.edges.map((edge) => edge.id), ['root-sibling', 'other-new', 'root-answer', 'answer-child'])
  assert.equal(restored.edges[1], current.edges[1])
  assert.equal(restored.edges[2].sourceHandle, 's')
  assert.equal(restored.edges[2].animated, false)
})

test('restored streams are stopped, drafts do not steal focus, and snapshots stay unchanged', () => {
  const source = { nodes: [prompt('root', { focus: true }), response('answer', 'streaming')], edges: [edge('root', 'answer')] }
  const deleted = captureDeletion(source, 'root')
  const restored = restoreDeletion({ nodes: [], edges: [] }, deleted)
  assert.equal(restored.nodes[0].data.focus, false)
  assert.equal(restored.nodes[1].data.status, 'stopped')
  assert.equal(restored.nodes[1].data.text, 'Partial answer')
  assert.equal(restored.nodes[1].data.activity, undefined)
  assert.equal(restored.nodes[1].selected, false)
  assert.equal(restored.nodes[1].dragging, false)
  assert.equal(deleted.nodes[0].data.focus, true)
  assert.equal(deleted.nodes[1].data.status, 'streaming')
  assert.equal(deleted.edges[0].animated, true)
})

test('restore preserves terminal response statuses', () => {
  for (const status of ['done', 'error', 'stopped']) {
    const restored = restoreDeletion({ nodes: [], edges: [] }, { nodes: [response('answer', status)], edges: [] })
    assert.equal(restored.nodes[0].data.status, status)
  }
})

test('restore avoids duplicates and dangling edges', () => {
  const deleted = captureDeletion(graph(), 'answer')
  const newer = response('answer')
  newer.data.text = 'Newer answer'
  const current = { nodes: [newer], edges: [edge('answer', 'child')] }
  const restored = restoreDeletion(current, deleted)
  assert.equal(restored.nodes.filter((node) => node.id === 'answer').length, 1)
  assert.equal(restored.nodes[0].data.text, 'Newer answer')
  assert.deepEqual(restored.edges.map((edge) => edge.id), ['answer-child'])
})

test('deleting one source preserves shared merges and descendants; undo restores source edges', () => {
  const source = {
    nodes: [prompt('a'), prompt('b'), prompt('merge', { mergeContext: 'selected' }), prompt('follow-up')],
    edges: [edge('a', 'merge'), edge('b', 'merge'), edge('merge', 'follow-up')],
  }
  const deleted = captureDeletion(source, 'a')
  assert.deepEqual(deleted.nodes.map(n => n.id), ['a'])
  assert.deepEqual(deleted.edges.map(e => e.id), ['a-merge'])
  const current = without(source, deleted)
  current.nodes.find(n => n.id === 'merge').data.text = 'New merge instructions'
  const restored = restoreDeletion(current, deleted)
  assert.equal(restored.nodes.find(n => n.id === 'merge').data.text, 'New merge instructions')
  assert.deepEqual(restored.edges.map(e => e.id).sort(), source.edges.map(e => e.id).sort())
  // Removing the last source removes the now-unowned merge and its descendants.
  assert.deepEqual(captureDeletion(current, 'b').nodes.map(n => n.id), ['b', 'merge', 'follow-up'])
  // Explicitly deleting the merge still removes its downstream branch.
  assert.deepEqual(captureDeletion(source, 'merge').nodes.map(n => n.id), ['merge', 'follow-up'])
})

test('deleting a common root removes merges when all their sources are deleted', () => {
  const source = {
    nodes: [prompt('root'), prompt('a'), prompt('b'), prompt('merge', { mergeContext: 'histories' })],
    edges: [edge('root', 'a'), edge('root', 'b'), edge('a', 'merge'), edge('b', 'merge')],
  }
  assert.equal(captureDeletion(source, 'root').nodes.length, 4)
})

test('consecutive deletions of merge sources undo in reverse without dangling edges', () => {
  const source = { nodes: [prompt('a'), prompt('b'), prompt('merge', { mergeContext: 'histories' })], edges: [edge('a', 'merge'), edge('b', 'merge')] }
  const first = captureDeletion(source, 'a')
  let current = without(source, first)
  const second = captureDeletion(current, 'b')
  current = without(current, second)
  assert.equal(current.nodes.length, 0)
  current = restoreDeletion(restoreDeletion(current, second), first)
  assert.deepEqual(current.nodes.map(n => n.id).sort(), ['a', 'b', 'merge'])
  assert.deepEqual(current.edges.map(e => e.id).sort(), ['a-merge', 'b-merge'])
})

test('consecutive nested deletions restore in reverse order with all connections', () => {
  let current = graph()
  const history = []
  for (const id of ['child', 'answer', 'root']) {
    const deleted = captureDeletion(current, id)
    history.push(deleted)
    current = without(current, deleted)
  }
  while (history.length) current = restoreDeletion(current, history.pop())
  assert.deepEqual(current.nodes.map((node) => node.id).sort(), graph().nodes.map((node) => node.id).sort())
  assert.deepEqual(current.edges.map((edge) => edge.id).sort(), graph().edges.map((edge) => edge.id).sort())
})
