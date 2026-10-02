import { useCallback, useLayoutEffect, useRef } from 'react'

export function HelpDialog({ theme, onClose }: { theme: 'light' | 'dark'; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  // Keep src stable during theme changes so the reader's scroll position stays.
  const initialTheme = useRef(theme)
  const close = useCallback(() => {
    dialogRef.current?.close()
    onClose()
  }, [onClose])
  const sendTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: 'learnvas-help-theme', theme },
      window.location.origin,
    )
  }, [theme])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useLayoutEffect(() => {
    sendTheme()
  }, [sendTheme])

  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === frameRef.current?.contentWindow &&
        event.origin === window.location.origin &&
        event.data?.type === 'learnvas-help-close'
      ) {
        close()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [close])

  return (
    <dialog
      ref={dialogRef}
      className="help-dialog nodrag nopan nowheel"
      aria-labelledby="help-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        // Native dialog backdrop clicks target the dialog, not a child.
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom
        ) close()
      }}
    >
      <header className="help-dialog-head">
        <h2 id="help-dialog-title">Learnvas help</h2>
        <span className="hint">Esc to close</span>
        <button type="button" className="ghost" onClick={close} aria-label="Close help">
          Close ×
        </button>
      </header>
      <iframe
        ref={frameRef}
        className="help-frame"
        title="Learnvas help guide"
        src={`/help.html?embedded=1&theme=${initialTheme.current}`}
        onLoad={sendTheme}
      />
    </dialog>
  )
}

export function HelpButton({ onOpen }: { onOpen(): void }) {
  return (
    <button
      type="button"
      className="help-button ghost"
      aria-label="Open help"
      aria-haspopup="dialog"
      title="Help (?)"
      onClick={onOpen}
    >
      ?
    </button>
  )
}
