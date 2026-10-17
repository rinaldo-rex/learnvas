import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { createBridgeServer, trustedOrigins } from './http.mjs'
import { createTutorHandler, describeModel, sessionMetadata, tutorSettings } from './tutor.mjs'

const model = { provider: 'test', id: 'reasoner', name: 'Reasoner', reasoning: true, thinkingLevelMap: { minimal: null, medium: null } }
const plain = { provider: 'test', id: 'plain', reasoning: false }
const settings = () => SettingsManager.inMemory({ defaultThinkingLevel: 'low', modelThinkingLevels: { 'test/reasoner': 'high' } })
const until = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(10) }; assert.fail('Timed out') }

async function setup(t, { hold = false, effective, resolved, fail = false, waitFactory } = {}) {
  const sessions = []
  let notesReads = 0
  const runtime = { getAvailable: async () => [model, plain], getModel: (provider, id) => provider === 'test' ? [model, plain].find(model => model.id === id) : undefined }
  const handler = createTutorHandler({
    modelRuntime: runtime, tutorNotes: { read: async () => { notesReads++; return { global: 'Stored global note' } } },
    makeSession: async (ref, options = {}) => {
      if (waitFactory && ref) await waitFactory
      const current = resolved ?? (ref ? runtime.getModel(ref.provider, ref.id) : model)
      let subscriber, settle
      const session = {
        model: current, thinkingLevel: effective ?? options.thinkingLevel ?? 'high', settingsManager: settings(), options,
        prompts: [], disposed: 0, unsubscribed: 0, aborted: 0,
        supportsThinking: () => current.reasoning,
        getAvailableThinkingLevels: () => describeModel(current, settings()).thinkingLevels,
        subscribe(callback) { subscriber = callback; return () => { this.unsubscribed++; subscriber = null } },
        emit(event) { subscriber?.(event) },
        async prompt(text) {
          this.prompts.push(text)
          this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: `${options.thinkingLevel ?? 'default'} answer` } })
          if (fail) this.emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '429 {"error":{"message":"Rate limited"}}' } })
          if (hold) await new Promise(resolve => { settle = resolve })
        },
        finish() { settle?.() },
        async abort() { this.aborted++; settle?.() },
        dispose() { this.disposed++ },
      }
      sessions.push(session)
      return session
    },
  })
  const origins = trustedOrigins()
  const server = createBridgeServer({ library: {}, origins, fallback: handler })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  origins.add(origin)
  t.after(async () => { for (const session of sessions) session.finish(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const request = (body, signal) => fetch(`${origin}/api/chat`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  return { sessions, origin, request, notesReads: () => notesReads }
}
const payload = (thinking = 'low') => ({ model: 'test/reasoner', thinking, messages: [{ role: 'user', content: 'Explain retrieval' }], globalNotes: 'Snapshot global', tutorNotes: 'Snapshot thread' })
const events = text => text.trim().split('\n\n').map(line => JSON.parse(line.slice(6)))

test('model capabilities honor SDK mappings and per-model defaults, without guessing extended levels', () => {
  assert.deepEqual(describeModel(model, settings()).thinkingLevels, ['off', 'low', 'high'])
  assert.equal(describeModel(model, settings()).defaultThinking, 'high')
  assert.deepEqual(describeModel(plain, settings()).thinkingLevels, ['off'])
  assert.equal(describeModel(plain, settings()).defaultThinking, 'off')
})

test('tutor settings are memory-only, preserve budgets, and disable both retry layers, compaction and cache warming', () => {
  const shared = SettingsManager.inMemory({ defaultThinkingLevel: 'high', cacheWarming: 'idle', retry: { enabled: true, provider: { maxRetries: 3 } }, thinkingBudgets: { high: 9000 } })
  const before = shared.getSettings()
  const tutor = tutorSettings(shared)
  assert.notEqual(tutor, shared)
  assert.equal(tutor.getRetryEnabled(), false)
  assert.equal(tutor.getProviderRetrySettings().maxRetries, 0)
  assert.equal(tutor.getCacheWarmingMode(), 'off')
  assert.equal(tutor.getCompactionSettings().enabled, false)
  assert.deepEqual(tutor.getThinkingBudgets(), { high: 9000 })
  tutor.setDefaultThinkingLevel('low')
  assert.deepEqual(shared.getSettings(), before)
})

test('inventory reports a concrete default model and disposes its no-generation probe', async t => {
  const h = await setup(t)
  const result = await fetch(h.origin + '/api/models', { headers: { origin: h.origin } }).then(r => r.json())
  assert.equal(result.defaultModel, 'test/reasoner')
  assert.deepEqual(result.models[0].thinkingLevels, ['off', 'low', 'high'])
  assert.equal(h.sessions[0].prompts.length, 0)
  assert.equal(h.sessions[0].disposed, 1)
})

test('metadata precedes text, reports actual session effort, and never presents the request as confirmation', async t => {
  const h = await setup(t, { effective: 'high' })
  const response = await h.request(payload('low'))
  const output = events(await response.text())
  assert.deepEqual(output[0], { event: 'metadata', model: 'test/reasoner', thinking: 'high' })
  assert.equal(output[1].event, 'delta')
  assert.equal(output.at(-1).event, 'done')
  assert.equal(h.sessions[0].options.thinkingLevel, 'low')
  assert.equal(h.sessions[0].disposed, 1)
  assert.equal(h.sessions[0].unsubscribed, 1)
})

test('an unexpected SDK model fallback is rejected before generation, preserving the pinned comparison model', async t => {
  const h = await setup(t, { resolved: { ...model, id: 'different-model' } })
  const response = await h.request(payload())
  assert.equal(response.status, 409)
  assert.equal(h.sessions[0].prompts.length, 0)
  assert.equal(h.sessions[0].disposed, 1)
})

test('unsupported models and unverifiable efforts report truthfully, rather than inventing a thinking level', async t => {
  const h = await setup(t)
  const response = await h.request({ ...payload('off'), model: 'test/plain' })
  assert.equal(events(await response.text())[0].thinking, 'unsupported')
  assert.deepEqual(sessionMetadata({ model, supportsThinking: () => true, thinkingLevel: undefined }), { model: 'test/reasoner' })
  assert.throws(() => sessionMetadata({}), /No model/)
})

test('invalid/unsupported efforts, models, messages and notes fail before generation', async t => {
  const h = await setup(t)
  for (const body of [
    { ...payload(), thinking: 'ultra' }, payload('medium'),
    { ...payload(), model: 'test/missing' }, { ...payload(), model: 42 },
    { ...payload(), messages: [] }, { ...payload(), messages: [{ role: 'system', content: 'bad' }] },
    { ...payload(), globalNotes: 'x'.repeat(4001) }, { ...payload(), tutorNotes: null },
  ]) {
    const response = await h.request(body)
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.equal(h.sessions.length, 0)
})

test('parallel streams share the supplied note/context snapshot and stop independently', async t => {
  const h = await setup(t, { hold: true })
  const lowAbort = new AbortController()
  const low = await h.request(payload('low'), lowAbort.signal)
  const high = await h.request(payload('high'))
  assert.equal(h.notesReads(), 0)
  assert.equal(h.sessions.length, 2)
  assert.equal(h.sessions[0].options.notes, h.sessions[1].options.notes)
  assert.equal(h.sessions[0].prompts[0], h.sessions[1].prompts[0])
  lowAbort.abort()
  await low.body.cancel().catch(() => {})
  await until(() => h.sessions[0].disposed === 1)
  assert.equal(h.sessions[0].aborted, 1)
  assert.equal(h.sessions[1].aborted, 0)
  h.sessions[1].finish()
  assert.equal(events(await high.text()).at(-1).event, 'done')
  assert.equal(h.sessions[1].disposed, 1)
})

test('errors have one terminal event, no implicit reattempt, and clean up subscriptions', async t => {
  const h = await setup(t, { fail: true })
  const output = events(await (await h.request(payload())).text())
  assert.deepEqual(output.at(-1), { event: 'error', message: 'Rate limited' })
  assert.equal(output.filter(event => event.event === 'done').length, 0)
  assert.equal(h.sessions.length, 1)
  assert.equal(h.sessions[0].prompts.length, 1)
  assert.equal(h.sessions[0].unsubscribed, 1)
})

test('disconnect during session creation disposes it without starting a paid generation', async t => {
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const h = await setup(t, { waitFactory: barrier })
  const abort = new AbortController()
  const request = h.request(payload(), abort.signal).catch(error => error)
  await delay(40)
  abort.abort()
  await request
  await delay(20)
  release()
  await until(() => h.sessions.length === 1 && h.sessions[0].disposed === 1)
  assert.equal(h.sessions[0].prompts.length, 0)
})

test('legacy single requests still read server notes and resolve pi default', async t => {
  const h = await setup(t)
  const body = { model: 'default', messages: payload().messages }
  const output = events(await (await h.request(body)).text())
  assert.equal(h.notesReads(), 1)
  assert.equal(output[0].model, 'test/reasoner')
  assert.ok(h.sessions[0].options.notes.includes('Stored global note'))
})
