import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConversation } from './conversation.ts'

const prompt = (id, extra = {}) => ({ id, type: 'prompt', position: { x: 0, y: 0 }, data: { kind: 'prompt', text: id, sent: false, collapsed: false, ...extra } })
const response = (id, parent) => ({ id, type: 'response', position: { x: 0, y: 0 }, data: { kind: 'response', text: id, sourcePromptId: parent, model: 'test/model', status: 'done', collapsed: false } })
const edge = (source, target) => ({ id: `${source}-${target}`, source, target })
const context = messages => JSON.parse(messages[0].content.slice(messages[0].content.indexOf('{')))
const graph = (scope = 'histories') => ({
  nodes: [prompt('root'), response('a', 'root'), response('b', 'root'), prompt('unrelated'), response('c', 'unrelated'), prompt('merge', { mergeContext: scope }), response('combined', 'merge'), prompt('follow-up')],
  edges: [edge('root', 'a'), edge('root', 'b'), edge('unrelated', 'c'), edge('a', 'merge'), edge('b', 'merge'), edge('c', 'merge'), edge('merge', 'combined'), edge('combined', 'follow-up')],
})

test('ordinary chains preserve roles, quotes, and existing content without sibling leakage', () => {
  const g = graph()
  g.nodes.push(prompt('question', { quote: 'a passage', text: 'Explain' }))
  g.edges.push(edge('a', 'question'))
  assert.deepEqual(buildConversation(g.nodes, g.edges, 'question'), [
    { role: 'user', content: 'root' }, { role: 'assistant', content: 'a' },
    { role: 'user', content: 'Regarding this excerpt from the previous message:\n"a passage"\n\nExplain' },
  ])
})

test('history merges deduplicate shared ancestors, label independent paths, and keep instructions last', () => {
  const g = graph()
  const messages = buildConversation(g.nodes, g.edges, 'merge')
  assert.equal(messages.length, 2)
  assert.deepEqual(messages[1], { role: 'user', content: 'merge' })
  const material = context(messages)
  assert.deepEqual(material.sources, ['a', 'b', 'c'])
  assert.deepEqual(material.cards.map(c => c.id), ['root', 'a', 'b', 'unrelated', 'c'])
  assert.deepEqual(material.cards.find(c => c.id === 'b').parents, ['root'])
  assert.equal(material.cards.find(c => c.id === 'c').model, 'test/model')
  assert.equal(material.cards.find(c => c.id === 'c').status, 'done')
})

test('selected-only merges include only selected text; continuations do not resurrect excluded histories', () => {
  const g = graph('selected')
  let material = context(buildConversation(g.nodes, g.edges, 'merge'))
  assert.deepEqual(material.cards.map(c => c.id), ['a', 'b', 'c'])
  assert.ok(material.cards.every(c => c.parents.length === 0))
  material = context(buildConversation(g.nodes, g.edges, 'follow-up'))
  assert.deepEqual(material.cards.map(c => c.id), ['a', 'b', 'c', 'merge', 'combined'])
  assert.equal(material.cards.find(c => c.id === 'merge').mergeContext, 'selected')
})

test('nested history merges retain earlier selected-only boundaries', () => {
  const g = graph('selected')
  g.nodes.push(prompt('new-root'), prompt('nested', { mergeContext: 'histories' }))
  g.edges.push(edge('combined', 'nested'), edge('new-root', 'nested'))
  const material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.deepEqual(material.cards.map(c => c.id), ['a', 'b', 'c', 'merge', 'combined', 'new-root'])
})

test('a selected-only merge of an existing merge treats that source as literal text', () => {
  const g = graph()
  g.nodes.push(prompt('nested', { mergeContext: 'selected' }))
  g.edges.push(edge('merge', 'nested'), edge('c', 'nested'))
  const material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.deepEqual(material.cards.map(c => c.id), ['merge', 'c'])
  assert.ok(material.cards.every(c => c.parents.length === 0))
})

