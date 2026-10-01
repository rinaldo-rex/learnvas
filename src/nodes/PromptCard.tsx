import { useEffect, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useApp } from '../actions'
import { modelLabel } from '../lib/api'
import { useOverflowing } from '../lib/useOverflow'
import type { PromptNode } from '../types'
import { BranchComposer } from './BranchComposer'

const oneLine = (s: string, n = 46) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function PromptCard({ id, data }: NodeProps<PromptNode>) {
  const { updatePrompt, sendPrompt, removeNode, branchSend, models, selectedModel } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)
  const quoteRef = useRef<HTMLDivElement>(null)
  const inputScrolls = useOverflowing(ref, [data.text])
  const quoteScrolls = useOverflowing(quoteRef, [data.quote])
  const [composer, setComposer] = useState<{ x: number; y: number; text: string } | null>(null)

  // Selecting text inside the prompt opens the branch composer.
  const onInputMouseUp = (e: RMouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const text = start !== end ? ta.value.slice(start, end).trim() : ''
    if (!text) {
      setComposer(null)
      return
    }
    setComposer({
      x: Math.min(e.clientX + 10, window.innerWidth - 320),
      y: Math.min(e.clientY + 14, window.innerHeight - 240),
      text,
    })
  }

  useEffect(() => {
    if (data.focus && ref.current) {
      ref.current.focus()
      ref.current.selectionStart = ref.current.value.length
    }
  }, [data.focus])

  // Only sent prompts can collapse (collapsing a draft would be confusing).
  const collapsed = data.collapsed && data.sent

  return (
    <div className="card prompt">
      <Handle type="target" position={Position.Left} id="t" className="h-hidden" />
      <Handle type="source" position={Position.Right} id="s" className="h-hidden" />

      <div
        className="card-head"
        onClick={() => data.sent && updatePrompt(id, { collapsed: !data.collapsed })}
      >
        <span className="tag you">You</span>
        {collapsed && <span className="head-label">{oneLine(data.text)}</span>}
        <span className="spacer" />
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
      </div>

      {!collapsed && (
        <>
          {data.quote && (
            <div ref={quoteRef} className={`quote ${quoteScrolls ? 'nowheel' : ''}`}>
              “{data.quote}”
            </div>
          )}
          <textarea
            ref={ref}
            className={`prompt-input ${inputScrolls ? 'nowheel' : ''}`}
            value={data.text}
            placeholder="What do you want to understand?"
            onChange={(e) => updatePrompt(id, { text: e.target.value })}
            onMouseUp={onInputMouseUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(id)
            }}
          />
          <div className="card-foot">
            {data.sent ? (
              <button className="primary" onClick={() => sendPrompt(id)}>
                ↻ Re-run
              </button>
            ) : (
              <button
                className="primary"
                disabled={!data.text.trim()}
                onClick={() => sendPrompt(id)}
              >
                Ask →
              </button>
            )}
            <span className="hint">⌘/Ctrl + ↵</span>
          </div>
        </>
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
          }}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  )
}
