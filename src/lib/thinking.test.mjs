import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { effortProblem, promptEfforts, thinkingLabel } from './thinking.ts'
import { comparisonSnapshot, responseOffset } from './comparison.ts'
import { validateDocument, documentToCanvas, canvasToDocument, serializeDocument } from './learnDocument.ts'

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/branched.learn', import.meta.url), 'utf8'))
const model = { id: 'test/model', reasoning: true, thinkingLevels: ['off', 'low', 'high'], defaultThinking: 'low' }

test('each prompt defaults to one SDK-derived effort, preserves explicit choices, and rejects empty/unsupported choices', () => {
  assert.deepEqual(promptEfforts(undefined, model), ['low'])
  assert.deepEqual(promptEfforts(['high'], model), ['high'])
  assert.deepEqual(promptEfforts([], model), [])
  assert.match(effortProblem([], model), /at least one/)
  assert.match(effortProblem(['medium'], model), /Unavailable/)
  assert.match(effortProblem(['low', 'low'], model), /once/)
  assert.match(effortProblem(['low'], undefined), /No model/)
  assert.equal(effortProblem(['low', 'high'], model), null)
})

test('comparison snapshots pin the concrete model and shared context/notes, with no input mutation or sibling output', () => {
  const input = { model, efforts: ['high', 'low'], messages: [{ role: 'user', content: 'Question' }], globalNotes: 'Global', threadNotes: 'Thread' }
  const snapshot = comparisonSnapshot(input)
  input.efforts.splice(0)
  input.messages[0].content = 'Later edit'
  input.globalNotes = 'Edited notes'
  assert.deepEqual(snapshot, { model: 'test/model', efforts: ['low', 'high'], messages: [{ role: 'user', content: 'Question' }], globalNotes: 'Global', threadNotes: 'Thread' })
  assert.throws(() => comparisonSnapshot({ ...input, efforts: ['medium'] }), /Unavailable/)
})

test('new responses clear existing/resized siblings on every side without rearranging them', () => {
  const base = { x: 100, y: 200 }
  const siblings = [{ position: { ...base }, width: 900, height: 1400 }]
  assert.equal(responseOffset('right', base, []), 0)
  for (const side of ['top', 'bottom']) assert.equal(responseOffset(side, base, siblings), 940)
  for (const side of ['left', 'right']) assert.equal(responseOffset(side, base, siblings), 1440)
  assert.equal(responseOffset('corner', base, siblings), 520)
  assert.deepEqual(siblings[0].position, base)
})

test('labels distinguish legacy, unconfirmed, confirmed, unsupported and requested/effective differences', () => {
  assert.equal(thinkingLabel({}), 'Thinking: not recorded')
  assert.equal(thinkingLabel({ requestedThinking: 'high' }), 'Thinking: unconfirmed (requested high)')
  assert.equal(thinkingLabel({ thinking: 'high', requestedThinking: 'high' }), 'Thinking: high')
  assert.equal(thinkingLabel({ thinking: 'low', requestedThinking: 'high' }), 'Thinking: low (requested high)')
  assert.equal(thinkingLabel({ thinking: 'off' }), 'Thinking: off')
  assert.equal(thinkingLabel({ thinking: 'unsupported', requestedThinking: 'off' }), 'Thinking: not supported')
})

test('v2 and v3 upgrade only in memory; old efforts are unknown and their original field rules remain strict', () => {
  for (const version of [2, 3]) {
    const old = { ...fixture(), version }
    const before = JSON.stringify(old)
    const upgraded = validateDocument(old)
    assert.equal(upgraded.version, 4)
    assert.equal(JSON.stringify(old), before)
    assert.deepEqual(upgraded, { ...old, version: 4 })
    for (const record of upgraded.cards) {
      assert.equal(Object.hasOwn(record, 'thinking'), false)
      assert.equal(Object.hasOwn(record, 'thinkingEfforts'), false)
    }
    for (const field of ['thinking', 'requestedThinking']) {
      const illegal = structuredClone(old)
      illegal.cards.find(card => card.kind === 'response')[field] = 'high'
      assert.throws(() => validateDocument(illegal), /unknown field/)
    }
    const illegal = structuredClone(old)
    illegal.cards.find(card => card.kind === 'prompt').thinkingEfforts = ['low']
    assert.throws(() => validateDocument(illegal), /unknown field/)
  }
  const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-v3.learn', import.meta.url), 'utf8'))
  assert.equal(legacy.version, 3)
  assert.equal(validateDocument(legacy).version, 4)
})

test('v3 merges remain readable without relaxing the strict v2 forest boundary', () => {
  const document = fixture()
  const sources = document.cards.filter(card => card.kind === 'prompt' && !document.connections.some(edge => edge.target === card.id)).slice(0, 2)
  document.cards.push({ id: 'merge', kind: 'prompt', text: 'Merge', position: { x: 0, y: 0 }, collapsed: false, sent: false, mergeContext: 'histories' })
  document.connections.push(...sources.map((card, i) => ({ id: `m${i}`, source: card.id, target: 'merge', sourceHandle: 's', targetHandle: 't' })))
  document.version = 3
  assert.equal(validateDocument(document).cards.at(-1).mergeContext, 'histories')
  document.version = 2
  assert.throws(() => validateDocument(document), /unknown field/)
})

test('v4 selections and all response metadata survive canvas/save/export round trips, including stopped/error answers', () => {
  const document = fixture()
  document.cards.find(card => card.kind === 'prompt').thinkingEfforts = ['low', 'high']
  for (const [index, response] of document.cards.filter(card => card.kind === 'response').entries()) {
    response.requestedThinking = 'high'
    response.thinking = index === 2 ? 'unsupported' : 'low'
    response.status = ['done', 'error', 'stopped'][index]
  }
  const canvas = documentToCanvas(document)
  assert.deepEqual(canvasToDocument(canvas, document), document)
  assert.deepEqual(JSON.parse(serializeDocument(document)), document)
  canvas.nodes.find(node => node.type === 'prompt').data.thinkingEfforts.push('off')
  assert.deepEqual(document.cards.find(card => card.kind === 'prompt').thinkingEfforts, ['low', 'high'])
})

test('v4 rejects malformed metadata, wrong-kind fields, duplicates, null and unknown fields without coercion', () => {
  for (const value of [null, 42, '', 'ultra', undefined]) {
    for (const field of ['requestedThinking', 'thinking']) {
      const document = fixture()
      document.cards.find(card => card.kind === 'response')[field] = value
      assert.throws(() => validateDocument(document), /thinking level/)
    }
  }
  for (const value of [null, 'low', ['low', 'low'], ['ultra'], [undefined]]) {
    const document = fixture()
    document.cards.find(card => card.kind === 'prompt').thinkingEfforts = value
    assert.throws(() => validateDocument(document))
  }
  const wrongKind = fixture()
  wrongKind.cards.find(card => card.kind === 'prompt').thinking = 'high'
  assert.throws(() => validateDocument(wrongKind), /unknown field/)
  const emptyDraft = fixture()
  emptyDraft.cards.find(card => card.kind === 'prompt').thinkingEfforts = []
  assert.deepEqual(validateDocument(emptyDraft).cards.find(card => card.kind === 'prompt').thinkingEfforts, [])
})
