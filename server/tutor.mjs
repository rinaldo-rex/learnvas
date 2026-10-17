import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai/compat'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { json, readJson } from './http.mjs'
import { MAX_NOTES_CHARS, tutorNotesPrompt } from './tutorNotes.mjs'
import { isThinkingLevel } from '../src/lib/thinking.ts'

export function tutorSettings(settings) {
  // Clone into memory: even SDK/extension setters cannot change shared Pi
  // defaults. Cache warming reads global settings, so applyOverrides alone
  // cannot disable it. Avoid hidden retry/compaction/warming model calls.
  const current = settings.getSettings()
  return SettingsManager.inMemory({
    ...current,
    retry: { ...current.retry, enabled: false, maxRetries: 0, provider: { ...current.retry?.provider, maxRetries: 0 } },
    compaction: { ...current.compaction, enabled: false }, cacheWarming: 'off',
  })
}

export function describeModel(model, settings) {
  return {
    id: `${model.provider}/${model.id}`, provider: model.provider, modelId: model.id, name: model.name || model.id,
    reasoning: !!model.reasoning, thinkingLevels: getSupportedThinkingLevels(model),
    defaultThinking: clampThinkingLevel(model, settings.getModelThinkingLevel(model.provider, model.id) ?? settings.getDefaultThinkingLevel() ?? 'medium'),
  }
}

export function sessionMetadata(session) {
  const model = session.model
  if (!model) throw new Error('No model is available')
  // These describe the SDK session, not measured internal compute. A provider
  // or virtual router may further map the effort; do not invent that value.
  return {
    model: `${model.provider}/${model.id}`,
    ...(!session.supportsThinking() ? { thinking: 'unsupported' } :
      isThinkingLevel(session.thinkingLevel) ? { thinking: session.thinkingLevel } : {}),
  }
}

export function humanizeError(raw) {
  const text = String(raw ?? '')
  try {
    const body = JSON.parse(text.replace(/^\d{3}\s*/, ''))
    const message = body?.error?.message ?? body?.message ?? body?.error
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 400)
  } catch { /* Plain provider errors remain readable. */ }
  return text.slice(0, 400)
}
const sse = (res, event, data = {}) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`)

/** Injectable session factory keeps capability/stream tests independent of live
 * providers. Each /chat remains its own cancellable HTTP stream. */
export function createTutorHandler({ modelRuntime, makeSession, tutorNotes, ready = () => Promise.resolve(), webAccess = false }) {
  return async (req, res, url) => {
    if (req.method === 'GET' && url.pathname === '/api/models') {
      await ready()
      let probe
      try {
        probe = await makeSession(null)
        const available = await modelRuntime.getAvailable()
        json(res, 200, {
          models: available.map(model => describeModel(model, probe.settingsManager)),
          defaultModel: probe.model ? `${probe.model.provider}/${probe.model.id}` : null,
        })
      } catch (error) { json(res, 503, { models: [], defaultModel: null, error: humanizeError(error.message) }) }
      finally { probe?.dispose() }
      return
    }
    if (req.method !== 'POST' || url.pathname !== '/api/chat') return json(res, 404, { error: 'not found' })
    const payload = await readJson(req)
    const messages = payload?.messages
    if (!Array.isArray(messages) || !messages.length || messages.some(message =>
      !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
      return json(res, 400, { error: 'Valid messages are required' })
    }
    if (payload.thinking !== undefined && !isThinkingLevel(payload.thinking)) return json(res, 400, { error: 'Invalid thinking effort' })
    for (const key of ['tutorNotes', 'globalNotes']) {
      if (payload[key] !== undefined && (typeof payload[key] !== 'string' || payload[key].length > MAX_NOTES_CHARS)) {
        return json(res, 400, { error: `${key} must be a string of at most ${MAX_NOTES_CHARS} characters` })
      }
    }
    if (payload.model !== undefined && typeof payload.model !== 'string') return json(res, 400, { error: 'Invalid model' })
    await ready()
    let modelRef = null
    if (payload.model && payload.model !== 'default') {
      if (typeof payload.model !== 'string' || payload.model.indexOf('/') < 1) return json(res, 400, { error: 'Invalid model' })
      const split = payload.model.indexOf('/')
      modelRef = { provider: payload.model.slice(0, split), id: payload.model.slice(split + 1) }
      const model = modelRuntime.getModel(modelRef.provider, modelRef.id)
      if (!model) return json(res, 400, { error: `Unknown model: ${payload.model}` })
      if (payload.thinking !== undefined && !getSupportedThinkingLevels(model).includes(payload.thinking)) {
        return json(res, 400, { error: `Thinking effort ${payload.thinking} is not supported by ${payload.model}` })
      }
    }
    let session, unsubscribe
    let closed = res.destroyed
    const disconnect = () => { closed = true; void session?.abort().catch(() => {}) }
    res.on('close', disconnect)
    try {
      // New clients snapshot both note layers once on Ask. Legacy single-chat
      // callers may omit globalNotes and retain server-backed notes behavior.
      const globalNotes = payload.globalNotes ?? (await tutorNotes.read()).global
      const transcript = messages.slice(0, -1).map(message =>
        (message.role === 'user' ? '**Student:** ' : '**Assistant:** ') + message.content).join('\n\n---\n\n')
      const question = messages.at(-1).content
      const composed = transcript ? `## Conversation so far\n\n${transcript}\n\n## The student now asks\n\n${question}` : question
      if (closed) return
      session = await makeSession(modelRef, { webAccess, notes: tutorNotesPrompt(globalNotes, payload.tutorNotes ?? ''), thinkingLevel: payload.thinking })
      if (closed) return
      // Validate pi-default requests after resolution as well; never silently
      // clamp an unsupported requested choice and spend a model request.
      if (payload.thinking !== undefined && !session.getAvailableThinkingLevels().includes(payload.thinking)) {
        return json(res, 400, { error: `Thinking effort ${payload.thinking} is not supported by the resolved model` })
      }
      const metadata = sessionMetadata(session)
      if (modelRef && metadata.model !== payload.model) return json(res, 409, { error: 'The SDK resolved a different model. Refresh model settings before asking again.' })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      sse(res, 'metadata', metadata)
      let errorMessage = null
      unsubscribe = session.subscribe(event => {
        if (closed) return
        if (event.type === 'thinking_level_changed' || (event.type === 'message_start' && event.message?.role === 'assistant')) sse(res, 'metadata', sessionMetadata(session))
        else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') sse(res, 'delta', { text: event.assistantMessageEvent.delta })
        else if (event.type === 'tool_execution_start') sse(res, 'tool', { name: event.toolName ?? 'tool', phase: 'start' })
        else if (event.type === 'tool_execution_end') sse(res, 'tool', { name: event.toolName ?? 'tool', phase: 'end' })
        else if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.stopReason === 'error') errorMessage = humanizeError(event.message.errorMessage ?? 'model error')
      })
      await session.prompt(composed)
      if (!closed) { sse(res, errorMessage ? 'error' : 'done', errorMessage ? { message: errorMessage } : {}); res.end() }
    } catch (error) {
      if (!closed) {
        if (res.headersSent) { sse(res, 'error', { message: humanizeError(error.message) }); res.end() }
        else json(res, 500, { error: humanizeError(error.message) })
      }
    } finally {
      unsubscribe?.()
      session?.dispose()
      res.off('close', disconnect)
    }
  }
}
