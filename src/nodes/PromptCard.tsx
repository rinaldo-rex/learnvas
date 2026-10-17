import { useEffect, useRef, type MouseEvent as RMouseEvent } from 'react'
import type { NodeProps } from '@xyflow/react'
import { NodePorts } from '../components/NodePorts'
import { SelectableCard } from '../components/SelectableCard'
import { useApp } from '../actions'
import { useOverflowing } from '../lib/useOverflow'
import type { PromptNode } from '../types'

const oneLine = (s: string, n = 46) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function PromptCard({ id, data, width, height }: NodeProps<PromptNode>) {
  const { updatePrompt, sendPrompt, removeNode, branchPrompt } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)
  const quoteRef = useRef<HTMLDivElement>(null)
  const inputScrolls = useOverflowing(ref, [data.text])
  const quoteScrolls = useOverflowing(quoteRef, [data.quote])

  // Selecting text inside a prompt creates a connected draft as well.
  const onInputMouseUp = (e: RMouseEvent<HTMLTextAreaElement>) => {
    if (e.button !== 0) return
    const ta = e.currentTarget
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const text = start !== end ? ta.value.slice(start, end).trim() : ''
    if (!text) return
    branchPrompt(id, text)
    ta.setSelectionRange(end, end)
  }

  useEffect(() => {
    // React Flow hides new nodes until measured; hidden inputs cannot focus.
    if (data.focus && width && height && ref.current) {
      ref.current.focus({ preventScroll: true })
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
      updatePrompt(id, { focus: false })
    }
  }, [data.focus, width, height, id, updatePrompt])

  // Only sent prompts can collapse (collapsing a draft would be confusing).
  const collapsed = data.collapsed && data.sent

  return (
    <SelectableCard id={id} label={`prompt card: ${oneLine(data.text) || 'Empty prompt'}`} className="card prompt">
      <NodePorts id={id} />

      <div
        className="card-head"
        onClick={() => data.sent && updatePrompt(id, { collapsed: !data.collapsed })}
      >
        <span className="tag you">{data.mergeContext ? 'Merge' : 'You'}</span>
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

      {data.mergeContext && <div className="merge-context nodrag nopan" onClick={event => event.stopPropagation()}>
        {data.sent ? <span className="merge-context-badge">
          {data.mergeContext === 'selected' ? 'Selected cards only' : 'Cards + histories'}
        </span> : <fieldset>
          <legend>Include</legend>
          <div className="merge-context-options">
            <button type="button" aria-pressed={data.mergeContext === 'selected'} onClick={() => updatePrompt(id, { mergeContext: 'selected' })}>Selected cards only</button>
            <button type="button" aria-pressed={data.mergeContext === 'histories'} onClick={() => updatePrompt(id, { mergeContext: 'histories' })}>Cards + histories</button>
          </div>
          <p>{data.mergeContext === 'selected' ? 'Only source-card text; earlier discussion stays out.' : 'Includes earlier discussion; shared history appears once.'}</p>
        </fieldset>}
      </div>}

      {!collapsed && (
        <>
          {data.quote && (
            <div ref={quoteRef} className={`quote nodrag nopan ${quoteScrolls ? 'nowheel' : ''}`}>
              “{data.quote}”
            </div>
          )}
          <textarea
            ref={ref}
            className={`prompt-input nodrag nopan ${inputScrolls ? 'nowheel' : ''}`}
            value={data.text}
            placeholder={data.mergeContext ? 'What should we merge? e.g. Only the criticism about X and Y…' : data.quote ? 'Can you elaborate more on this?' : 'What do you want to understand?'}
            onChange={(e) => updatePrompt(id, { text: e.target.value })}
            onMouseUp={onInputMouseUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                sendPrompt(id)
              }
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
    </SelectableCard>
  )
}
