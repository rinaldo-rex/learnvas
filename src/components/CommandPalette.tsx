import { useEffect, useRef } from 'react'
import { tinykeys } from 'tinykeys'

export function CommandPalette() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return tinykeys(window, {
      '$mod+k': (event) => {
        event.preventDefault()
        if (event.repeat) return
        const dialog = dialogRef.current
        if (dialog && !dialog.open) {
          if (searchRef.current) searchRef.current.value = ''
          dialog.showModal()
        }
        searchRef.current?.focus()
      },
    }, {
      // The palette shortcut also works while editing a prompt or searching.
      ignore: (event) => event.isComposing,
    })
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="command-palette nodrag nopan nowheel"
      aria-labelledby="command-palette-title"
      aria-describedby="command-palette-empty"
      onKeyDown={(event) => {
        // Search inputs otherwise consume the first Escape to clear their value.
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          event.currentTarget.close()
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom
        ) event.currentTarget.close()
      }}
    >
      <header className="command-palette-head">
        <h2 id="command-palette-title">Command palette</h2>
        <button
          type="button"
          className="ghost"
          aria-label="Close command palette"
          onClick={() => dialogRef.current?.close()}
        >
          Esc ×
        </button>
      </header>
      <input
        ref={searchRef}
        type="search"
        className="command-palette-search"
        aria-label="Search commands"
        placeholder="Search commands…"
        autoComplete="off"
        autoFocus
      />
      <p id="command-palette-empty" className="command-palette-empty">No commands yet.</p>
    </dialog>
  )
}
