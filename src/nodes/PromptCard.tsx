import { useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useApp } from '../actions'
import type { PromptNode } from '../types'

const oneLine = (s: string, n = 46) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function PromptCard({ id, data }: NodeProps<PromptNode>) {
  const { updatePrompt, sendPrompt, removeNode } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)

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
          {data.quote && <div className="quote">“{data.quote}”</div>}
          <textarea
            ref={ref}
            className="prompt-input"
            value={data.text}
            placeholder="What do you want to understand?"
            onChange={(e) => updatePrompt(id, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(id)
            }}
          />
          <div className="card-foot">
            {data.sent ? (
              <button className="primary" onClick={() => sendPrompt(id, { rerun: true })}>
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
    </div>
  )
}
