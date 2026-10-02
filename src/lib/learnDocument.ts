import type { LVEdge, LVNode } from '../types'
import { SOURCE_HANDLES, TARGET_HANDLES } from './ports.ts'

export const LEARN_FORMAT = 'learnvas' as const
export const LEARN_VERSION = 1 as const

/** Canonical fields only: none of these types depend on React Flow. */
export interface ThreadMetadata {
  threadId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface LearnViewport {
  x: number
  y: number
  zoom: number
}

interface CardBase {
  id: string
  position: { x: number; y: number }
  text: string
  collapsed: boolean
  /** Explicit user-saved dimensions, never automatic measurements. */
  width?: number
  height?: number
}

export interface LearnPrompt extends CardBase {
  kind: 'prompt'
  sent: boolean
  quote?: string
}

export interface LearnResponse extends CardBase {
  kind: 'response'
  model: string
  status: 'done' | 'error' | 'stopped'
  sourcePromptId: string
}

export type LearnCard = LearnPrompt | LearnResponse

export interface LearnConnection {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

export interface LearnDocument extends ThreadMetadata {
  format: typeof LEARN_FORMAT
  version: typeof LEARN_VERSION
  cards: LearnCard[]
  connections: LearnConnection[]
  viewport: LearnViewport
}

export interface DocumentCanvas {
  nodes: LVNode[]
  edges: LVEdge[]
  viewport: LearnViewport
}

export type DocumentErrorCode = 'invalid-json' | 'invalid-format' | 'unsupported-version' | 'invalid-document'

export class LearnDocumentError extends Error {
  readonly code: DocumentErrorCode
  readonly path: string

  constructor(code: DocumentErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'LearnDocumentError'
    this.code = code
    this.path = path
  }
}

function invalid(path: string, message: string): never {
  throw new LearnDocumentError('invalid-document', path, message)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'expected a plain JSON object')
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, 'unknown field')
  }
}

function text(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) invalid(path, nonempty ? 'expected a nonempty string' : 'expected a string')
  return value
}

function number(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) invalid(path, positive ? 'expected a positive finite number' : 'expected a finite number')
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean')
  return value
}

function timestamp(value: unknown, path: string): string {
  const result = text(value, path)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    invalid(path, 'expected a valid UTC timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)')
  }
  return result
}

function position(value: unknown, path: string) {
  const point = object(value, path)
  fields(point, ['x', 'y'], path)
  return { x: number(point.x, `${path}.x`), y: number(point.y, `${path}.y`) }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array')
  return Array.from(value) // Treat sparse JS input as invalid elements, not silently skipped records.
}

function card(value: unknown, index: number): LearnCard {
  const path = `document.cards[${index}]`
  const c = object(value, path)
  const common = ['id', 'kind', 'position', 'text', 'collapsed', 'width', 'height']
  if (c.kind !== 'prompt' && c.kind !== 'response') invalid(`${path}.kind`, 'expected prompt or response')
  fields(c, [...common, ...(c.kind === 'prompt' ? ['sent', 'quote'] : ['model', 'status', 'sourcePromptId'])], path)
  const base: CardBase = {
    id: text(c.id, `${path}.id`, true),
    position: position(c.position, `${path}.position`),
    text: text(c.text, `${path}.text`),
    collapsed: boolean(c.collapsed, `${path}.collapsed`),
  }
  if (Object.hasOwn(c, 'width')) base.width = number(c.width, `${path}.width`, true)
  if (Object.hasOwn(c, 'height')) base.height = number(c.height, `${path}.height`, true)
  if (c.kind === 'prompt') {
    const prompt: LearnPrompt = { ...base, kind: 'prompt', sent: boolean(c.sent, `${path}.sent`) }
    if (Object.hasOwn(c, 'quote')) prompt.quote = text(c.quote, `${path}.quote`)
    return prompt
  }
  if (c.status !== 'done' && c.status !== 'error' && c.status !== 'stopped') invalid(`${path}.status`, 'expected done, error, or stopped (never an active request)')
  return {
    ...base, kind: 'response', model: text(c.model, `${path}.model`, true),
    status: c.status, sourcePromptId: text(c.sourcePromptId, `${path}.sourcePromptId`, true),
  }
}

