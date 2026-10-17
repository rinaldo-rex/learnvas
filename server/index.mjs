// Learnvas bridge — a tiny local server between the browser canvas and pi.
//
//   GET  /api/models     -> available models, supported efforts, resolved default
//   GET  /api/extensions -> read-only loader inventory and tutor configuration
//   POST /api/chat    -> SSE stream of text deltas for one tutoring exchange
//   /api/threads, /api/trash -> revision-checked managed .learn library
// All routes require trusted local browser headers; see docs/thread-library.md.
//
// Each chat request creates a fresh in-memory pi AgentSession with:
//   - a tutor system prompt (no coding-agent prompt, no AGENTS.md leakage)
//   - only allowlisted web tools, when web access is enabled
//   - the caller's requested model (or pi's default)
import { createBridgeServer, json, trustedOrigins } from './http.mjs'
import { ThreadLibrary } from './library.mjs'
import { TutorNotesStore } from './tutorNotes.mjs'
import { createTutorHandler, tutorSettings } from './tutor.mjs'
import { emptyExtensionReport, extensionLoadReport } from './extensions.mjs'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'

const PORT = Number(process.env.BRIDGE_PORT || 5178)
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Invalid BRIDGE_PORT')
const ORIGINS = trustedOrigins(PORT, process.env.LEARNVAS_TRUSTED_ORIGINS)
const library = new ThreadLibrary({ directory: process.env.LEARNVAS_LIBRARY_DIR || undefined })
const tutorNotes = new TutorNotesStore({ directory: process.env.LEARNVAS_LIBRARY_DIR || undefined })

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

const tutorHandler = createTutorHandler({ modelRuntime, makeSession, tutorNotes, ready: () => warmupPromise, webAccess: WEB_ACCESS })

async function makeSession(modelRef, { loadExtensions = false, webAccess = false, notes = '', thinkingLevel } = {}) {
  const settingsManager = tutorSettings(SettingsManager.create(process.cwd(), getAgentDir()))
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    settingsManager,
    // Pure tutor: our prompt only — no AGENTS.md project context, no skills,
    // prompt templates, or themes. Extensions are only loaded once at startup
    // (see warmup below) so extension-registered providers/virtual models
    // (pi.registerProvider / pi.registerVirtualModel) land in the shared
    // ModelRuntime; per-request chat sessions skip them.
    systemPrompt: webAccess ? TUTOR_SYSTEM_WEB : TUTOR_SYSTEM,
    // Freeze the explicit note snapshot, even when empty; never discover a
    // separate APPEND_SYSTEM.md between sibling comparison requests.
    appendSystemPrompt: notes ? [notes] : [],
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
    const resolvedModel = modelRef ? modelRuntime.getModel(modelRef.provider, modelRef.id) : undefined
    if (modelRef && !resolvedModel) throw new Error(`Model is no longer available: ${modelRef.provider}/${modelRef.id}`)
    const { session } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      // Web sessions activate just the pi-web-access tools; everything else
      // (file tools, bash, …) stays off. Otherwise: fully toolless.
      ...(webAccess ? { tools: WEB_TOOLS } : { noTools: 'all' }),
      modelRuntime,
      settingsManager,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      ...(resolvedModel ? { model: resolvedModel } : {}),
    })
    return session
  } catch (e) {
    recordExtensions(String(e?.message ?? e))
    throw e
  }
}

async function handleTutorRequest(req, res, url) {
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

  return tutorHandler(req, res, url)
}
const server = createBridgeServer({ library, tutorNotes, port: PORT, origins: ORIGINS, fallback: handleTutorRequest })

/**
 * Startup warmup: create and dispose one extension-loading session so that
 * providers/models registered by the user's pi extensions (commandcode,
 * clinepass, …) are registered into the shared ModelRuntime. Registrations
 * survive session disposal. Tutor/model/inventory handlers await this promise, so no
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[learnvas bridge] listening on http://localhost:${PORT}`)
})
startWarmup()
