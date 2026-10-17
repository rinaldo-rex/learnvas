import type { ReactNode, Ref } from 'react'
import { useApp } from '../actions'

/** Inert content prevents selection clicks/keys from editing, branching, deleting,
 * collapsing, or following links. One keyboard-accessible button selects the card. */
export function SelectableCard({ id, label, className, cardRef, children }: {
  id: string
  label: string
  className: string
  cardRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  const { selectionMode, selectedNodeIds, toggleNodeSelection } = useApp()
  const selected = selectionMode && selectedNodeIds.includes(id)
  return <div ref={cardRef} className={`${className}${selectionMode ? ' merge-selecting' : ''}${selected ? ' merge-selected' : ''}`}>
    <div className="card-content" inert={selectionMode || undefined}>{children}</div>
    {selectionMode && <button
      type="button"
      className="merge-select-overlay nodrag nopan"
      aria-label={`Select ${label}`}
      aria-pressed={selected}
      onClick={event => { event.stopPropagation(); toggleNodeSelection(id) }}
    >
      <span className="merge-check" aria-hidden="true">{selected ? '✓' : '＋'}</span>
    </button>}
  </div>
}
