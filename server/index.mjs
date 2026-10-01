// Learnvas bridge — a tiny local server between the browser canvas and pi.
//
//   GET  /api/models  -> models pi has credentials for (the /model list)
//   POST /api/chat    -> SSE stream of text deltas for one tutoring exchange
//
// Each chat request creates a fresh in-memory pi AgentSession with:
//   - a tutor system prompt (no coding-agent prompt, no AGENTS.md leakage)
//   - no tools (pure text chat)
//   - the caller's requested model (or pi's default)
import http from 'node:http'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'

const PORT = Number(process.env.BRIDGE_PORT || 5178)

const TUTOR_SYSTEM = `You are the tutor inside Learnvas, a learning canvas where every question and answer lives as a card that the student can branch from.
Teach clearly: short paragraphs, bold the key terms when you introduce them, use concrete analogies, and define jargon the first time it appears.
When the student quotes an excerpt from an earlier answer, address that excerpt directly and go deeper on it.
Assume curiosity, not expertise. Prefer understanding over completeness, and it is fine to end with one inviting follow-up question.
You are a text-only tutor: never mention tools, files, code, or execution.`

const modelRuntime = await ModelRuntime.create()

function parseModelId(id) {
  if (!id || id === 'default') return null
  const i = id.indexOf('/')
  return i > 0 ? { provider: id.slice(0, i), id: id.slice(i + 1) } : null
}

async function makeSession(modelRef) {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    // Pure tutor: our prompt only — no AGENTS.md project context, no extensions,
    // skills, prompt templates, or themes from the user's pi config.
    systemPrompt: TUTOR_SYSTEM,
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  await loader.reload()
  const { session } = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    noTools: true,
    modelRuntime,
    ...(modelRef ? { model: modelRuntime.getModel(modelRef.provider, modelRef.id) } : {}),
  })
  return session
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

/** Pull a human-readable line out of provider error payloads. */
function humanizeError(raw) {
  const s = String(raw ?? '')
  const body = s.replace(/^\d{3}\s*/, '') // strip leading status code like "400 "
  try {
    const parsed = JSON.parse(body)
    const msg = parsed?.error?.message ?? parsed?.message ?? parsed?.error
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 400)
  } catch {
    /* not json — fall through */
  }
  return s.slice(0, 400)
}

function sse(res, event, data) {
  res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/api/models') {
    modelRuntime
      .getAvailable()
      .then((available) => {
        json(res, 200, {
          models: available.map((m) => ({
            id: `${m.provider}/${m.id}`,
            provider: m.provider,
            modelId: m.id,
            name: m.name || m.id,
          })),
        })
      })
      .catch((e) => json(res, 200, { models: [], error: String(e?.message ?? e) }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      let payload
      try {
        payload = JSON.parse(body)
      } catch {
        json(res, 400, { error: 'bad json' })
        return
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      if (messages.length === 0) {
        json(res, 400, { error: 'messages required' })
        return
      }

      // Fold prior turns into one composed prompt (fresh in-memory session per request).
      const transcript = messages
        .slice(0, -1)
        .map((m) => (m.role === 'user' ? '**Student:** ' : '**Assistant:** ') + m.content)
        .join('\n\n---\n\n')
      const question = messages[messages.length - 1]?.content ?? ''
      const composed = transcript
        ? `## Conversation so far\n\n${transcript}\n\n## The student now asks\n\n${question}`
        : question

      let session = null
      try {
        session = await makeSession(parseModelId(payload.model))
      } catch (e) {
        json(res, 500, { error: String(e?.message ?? e) })
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })

      let closed = false
      req.on('close', () => {
        closed = true
        try {
          session?.abort()
        } catch {}
      })

      try {
        let errorMessage = null
        const unsub = session.subscribe((ev) => {
          if (ev.type === 'message_update' && ev.assistantMessageEvent?.type === 'text_delta' && !closed) {
            sse(res, 'delta', { text: ev.assistantMessageEvent.delta })
          } else if (
            ev.type === 'message_end' &&
            ev.message?.role === 'assistant' &&
            ev.message.stopReason === 'error'
          ) {
            errorMessage = humanizeError(ev.message.errorMessage ?? 'model error')
          }
        })
        await session.prompt(composed)
        unsub()
        if (!closed) {
          if (errorMessage) sse(res, 'error', { message: errorMessage })
          else sse(res, 'done', {})
        }
        res.end()
      } catch (e) {
        if (!closed) sse(res, 'error', { message: String(e?.message ?? e) })
        res.end()
      } finally {
        try {
          session?.dispose()
        } catch {}
      }
    })
    return
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`[learnvas bridge] listening on http://localhost:${PORT}`)
})
