import { useEffect, useRef, useState } from 'react'
import type { ThreadWorkspace } from '../lib/threadWorkspace'
import { MAX_TUTOR_NOTES } from '../lib/api'

interface NotesSectionProps {
  title: string
  hint: string
  value: string
  max: number
  active: boolean
  /** Composite of the serving state identity (threadId or server stamp). */
  identity: string
  onChange(value: string): void
}

function NotesSection({ title, hint, value, max, active, onChange, identity }: NotesSectionProps) {
  const [expanded, setExpanded] = useState(false)
  // Server/store state alone renders a controlled textarea whose value prop
  // does not change until a save lands (notes state lives in the workspace
  // and server, not React). React then rewrites the DOM value on every
  // commit — visibly swallowing real keystrokes. Local typed state bridges
  // that gap; identity resets it on thread switch. Committing a save that
  // matches what was typed does not disturb the textarea; the identity
  // change on thread/server boundary is the only forced sync point.
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [seenIdentity, setSeenIdentity] = useState(identity)
  if (seenIdentity !== identity) {
    setSeenIdentity(identity)
    if (typed !== null) setTyped(null) // thread switch: adopt the new thread's value
  }
  const shown = typed ?? value
  return (
    <details className="notes-entry" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>
        {title}
        <span className="hint">{shown.trim() ? `${shown.length}/${max}` : 'empty'}</span>
      </summary>
      <p className="extensions-note">{hint}</p>
      <textarea
        ref={areaRef}
        className="notes-textarea"
        value={shown}
        rows={4}
        maxLength={max}
        spellCheck={false}
        placeholder={active ? 'e.g. Use mermaid diagrams when a diagram explains structure' : 'No thread is active'}
        disabled={!active}
        onChange={e => { setTyped(e.target.value); onChange(e.target.value) }}
        onBlur={() => setTyped(null)}
      />
    </details>
  )
}

/**
 * Tutor-notes overlay: one collapsed chip in the top-right. Expanded, it
 * shows two independent accordions — server-backed global notes and the
 * active thread's document notes. Screen-fixed (React Flow <Panel>), so it
 * neither pans nor zooms with the canvas and stores nothing in card state.
 * Global edits autosave via saveTutorNotes; thread edits ride the document
 * metadata the workspace already autosaves.
 */
export function TutorNotesPanel({ workspace, threadId, globalNotes, setGlobalNotes, threadNotes, onThreadNotes }: {
  workspace: ThreadWorkspace
  threadId: string
  globalNotes: string
  setGlobalNotes(text: string): void
  threadNotes: string
  onThreadNotes(notes: string): void
}) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      // Esc closes unless the user is editing text — typing a literal Esc
      // line is unusual, so let textareas keep their normal undo there.
      if (event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement)) {
        setOpen(false)
        toggleRef.current?.focus({ preventScroll: true })
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div className="notes-panel nodrag nopan nowheel" ref={panelRef}>
      <button
        ref={toggleRef}
        type="button"
        className="ghost notes-toggle"
        aria-expanded={open}
        title="Standing instructions the tutor follows"
        onClick={() => setOpen(o => !o)}
      >
        Notes
      </button>
      {open && (
        <div className="notes-body" role="group" aria-label="Tutor notes">
          <p className="extensions-note">Standing requests, appended to the tutor's instructions on every new question.</p>
          <NotesSection
            title="Global · all threads"
            hint="Applies everywhere. Example: 'Prefer mermaid diagrams for structure.'"
            value={globalNotes}
            max={MAX_TUTOR_NOTES}
            active
            identity={`global:${globalNotes}`}
            onChange={setGlobalNotes}
          />
          <NotesSection
            title="This thread"
            hint="Saved with the thread and travels on export. Example: 'Focus on intuition, no derivations.'"
            value={threadNotes}
            max={MAX_TUTOR_NOTES}
            active={Boolean(workspace.getSnapshot().active)}
            identity={`thread:${threadId}:${threadNotes}`}
            onChange={onThreadNotes}
          />
        </div>
      )}
    </div>
  )
}
