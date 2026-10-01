// Learnvas bridge — a tiny local server between the browser canvas and pi.
//
//   GET  /api/models     -> models pi has credentials for (the /model list)
//   GET  /api/extensions -> read-only loader inventory and tutor configuration
//   POST /api/chat    -> SSE stream of text deltas for one tutoring exchange
//
// Each chat request creates a fresh in-memory pi AgentSession with:
//   - a tutor system prompt (no coding-agent prompt, no AGENTS.md leakage)
//   - only allowlisted web tools, when web access is enabled
//   - the caller's requested model (or pi's default)
import http from 'node:http'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'
import { emptyExtensionReport, extensionLoadReport } from './extensions.mjs'

const PORT = Number(process.env.BRIDGE_PORT || 5178)

const TUTOR_SYSTEM = `You are the tutor inside Learnvas, a learning canvas where every question and answer lives as a card that the student can branch from.
Teach clearly: short paragraphs, bold the key terms when you introduce them, use concrete analogies, and define jargon the first time it appears.
When the student quotes an excerpt from an earlier answer, address that excerpt directly and go deeper on it.
Assume curiosity, not expertise. Prefer understanding over completeness, and it is fine to end with one inviting follow-up question.
You are a text-only tutor: never mention tools, files, code, or execution.`

const TUTOR_SYSTEM_WEB = `${TUTOR_SYSTEM}
You also have web access (web_search, fetch_content, and friends). Use it when the question needs current information, precise facts you are not fully sure of, or sources the student can read for themselves — prefer searching over guessing. When you use the web, name your sources with links in the answer.`

// Escape hatch: LEARNVAS_WEB_ACCESS=0 disables web tools for chat sessions.
const WEB_ACCESS = process.env.LEARNVAS_WEB_ACCESS !== '0'
const WEB_TOOLS = ['web_search', 'source_check', 'fetch_content', 'get_search_content']
const WEB_EXTENSION = 'npm:pi-web-access'

// Snapshots of existing loads, not a second discovery pass. Reading the
// inventory never executes additional extension code or changes settings.
let startupExtensions = emptyExtensionReport()
let tutorExtensions = null

const modelRuntime = await ModelRuntime.create()

function parseModelId(id) {
  if (!id || id === 'default') return null
  const i = id.indexOf('/')
  return i > 0 ? { provider: id.slice(0, i), id: id.slice(i + 1) } : null
}

async function makeSession(modelRef, { loadExtensions = false, webAccess = false } = {}) {
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    // Pure tutor: our prompt only — no AGENTS.md project context, no skills,
    // prompt templates, or themes. Extensions are only loaded once at startup
    // (see warmup below) so extension-registered providers/virtual models
    // (pi.registerProvider / pi.registerVirtualModel) land in the shared
    // ModelRuntime; per-request chat sessions skip them.
    systemPrompt: webAccess ? TUTOR_SYSTEM_WEB : TUTOR_SYSTEM,
    noContextFiles: true,
    noExtensions: !loadExtensions,
    // Web sessions load ONLY the pi-web-access extension — its tools come
    // with it; no other user extension, skill, or context file is touched.
    ...(webAccess ? { additionalExtensionPaths: [WEB_EXTENSION] } : {}),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  const recordExtensions = (error = null) => {
    const report = extensionLoadReport(loader.getExtensions(), error)
    if (loadExtensions) startupExtensions = report
    else if (webAccess) tutorExtensions = report
  }
  try {
    await loader.reload()
    recordExtensions()
    const { session } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      // Web sessions activate just the pi-web-access tools; everything else
      // (file tools, bash, …) stays off. Otherwise: fully toolless.
      ...(webAccess ? { tools: WEB_TOOLS } : { noTools: true }),
      modelRuntime,
      ...(modelRef ? { model: modelRuntime.getModel(modelRef.provider, modelRef.id) } : {}),
    })
    return session
  } catch (e) {
    recordExtensions(String(e?.message ?? e))
    throw e
  }
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
    void warmupPromise
      .then(() => modelRuntime.getAvailable())
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

  if (req.method === 'GET' && url.pathname === '/api/extensions') {
    void warmupPromise.then(() => {
      json(res, 200, {
        startup: startupExtensions,
        tutor: {
          enabled: WEB_ACCESS,
          source: WEB_EXTENSION,
          tools: WEB_ACCESS ? WEB_TOOLS : [],
          lastLoad: tutorExtensions,
        },
      })
    }).catch((e) => json(res, 500, { error: String(e?.message ?? e) }))
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

      // Wait for extension registration before resolving models.
      await warmupPromise
      const modelRef = parseModelId(payload.model)
      if (modelRef && !modelRuntime.getModel(modelRef.provider, modelRef.id)) {
        json(res, 400, { error: `Unknown model: ${payload.model}` })
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
        session = await makeSession(modelRef, { webAccess: WEB_ACCESS })
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
          } else if (ev.type === 'tool_execution_start' && !closed) {
            sse(res, 'tool', { name: ev.toolName ?? 'tool', phase: 'start' })
          } else if (ev.type === 'tool_execution_end' && !closed) {
            sse(res, 'tool', { name: ev.toolName ?? 'tool', phase: 'end' })
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

/**
 * Startup warmup: create and dispose one extension-loading session so that
 * providers/models registered by the user's pi extensions (commandcode,
 * clinepass, …) are registered into the shared ModelRuntime. Registrations
 * survive session disposal. Every API handler awaits this promise, so no
 * request can observe the pre-registration model list.
 */
let warmupPromise = Promise.resolve()
function startWarmup() {
  warmupPromise = (async () => {
    try {
      const session = await makeSession(null, { loadExtensions: true })
      session.dispose()
      const n = (await modelRuntime.getAvailable().catch(() => [])).length
      console.log(`[learnvas bridge] extension warmup ok — ${n} models available`)
    } catch (e) {
      console.error('[learnvas bridge] extension warmup failed:', e?.message ?? e)
    }
  })()
  return warmupPromise
}

server.listen(PORT, () => {
  console.log(`[learnvas bridge] listening on http://localhost:${PORT}`)
})
startWarmup()
