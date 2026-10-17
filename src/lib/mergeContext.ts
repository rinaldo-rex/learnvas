import type { LVEdge, LVNode, MergeContext } from '../types'

/** Each connection may override the merge-wide default independently. */
export function sourceContext(defaultScope: MergeContext, edge: LVEdge): MergeContext {
  return edge.data?.mergeContext ?? defaultScope
}

/** A whole-merge choice resets overrides; a source choice changes only its edge.
 * Scopes live on edges so branch deletion/undo carries them without stale IDs. */
export function setMergeScope(nodes: LVNode[], edges: LVEdge[], promptId: string, scope: MergeContext, sourceId?: string) {
  const prompt = nodes.find(node => node.id === promptId)
  if (prompt?.type !== 'prompt' || !prompt.data.mergeContext || prompt.data.sent) return { nodes, edges }
  return {
    nodes: sourceId === undefined ? nodes.map(node => node.id === promptId
      ? { ...prompt, data: { ...prompt.data, mergeContext: scope } } : node) : nodes,
    edges: edges.map(edge => {
      if (edge.target !== promptId || (sourceId !== undefined && edge.source !== sourceId)) return edge
      const { mergeContext: _previous, ...data } = edge.data ?? {}
      return { ...edge, data: sourceId !== undefined ? { ...data, mergeContext: scope } : data }
    }),
  }
}
