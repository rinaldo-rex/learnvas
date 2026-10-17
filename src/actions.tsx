import { createContext, useContext } from 'react'
import type { PromptData, ResponseData } from './types'
import type { ModelInfo } from './lib/api'
import type { ContinuationPort } from './lib/ports'
import type { ThinkingLevel } from './lib/thinking'

export interface AppActions {
  // kind is omitted from patches — the discriminant must never be patched.
  patchNode(id: string, patch: Partial<Omit<PromptData, 'kind'>> & Partial<Omit<ResponseData, 'kind'>>): void
  updatePrompt(id: string, patch: Partial<PromptData>): void
  removeNode(id: string): void
  /** Send/re-run this prompt's efforts with the selected model. The optional
   * initial choices preserve UI defaults without saving just by opening a file. */
  sendPrompt(promptId: string, initialEfforts?: ThinkingLevel[]): void
  /** Create a focused draft prompt connected to the selected source card.
   *  The excerpt is quoted; a response starts only when the draft is sent. */
  branchPrompt(sourceId: string, quote: string): void
  /** Continue this conversation with an unquoted draft on the chosen side. */
  continuePrompt(sourceId: string, port: ContinuationPort): void
  /** Persist a user resize of a response card (updates node style + data). */
  resizeNode(id: string, width: number, height: number): void
  stopStream(responseId: string): void
  newPrompt(): void
  selectionMode: boolean
  selectedNodeIds: string[]
  toggleNodeSelection(id: string): void
  models: ModelInfo[]
  /** Concrete selected model ID, including the inventory-resolved Pi default. */
  selectedModel: string
  generationProblem: string | null
  setSelectedModel(id: string): void
  /** Server-backed notes applied to every thread; shared through context until the notes panel consumes it. */
  globalNotes: string
  setGlobalNotes(text: string): void
}

export const AppCtx = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const v = useContext(AppCtx)
  if (!v) throw new Error('AppCtx not mounted')
  return v
}
