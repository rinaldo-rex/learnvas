import { createContext, useContext } from 'react'
import type { PromptData, ResponseData } from './types'
import type { ModelInfo } from './lib/api'

export interface AppActions {
  // kind is omitted from patches — the discriminant must never be patched.
  patchNode(id: string, patch: Partial<Omit<PromptData, 'kind'>> & Partial<Omit<ResponseData, 'kind'>>): void
  updatePrompt(id: string, patch: Partial<PromptData>): void
  removeNode(id: string): void
  /** Send (or re-run with the currently selected model) the prompt card's text. */
  sendPrompt(promptId: string): void
  /** Create a sent prompt card branching from a node (response or prompt),
   *  quote the selected excerpt, and immediately stream a response. */
  branchSend(sourceId: string, quote: string, text: string): void
  /** Persist a user resize of a response card (updates node style + data). */
  resizeNode(id: string, width: number, height: number): void
  stopStream(responseId: string): void
  newPrompt(): void
  models: ModelInfo[]
  selectedModel: string
  setSelectedModel(id: string): void
}

export const AppCtx = createContext<AppActions | null>(null)

export function useApp(): AppActions {
  const v = useContext(AppCtx)
  if (!v) throw new Error('AppCtx not mounted')
  return v
}