function connection(value: unknown, index: number): LearnConnection {
  const path = `document.connections[${index}]`
  const c = object(value, path)
  fields(c, ['id', 'source', 'target', 'sourceHandle', 'targetHandle'], path)
  const result = {
    id: text(c.id, `${path}.id`, true), source: text(c.source, `${path}.source`, true),
    target: text(c.target, `${path}.target`, true),
    sourceHandle: text(c.sourceHandle, `${path}.sourceHandle`),
    targetHandle: text(c.targetHandle, `${path}.targetHandle`),
  }
  if (!Object.values(SOURCE_HANDLES).includes(result.sourceHandle)) invalid(`${path}.sourceHandle`, 'unknown source port')
  if (!Object.values(TARGET_HANDLES).includes(result.targetHandle)) invalid(`${path}.targetHandle`, 'unknown target port')
  return result
}

function validateGraph(cards: LearnCard[], connections: LearnConnection[]) {
  const byId = new Map<string, LearnCard>()
  for (const [index, c] of cards.entries()) {
    if (byId.has(c.id)) invalid(`document.cards[${index}].id`, 'duplicate card ID')
    byId.set(c.id, c)
  }
  const edgeIds = new Set<string>()
  const parents = new Map<string, string>()
  for (const [index, c] of connections.entries()) {
    const path = `document.connections[${index}]`
    if (edgeIds.has(c.id)) invalid(`${path}.id`, 'duplicate connection ID')
    edgeIds.add(c.id)
    const source = byId.get(c.source)
    const target = byId.get(c.target)
    if (!source) invalid(`${path}.source`, 'card does not exist')
    if (!target) invalid(`${path}.target`, 'card does not exist')
    if (c.source === c.target) invalid(path, 'self connections are not allowed')
    if (parents.has(c.target)) invalid(path, 'a card may have only one parent')
    if (target.kind === 'response' && (source.kind !== 'prompt' || target.sourcePromptId !== source.id)) {
      invalid(path, 'response parent must match its sourcePromptId and be a prompt')
    }
    parents.set(c.target, c.source)
  }
  for (const [index, c] of cards.entries()) {
    if (c.kind === 'response' && (byId.get(c.sourcePromptId)?.kind !== 'prompt' || parents.get(c.id) !== c.sourcePromptId)) {
      invalid(`document.cards[${index}].sourcePromptId`, 'expected an existing prompt and a matching incoming connection')
    }
  }
  // Each card has at most one parent: iterative traversal is linear, even for long chains.
  const visited = new Set<string>()
  for (const c of cards) {
    const path = new Set<string>()
    let id: string | undefined = c.id
    while (id !== undefined && !visited.has(id)) {
      if (path.has(id)) invalid('document.connections', 'cycles are not allowed')
      path.add(id)
      id = parents.get(id)
    }
    for (const id of path) visited.add(id)
  }
}

