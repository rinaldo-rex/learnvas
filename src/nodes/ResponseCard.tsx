import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useApp } from '../actions'
import type { ResponseNode } from '../types'

const trim = (s: string, n = 26) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function ResponseCard({ id, data }: NodeProps<ResponseNode>) {
  const { patchNode, removeNode, branchFrom, stopStream } = useApp()
  const [chip, setChip] = useState<{ x: number; y: number; text: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Show the branch chip near the current text selection inside this card's body.
  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setChip(null)
      return
    }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    if (!text || !bodyRef.current?.contains(range.commonAncestorContainer)) {
      setChip(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setChip({
      x: Math.min(rect.right + 4, window.innerWidth - 310),
      y: rect.bottom + 6,
      text,
    })
  }, [])

  // Dismiss the chip whenever the selection collapses.
  useEffect(() => {
    if (!chip) return
    const h = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setChip(null)
    }
    document.addEventListener('selectionchange', h)
    return () => document.removeEventListener('selectionchange', h)
  }, [chip])

  const streaming = data.status === 'streaming'

  return (
    <div className="card response">
      <Handle type="target" position={Position.Left} id="t" className="h-hidden" />
      <Handle type="source" position={Position.Right} id="s" className="h-hidden" />

      <div
        className="card-head"
        onClick={() => patchNode(id, { collapsed: !data.collapsed })}
      >
        <span className={`status-dot ${data.status}`} />
        <span className="tag asst">Assistant</span>
        <span className="model">{data.model}</span>
        <span className="spacer" />
        {streaming && (
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation()
              stopStream(id)
            }}
          >
            ■ stop
          </button>
        )}
        <button
          className="x"
          title="Delete (removes this branch)"
          onClick={(e) => {
            e.stopPropagation()
            removeNode(id)
          }}
        >
          ×
        </button>
        <span className={`chev ${data.collapsed ? 'rot' : ''}`}>▾</span>
      </div>

      {!data.collapsed && (
        <div ref={bodyRef} className="resp sel-ok" onMouseUp={checkSelection}>
          {data.text || (streaming ? '' : '(empty)')}
          {streaming && <span className="caret" />}
        </div>
      )}

      {chip && (
        <div
          className="branch-chip"
          style={{ left: chip.x, top: chip.y }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            branchFrom(id, chip.text)
            setChip(null)
            window.getSelection()?.removeAllRanges()
          }}
        >
          ↳ Branch from “<span>{trim(chip.text)}</span>”
        </div>
      )}
    </div>
  )
}
