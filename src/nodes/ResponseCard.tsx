import { useCallback, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Components } from 'react-markdown'
import { useApp } from '../actions'
import { modelLabel } from '../lib/api'
import { useOverflowing } from '../lib/useOverflow'
import type { ResponseNode } from '../types'
import { BranchComposer } from './BranchComposer'

// Module-level so the markdown pipeline identity is stable across renders.
const remarkPlugins = [remarkGfm, remarkBreaks]
const mdComponents: Components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

export function ResponseCard({ id, data }: NodeProps<ResponseNode>) {
  const { patchNode, removeNode, branchSend, stopStream, models, selectedModel, resizeNode } = useApp()
  const { getZoom } = useReactFlow()
  const [composer, setComposer] = useState<{ x: number; y: number; text: string } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // Only block canvas wheel-pan while the body actually scrolls — wheel over
  // a short card keeps zooming the canvas.
  const bodyScrolls = useOverflowing(bodyRef, [data.text, data.height, data.collapsed])

  /* ---------- corner resize ---------- */
  const drag = useRef<{ x: number; y: number; w: number; h: number; zoom: number } | null>(null)
  const pending = useRef<{ w: number; h: number } | null>(null)
  const rafRef = useRef(0)

  const commitPending = useCallback(() => {
    const p = pending.current
    pending.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (p) resizeNode(id, p.w, p.h)
  }, [id, resizeNode])

  const onGripDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        w: data.width ?? cardRef.current?.offsetWidth ?? 340,
        h: data.height ?? cardRef.current?.offsetHeight ?? 220,
        zoom: getZoom(),
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [data.width, data.height, getZoom],
  )

  const onGripMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d) return
      const w = Math.min(900, Math.max(220, Math.round(d.w + (e.clientX - d.x) / d.zoom)))
      const h = Math.min(1400, Math.max(120, Math.round(d.h + (e.clientY - d.y) / d.zoom)))
      pending.current = { w, h }
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          commitPending()
        })
      }
    },
    [commitPending],
  )

  const onGripUp = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (!drag.current) return
      drag.current = null
      commitPending()
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* capture already released */
      }
    },
    [commitPending],
  )

  // Open the branch composer near the current text selection in this card.
  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setComposer(null)
      return
    }
    const text = sel.toString().trim()
    const range = sel.getRangeAt(0)
    if (!text || !bodyRef.current?.contains(range.commonAncestorContainer)) {
      setComposer(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setComposer({
      x: Math.min(rect.right + 4, window.innerWidth - 320),
      y: Math.min(rect.bottom + 6, window.innerHeight - 240),
      text,
    })
  }, [])

  const streaming = data.status === 'streaming'

  return (
    <div
      ref={cardRef}
      className={`card response ${data.height ? 'tall' : ''}`}
    >
      <Handle type="target" position={Position.Left} id="t" className="h-hidden" />
      <Handle type="source" position={Position.Right} id="s" className="h-hidden" />

      <div
        className="card-head"
        onClick={() => patchNode(id, { collapsed: !data.collapsed })}
      >
        <span className={`status-dot ${data.status}`} />
        <span className="tag asst">Assistant</span>
        <span className="model">{modelLabel(data.model, models)}</span>
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
        <div
          ref={bodyRef}
          className={`resp sel-ok nodrag nopan ${bodyScrolls ? 'nowheel' : ''}`}
          onMouseUp={checkSelection}
        >
          {streaming && data.activity && <div className="tool-note">{data.activity}</div>}
          {data.text ? (
            <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>
              {data.text}
            </ReactMarkdown>
          ) : streaming ? (
            ''
          ) : (
            '(empty)'
          )}
          {streaming && <span className="caret" />}
        </div>
      )}

      {composer && (
        <BranchComposer
          x={composer.x}
          y={composer.y}
          quote={composer.text}
          modelLabel={modelLabel(selectedModel, models)}
          onSend={(text) => {
            branchSend(id, composer.text, text)
            setComposer(null)
            window.getSelection()?.removeAllRanges()
          }}
          onClose={() => setComposer(null)}
        />
      )}

      {!data.collapsed && (
        <div
          className="resize-grip nodrag"
          title="Drag to resize"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        />
      )}
    </div>
  )
}
