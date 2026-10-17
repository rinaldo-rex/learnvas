import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fetchModels, streamChat } from './api.ts'

const encode = value => new TextEncoder().encode(value)
const frame = value => `data: ${JSON.stringify(value)}\n\n`
async function run(t, chunks, options = {}) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    calls.push(JSON.parse(request.body))
    return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encode(chunk)); controller.close() } }))
  })
  const events = []
  await new Promise(resolve => streamChat({
    model: 'test/model', thinking: 'low', globalNotes: 'Snapshot global', threadNotes: 'Snapshot thread', messages: [{ role: 'user', content: 'Question' }], signal: new AbortController().signal,
    ...options,
    onMetadata: metadata => events.push(['metadata', metadata]),
    onDelta: text => events.push(['delta', text]),
    onDone: () => { events.push(['done']); resolve() },
    onError: message => { events.push(['error', message]); resolve() },
  }))
  await delay(0)
  return { calls, events }
}

test('streaming API carries the snapshot/effort and accepts chunked metadata before text', async t => {
  const text = frame({ event: 'metadata', model: 'test/model', thinking: 'high' }) + frame({ event: 'delta', text: 'answer' }) + frame({ event: 'done' })
  const { calls, events } = await run(t, [text.slice(0, 17), text.slice(17, 82), text.slice(82)])
  assert.equal(calls[0].thinking, 'low')
  assert.equal(calls[0].globalNotes, 'Snapshot global')
  assert.equal(calls[0].tutorNotes, 'Snapshot thread')
  assert.deepEqual(events.map(event => event[0]), ['metadata', 'delta', 'done'])
  assert.equal(events[0][1].thinking, 'high')
})

test('a provider error is terminal and does not produce a second completion callback', async t => {
  const { events } = await run(t, [frame({ event: 'error', message: 'Rate limited' }) + frame({ event: 'done' })])
  assert.deepEqual(events, [['error', 'Rate limited']])
})

test('an unexpectedly truncated stream preserves chunks and reports an error, never false success', async t => {
  const { events } = await run(t, [frame({ event: 'delta', text: 'partial answer' })])
  assert.equal(events[0][1], 'partial answer')
  assert.equal(events.at(-1)[0], 'error')
  assert.match(events.at(-1)[1], /before completion/)
})

test('malformed metadata does not fabricate a recorded effort', async t => {
  const { events } = await run(t, [frame({ event: 'metadata', model: 'test/model', thinking: 'ultra' })])
  assert.deepEqual(events, [['error', 'Invalid generation metadata']])
})

test('aborts are silent, without automatic retries or terminal callbacks', async t => {
  const abort = new AbortController()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; abort.abort(); throw new DOMException('Aborted', 'AbortError') })
  const events = []
  streamChat({ model: 'test/model', messages: [], signal: abort.signal, onDelta: text => events.push(text), onDone: () => events.push('done'), onError: error => events.push(error) })
  await delay(10)
  assert.deepEqual(events, [])
  assert.equal(calls, 1)
})

test('inventory rejects a stale bridge contract rather than crashing effort controls', async t => {
  let call = 0
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: call++ ? [{ id: 'test/model', name: 'Old bridge' }] : [] }))
  await assert.rejects(fetchModels(), /Restart the bridge/)
  await assert.rejects(fetchModels(), /Restart the bridge/)
})
