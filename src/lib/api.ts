import type { ChatMsg } from '../types'
import { isGenerationMetadata, isThinkingLevel, type GenerationMetadata, type ThinkingLevel, type ThinkingModel } from './thinking.ts'

export interface ModelInfo extends ThinkingModel {
  id: string // "provider/model-id"
  provider: string
  modelId: string
  name: string
}

export interface ModelInventory { models: ModelInfo[]; defaultModel: string | null }
export async function fetchModels(): Promise<ModelInventory> {
  const res = await fetch('/api/models')
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? 'Models unavailable')
  if (!Array.isArray(json?.models) || (json.defaultModel !== null && typeof json.defaultModel !== 'string') || json.models.some((model: ModelInfo) =>
    !model || typeof model.id !== 'string' || typeof model.provider !== 'string' || typeof model.modelId !== 'string' || typeof model.name !== 'string' ||
    !Array.isArray(model.thinkingLevels) || !model.thinkingLevels.every(isThinkingLevel) ||
    !isThinkingLevel(model.defaultThinking) || !model.thinkingLevels.includes(model.defaultThinking) || typeof model.reasoning !== 'boolean')) {
    throw new Error('Restart the bridge to load thinking-effort support.')
  }
  return { models: json.models, defaultModel: typeof json.defaultModel === 'string' ? json.defaultModel : null }
}

/** Human label for a stored model id: "Gemini 3.6 Flash (google)". Falls back to the raw id. */
export function modelLabel(model: string, models: ModelInfo[]): string {
  if (!model || model === 'pi default') return 'pi default'
  const m = models.find((x) => x.id === model)
  return m ? `${m.name} (${m.provider})` : model
}

export interface ExtensionInfo {
  name: string
  path: string
  source: string
  scope: string
  tools: string[]
  commands: string[]
  events: string[]
}

export interface ExtensionLoadReport {
  extensions: ExtensionInfo[]
  errors: { path: string; error: string }[]
  warnings: { path: string; warning: string }[]
  error: string | null
}

export interface ExtensionInventory {
  startup: ExtensionLoadReport
  tutor: {
    enabled: boolean
    source: string
    tools: string[]
    /** Null until a web-enabled tutor session has actually been created. */
    lastLoad: ExtensionLoadReport | null
  }
}

export async function fetchExtensions(signal?: AbortSignal): Promise<ExtensionInventory> {
  const res = await fetch('/api/extensions', { signal })
  if (!res.ok) throw new Error(`Extension inventory unavailable (HTTP ${res.status})`)
  return res.json() as Promise<ExtensionInventory>
}

export interface TutorNotes { global: string; updatedAt: string | null }

/** Appended prompt text must stay small and deterministic (cache-friendly). */
export const MAX_TUTOR_NOTES = 4000

export async function fetchTutorNotes(signal?: AbortSignal): Promise<TutorNotes> {
  const res = await fetch('/api/tutor-notes', { signal })
  if (!res.ok) throw new Error(`Tutor notes unavailable (HTTP ${res.status})`)
  return res.json() as Promise<TutorNotes>
}

export async function saveTutorNotes(globalNotes: string): Promise<TutorNotes> {
  const res = await fetch('/api/tutor-notes', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ global: globalNotes }),
  })
  const value = await res.json()
  if (!res.ok) throw new ThreadApiErrorWithCode(value.error ?? 'Saving tutor notes failed', value.code ?? 'request-failed')
  return value
}

class ThreadApiErrorWithCode extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

export interface StreamHandlers {
  onDelta(text: string): void
  onDone(): void
  onError(message: string): void
  onTool?(name: string, phase: 'start' | 'end'): void
  onMetadata?(metadata: GenerationMetadata): void
}

/** POST /api/chat and consume the SSE stream. On abort: silently stops (no onDone/onError). */
export function streamChat(
  opts: { model: string; messages: ChatMsg[]; thinking?: ThinkingLevel; globalNotes?: string; threadNotes?: string; signal: AbortSignal } & StreamHandlers,
): void {
  const { model, messages, thinking, globalNotes, threadNotes = '', signal, onDelta, onDone, onError, onTool, onMetadata } = opts
  void (async () => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: model || 'default', messages, thinking, globalNotes, tutorNotes: threadNotes }),
        signal,
      })
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error ?? `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) throw new Error('The answer stream ended before completion.')
          buf += dec.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of raw.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const evt = JSON.parse(line.slice(6))
              if (signal.aborted) return
              if (evt.event === 'metadata') {
                if (!isGenerationMetadata(evt)) throw new Error('Invalid generation metadata')
                onMetadata?.(evt)
              } else if (evt.event === 'delta' && typeof evt.text === 'string') onDelta(evt.text)
              else if (evt.event === 'done') { onDone(); return }
              else if (evt.event === 'error') { onError(evt.message ?? 'unknown error'); return }
              else if (evt.event === 'tool' && evt.name) onTool?.(evt.name, evt.phase ?? 'start')
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === 'AbortError') return
      onError(String((e as Error).message ?? e))
    }
  })()
}
