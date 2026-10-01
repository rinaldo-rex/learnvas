import { useEffect, useRef, useState } from 'react'

interface BranchComposerProps {
  x: number
  y: number
  quote: string
  modelLabel: string
  onSend(text: string): void
  onClose(): void
}

/**
 * Floating mini-composer opened by selecting text in a card: shows the
 * selection as a quoted excerpt, takes a prompt, and sends on Enter
 * (Shift+Enter newline, Esc closes).
 */
export function BranchComposer({ x, y, quote, modelLabel, onSend, onClose }: BranchComposerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  // Close on any mousedown outside the panel. Attached after a tick so the
  // mouseup that opened the composer can't immediately dismiss it.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', h)
    }
  }, [onClose])

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
  }

  return (
    <div ref={panelRef} className="branch-composer nowheel nodrag" style={{ left: x, top: y }}>
      <div className="quote">“{quote}”</div>
      <textarea
        ref={taRef}
        value={text}
        placeholder="Ask about this…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <div className="composer-foot">
        <span className="hint">↵ send · ⇧↵ newline · esc close</span>
        <span className="model">{modelLabel}</span>
      </div>
    </div>
  )
}