/** Read-only version/migration boundary. No extension or filename inference, no implicit downgrade. */
export function validateDocument(value: unknown): LearnDocument {
  const d = object(value, 'document')
  if (d.format !== LEARN_FORMAT) throw new LearnDocumentError('invalid-format', 'document.format', `expected "${LEARN_FORMAT}"`)
  if (!Number.isInteger(d.version) || (d.version as number) < 1) invalid('document.version', 'expected a positive integer schema version')
  if (d.version !== LEARN_VERSION) throw new LearnDocumentError('unsupported-version', 'document.version', `unsupported schema version ${d.version}; supported: ${LEARN_VERSION}`)
  // Future versions must dispatch here to their own validators and explicit migrations.
  fields(d, ['format', 'version', 'threadId', 'title', 'createdAt', 'updatedAt', 'cards', 'connections', 'viewport'], 'document')
  const v = object(d.viewport, 'document.viewport')
  fields(v, ['x', 'y', 'zoom'], 'document.viewport')
  const result: LearnDocument = {
    format: LEARN_FORMAT, version: LEARN_VERSION,
    threadId: text(d.threadId, 'document.threadId', true), title: text(d.title, 'document.title', true),
    createdAt: timestamp(d.createdAt, 'document.createdAt'), updatedAt: timestamp(d.updatedAt, 'document.updatedAt'),
    cards: array(d.cards, 'document.cards').map(card),
    connections: array(d.connections, 'document.connections').map(connection),
    viewport: { x: number(v.x, 'document.viewport.x'), y: number(v.y, 'document.viewport.y'), zoom: number(v.zoom, 'document.viewport.zoom', true) },
  }
  if (result.updatedAt < result.createdAt) invalid('document.updatedAt', 'must not precede createdAt')
  validateGraph(result.cards, result.connections)
  return result
}

export function parseDocument(json: string): LearnDocument {
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new LearnDocumentError('invalid-json', 'document', 'invalid JSON') }
  return validateDocument(value)
}

/** Validate before stringify so NaN, undefined, and unknown fields cannot disappear silently. */
export function serializeDocument(document: LearnDocument): string {
  return `${JSON.stringify(validateDocument(document), null, 2)}\n`
}

export function createThreadMetadata(title = 'Untitled', now = new Date().toISOString()): ThreadMetadata {
  return { threadId: crypto.randomUUID(), title, createdAt: now, updatedAt: now }
}

/** Explicit allowlist projection, never serialize React Flow nodes or arbitrary node.data. */
export function canvasToDocument(canvas: DocumentCanvas, metadata: ThreadMetadata): LearnDocument {
  const cards = canvas.nodes.map((node): LearnCard => {
    const base: CardBase = {
      id: node.id, position: { x: node.position.x, y: node.position.y },
      text: node.data.text, collapsed: node.data.collapsed,
    }
    if (node.data.width !== undefined) base.width = node.data.width
    if (node.data.height !== undefined) base.height = node.data.height
    if (node.type === 'prompt') {
      const prompt: LearnPrompt = { ...base, kind: 'prompt', sent: node.data.sent }
      if (node.data.quote !== undefined) prompt.quote = node.data.quote
      return prompt
    }
    if (node.type !== 'response') invalid('canvas.nodes', 'unknown node type')
    return {
      ...base, kind: 'response', model: node.data.model,
      status: node.data.status === 'streaming' ? 'stopped' : node.data.status,
      sourcePromptId: node.data.sourcePromptId,
    }
  })
  return validateDocument({
    format: LEARN_FORMAT, version: LEARN_VERSION,
    threadId: metadata.threadId, title: metadata.title, createdAt: metadata.createdAt, updatedAt: metadata.updatedAt,
    cards,
    connections: canvas.edges.map(edge => ({
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? 's', targetHandle: edge.targetHandle ?? 't',
    })),
    viewport: { x: canvas.viewport.x, y: canvas.viewport.y, zoom: canvas.viewport.zoom },
  })
}

/** Rebuild UI state without requests, focus signals, activity, or automatic measurements. */
export function documentToCanvas(document: LearnDocument): DocumentCanvas {
  const d = validateDocument(document)
  return {
    nodes: d.cards.map((c): LVNode => {
      const { id, position, ...data } = c
      return {
        id, position, type: c.kind, dragHandle: '.card-head', selected: false, dragging: false,
        style: { width: c.width, height: c.collapsed ? undefined : c.height },
        data: c.kind === 'prompt' ? { ...data, focus: false } : data,
      } as LVNode
    }),
    edges: d.connections.map(c => ({ ...c, animated: false })),
    viewport: d.viewport,
  }
}