test('a card used both literally and with history still expands on the history path', () => {
  const g = graph('selected')
  g.nodes.push(prompt('nested', { mergeContext: 'histories' }))
  g.edges.push(edge('combined', 'nested'), edge('a', 'nested'))
  const material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.equal(material.cards.filter(c => c.id === 'a').length, 1)
  assert.ok(material.cards.some(c => c.id === 'root'))
  assert.ok(!material.cards.some(c => c.id === 'unrelated'))
})

test('mixed sources honor both override directions and exclude unrelated history through continuations', () => {
  for (const defaultScope of ['selected', 'histories']) {
    const g = graph(defaultScope)
    for (const e of g.edges.filter(e => e.target === 'merge')) e.data = { mergeContext: e.source === 'c' ? 'selected' : 'histories' }
    for (const target of ['merge', 'follow-up']) {
      const material = context(buildConversation(g.nodes, g.edges, target))
      assert.equal(material.cards.filter(c => c.id === 'root').length, 1)
      assert.ok(material.cards.some(c => c.id === 'a'))
      assert.ok(material.cards.some(c => c.id === 'b'))
      assert.ok(material.cards.some(c => c.id === 'c'))
      assert.ok(!material.cards.some(c => c.id === 'unrelated'))
    }
    const material = context(buildConversation(g.nodes, g.edges, 'merge'))
    assert.deepEqual(material.sourceContexts, [
      { source: 'a', context: 'histories' }, { source: 'b', context: 'histories' }, { source: 'c', context: 'selected' },
    ])
  }
})

test('nested mixed merges keep boundaries; literal merge sources expose no hidden source IDs', () => {
  const g = graph()
  g.edges.find(e => e.source === 'c' && e.target === 'merge').data = { mergeContext: 'selected' }
  g.nodes.push(prompt('nested', { mergeContext: 'histories' }), prompt('another'))
  g.edges.push(edge('combined', 'nested'), edge('another', 'nested'))
  let material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.ok(!material.cards.some(c => c.id === 'unrelated'))
  assert.equal(material.cards.find(c => c.id === 'merge').sourceContexts[2].context, 'selected')
  g.edges.find(e => e.source === 'combined' && e.target === 'nested').data = { mergeContext: 'selected' }
  material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.deepEqual(material.cards.map(c => c.id), ['combined', 'another'])
  g.edges.find(e => e.source === 'combined' && e.target === 'nested').source = 'merge'
  material = context(buildConversation(g.nodes, g.edges, 'nested'))
  assert.deepEqual(material.cards.map(c => c.id), ['merge', 'another'])
  assert.equal(material.cards[0].sourceContexts, undefined)
})

test('mixed literal and expanded paths deduplicate a shared source regardless of visit order', () => {
  for (const reverse of [false, true]) {
    const g = graph('selected')
    g.nodes.push(prompt('nested', { mergeContext: 'selected' }))
    const incoming = [edge('combined', 'nested'), { ...edge('a', 'nested'), data: { mergeContext: 'histories' } }]
    g.edges.push(...(reverse ? incoming.reverse() : incoming))
    const material = context(buildConversation(g.nodes, g.edges, 'nested'))
    assert.equal(material.cards.filter(c => c.id === 'a').length, 1)
    assert.equal(material.cards.filter(c => c.id === 'root').length, 1)
    assert.ok(!material.cards.some(c => c.id === 'unrelated'))
  }
})

test('selecting an ancestor and descendant does not duplicate overlapping context', () => {
  const g = graph()
  g.edges.push(edge('root', 'merge'))
  const cards = context(buildConversation(g.nodes, g.edges, 'merge')).cards
  assert.equal(cards.filter(c => c.id === 'root').length, 1)
})

test('long histories have no silent 1000-card cutoff and invalid cycles fail explicitly', () => {
  const nodes = Array.from({ length: 5000 }, (_, i) => prompt(String(i)))
  const edges = nodes.slice(1).map((n, i) => edge(String(i), n.id))
  assert.equal(buildConversation(nodes, edges, '4999').length, 5000)
  edges.push(edge('4999', '0'))
  assert.throws(() => buildConversation(nodes, edges, '4999'), /cycle/)
  assert.deepEqual(buildConversation(nodes, edges, 'missing'), [])
})
