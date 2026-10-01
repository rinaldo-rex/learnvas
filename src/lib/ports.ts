export const NODE_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type NodeSide = (typeof NODE_SIDES)[number]
export type ContinuationPort = NodeSide | 'corner'

// Keep legacy s/t IDs so saved canvases still connect right → left.
export const SOURCE_HANDLES: Record<ContinuationPort, string> = {
  top: 's-top', right: 's', bottom: 's-bottom', left: 's-left', corner: 's-corner',
}
export const TARGET_HANDLES: Record<NodeSide, string> = {
  top: 't-top', right: 't-right', bottom: 't-bottom', left: 't',
}
const OPPOSITE: Record<NodeSide, NodeSide> = {
  top: 'bottom', right: 'left', bottom: 'top', left: 'right',
}

interface Connection {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export function openPorts(nodeId: string, connections: readonly Connection[]): ContinuationPort[] {
  const occupied = new Set<NodeSide>()
  for (const edge of connections) {
    for (const side of NODE_SIDES) {
      if (edge.source === nodeId && (edge.sourceHandle ?? 's') === SOURCE_HANDLES[side]) occupied.add(side)
      if (edge.target === nodeId && (edge.targetHandle ?? 't') === TARGET_HANDLES[side]) occupied.add(side)
    }
  }
  const open = NODE_SIDES.filter(side => !occupied.has(side))
  return open.length ? open : ['corner']
}

/** Responses continue away from their prompt's parent, including left/up branches. */
export function responseSide(incomingHandle?: string | null): NodeSide {
  const incoming = NODE_SIDES.find(side => TARGET_HANDLES[side] === (incomingHandle ?? 't'))
  return incoming ? OPPOSITE[incoming] : 'right'
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export function attachmentLayout(
  source: Bounds,
  port: ContinuationPort,
  child: { width: number; height: number },
  offset = 0,
) {
  const gap = 90
  let position: { x: number; y: number }
  switch (port) {
    case 'top':
      position = { x: source.x + (source.width - child.width) / 2 + offset, y: source.y - child.height - gap }
      break
    case 'bottom':
      position = { x: source.x + (source.width - child.width) / 2 + offset, y: source.y + source.height + gap }
      break
    case 'left':
      position = { x: source.x - child.width - gap, y: source.y + offset }
      break
    case 'corner':
      position = { x: source.x + source.width + gap, y: source.y - child.height - gap - offset }
      break
    default:
      position = { x: source.x + source.width + gap, y: source.y + offset }
  }
  return {
    position,
    sourceHandle: SOURCE_HANDLES[port],
    targetHandle: TARGET_HANDLES[port === 'corner' ? 'left' : OPPOSITE[port]],
  }
}
