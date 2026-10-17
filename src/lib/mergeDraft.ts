import type { LVEdge, LVNode, PromptNode } from '../types'

/** Selection order is source order; runtime selection is never persisted. */
export function createMergeDraft(nodes: LVNode[], sourceIds: string[]): { node: PromptNode; edges: LVEdge[] } | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const sources = [...new Set(sourceIds)].map(id => byId.get(id)).filter((node): node is LVNode => !!node)
  if (sources.length < 2) return null
  const bounds = (node: LVNode) => ({
    x: node.position.x, y: node.position.y,
    width: node.measured?.width ?? node.data.width ?? (node.type === 'prompt' ? 280 : 340),
    height: node.measured?.height ?? (node.data.collapsed ? 44 : node.data.height ?? 180),
  })
  const position = {
    x: Math.max(...sources.map(node => bounds(node).x + bounds(node).width)) + 120,
    y: sources.reduce((sum, node) => sum + bounds(node).y, 0) / sources.length,
  }
  // Avoid landing on existing cards, including unselected branches.
  const obstacles = nodes.map(bounds).sort((a, b) => a.y - b.y)
  for (const rect of obstacles) {
    if (position.x < rect.x + rect.width + 30 && position.x + 280 + 30 > rect.x &&
        position.y < rect.y + rect.height + 30 && position.y + 280 + 30 > rect.y) {
      position.y = rect.y + rect.height + 50
    }
  }
  const id = crypto.randomUUID()
  return {
    node: {
      id, type: 'prompt', dragHandle: '.card-head', position,
      data: { kind: 'prompt', text: '', sent: false, collapsed: false, focus: true, mergeContext: 'histories' },
    },
    edges: sources.map(source => ({
      id: `e-${source.id}-${id}`, source: source.id, target: id, sourceHandle: 's', targetHandle: 't',
    })),
  }
}
