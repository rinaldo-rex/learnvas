import type { Edge } from '@xyflow/react'
import type { LVNode } from '../types'

export interface CanvasGraph {
  nodes: LVNode[]
  edges: Edge[]
}

/** Capture only the deleted branch and its incident edges, not the whole canvas. */
export function captureDeletion(graph: CanvasGraph, rootId: string): CanvasGraph | null {
  if (!graph.nodes.some((node) => node.id === rootId)) return null
  const children = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const outgoing = children.get(edge.source) ?? []
    outgoing.push(edge.target)
    children.set(edge.source, outgoing)
  }
  const reachable = new Set([rootId])
  const queue = [rootId]
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!reachable.has(child)) { reachable.add(child); queue.push(child) }
    }
  }
  // A shared merge and its descendants survive while any incoming source lives
  // outside this deletion. Explicitly deleting the merge itself still removes it.
  const protectedIds = new Set<string>()
  const protectedQueue = graph.edges.filter(edge =>
    reachable.has(edge.target) && edge.target !== rootId && !reachable.has(edge.source),
  ).map(edge => edge.target)
  for (let i = 0; i < protectedQueue.length; i++) {
    const id = protectedQueue[i]
    if (id === rootId || protectedIds.has(id)) continue
    protectedIds.add(id)
    protectedQueue.push(...(children.get(id) ?? []))
  }
  const ids = new Set([...reachable].filter(id => !protectedIds.has(id)))
  return structuredClone({
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges: graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target)),
  })
}

/** Merge a deleted branch back without overwriting newer work or restarting requests. */
export function restoreDeletion(graph: CanvasGraph, deleted: CanvasGraph): CanvasGraph {
  const ids = new Set(graph.nodes.map((node) => node.id))
  const restored = deleted.nodes.filter((node) => !ids.has(node.id)).map((node): LVNode => ({
    ...node,
    selected: false,
    dragging: false,
    data: node.type === 'response'
      ? { ...node.data, status: node.data.status === 'streaming' ? 'stopped' : node.data.status, activity: undefined }
      : { ...node.data, focus: false },
  } as LVNode))
  const nodes = [...graph.nodes, ...restored]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(graph.edges.map((edge) => edge.id))
  const edges = [...graph.edges, ...deleted.edges
    .filter((edge) => !edgeIds.has(edge.id) && nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({ ...edge, animated: false }))]
  return { nodes, edges }
}
