import type { Edge, Node } from '@xyflow/react'

export interface PromptData extends Record<string, unknown> {
  kind: 'prompt'
  text: string
  sent: boolean
  collapsed: boolean
  /** Explicit saved dimensions, not React Flow's automatic measurements. */
  width?: number
  height?: number
  /** Selected excerpt from the parent card; displayed and included in model context. */
  quote?: string
  /** One-shot signal: autofocus the textarea when the node is created. */
  focus?: boolean
}

export interface ResponseData extends Record<string, unknown> {
  kind: 'response'
  text: string
  /** 'pi default' or 'provider/model-id' */
  model: string
  status: 'streaming' | 'done' | 'error' | 'stopped'
  collapsed: boolean
  sourcePromptId: string
  /** User-resized card dimensions (persisted; drive wrapper style + body layout). */
  width?: number
  height?: number
  /** Transient tool-activity note shown while streaming, e.g. "🔎 web_search…". */
  activity?: string
}

export type PromptNode = Node<PromptData, 'prompt'>
export type ResponseNode = Node<ResponseData, 'response'>
export type LVNode = PromptNode | ResponseNode
export type LVEdge = Edge

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}
