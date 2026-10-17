import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { describeModel, sessionMetadata, tutorSettings } from './tutor.mjs'

test('installed SDK supports the bridge capability/effort contract in an isolated no-prompt, no-tools session', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'learnvas-tutor-sdk-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(directory, 'auth.json'), modelsPath: null,
    modelsStorePath: path.join(directory, 'models.json'), allowModelNetwork: false, refreshOnCreate: false,
  })
  const settingsManager = tutorSettings(SettingsManager.inMemory({ defaultThinkingLevel: 'low' }))
  const model = modelRuntime.getModels().find(model => model.reasoning && describeModel(model, settingsManager).thinkingLevels.includes('low'))
  assert.ok(model, 'Bundled catalog must supply a reasoning model without credentials/network discovery')
  await writeFile(path.join(directory, 'APPEND_SYSTEM.md'), 'DO_NOT_LOAD_TUTOR_CONTEXT')
  await writeFile(path.join(directory, 'AGENTS.md'), 'DO_NOT_LOAD_TUTOR_CONTEXT')
  const loader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager,
    systemPrompt: 'An isolated test tutor.', appendSystemPrompt: [],
    noContextFiles: true, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, modelRuntime, model, thinkingLevel: 'low', settingsManager,
    sessionManager: SessionManager.inMemory(), resourceLoader: loader, noTools: 'all',
  })
  try {
    assert.deepEqual(session.getActiveToolNames(), [])
    assert.equal(session.thinkingLevel, 'low')
    assert.equal(session.systemPrompt.includes('DO_NOT_LOAD_TUTOR_CONTEXT'), false)
    assert.deepEqual(session.getAvailableThinkingLevels(), describeModel(model, settingsManager).thinkingLevels)
    assert.deepEqual(sessionMetadata(session), { model: `${model.provider}/${model.id}`, thinking: 'low' })
    assert.equal(session.settingsManager.getCacheWarmingMode(), 'off')
    assert.equal(session.settingsManager.getRetryEnabled(), false)
    assert.equal(session.messages.length, 0) // Never call prompt; never contact a provider.
  } finally { session.dispose() }
})
