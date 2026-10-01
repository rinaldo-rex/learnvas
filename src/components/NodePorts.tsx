import { Fragment } from 'react'
import { Handle, Position, useNodeConnections } from '@xyflow/react'
import { useApp } from '../actions'
import { NODE_SIDES, SOURCE_HANDLES, TARGET_HANDLES, openPorts } from '../lib/ports'

const POSITIONS = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

export function NodePorts({ id }: { id: string }) {
  const { continuePrompt } = useApp()
  const connections = useNodeConnections({ id })
  const ports = openPorts(id, connections)

  return (
    <>
      {/* Handles stay mounted even on occupied sides so existing edges keep
          their anchors. Only the hover buttons depend on available sides. */}
      {NODE_SIDES.map(side => (
        <Fragment key={side}>
          <Handle type="source" position={POSITIONS[side]} id={SOURCE_HANDLES[side]} className="h-hidden" />
          <Handle type="target" position={POSITIONS[side]} id={TARGET_HANDLES[side]} className="h-hidden" />
        </Fragment>
      ))}
      <Handle type="source" position={Position.Right} id={SOURCE_HANDLES.corner} className="h-hidden" style={{ top: 0 }} />
      {ports.map(port => (
        <button
          key={port}
          type="button"
          className={`node-plus node-plus-${port} nodrag nopan`}
          aria-label={`Continue conversation (${port === 'corner' ? 'top-right corner' : port})`}
          title="New connected prompt"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            continuePrompt(id, port)
          }}
        >
          +
        </button>
      ))}
    </>
  )
}
