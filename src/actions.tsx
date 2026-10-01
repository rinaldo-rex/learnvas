import { createContext, useContext } from 'react'
import type { PromptData, ResponseData } from './types'
import type { ModelInfo } from './lib/api'

export interface AppActions {
  // kind is omitted from patches — the discriminant must never be patched.
  patchNode(id: string, patch: Partial<Omit<PromptData, 'kind'>> & Partial<Omit<ResponseData, 'kind'>>): void
  updatePrompt(id: string, patch: Partial<PromptData>): void
  removeNode(id: string): void
  /** Send (or re-run with the currently selected model) the prompt card's text. */
  sendPrompt(promptId: string, opts?: { rerun?: boolean }): void
  /** Create a child prompt card branching from a response, seeded with the selected excerpt. */
  branchFrom(responseId: string, quote: string): void
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
