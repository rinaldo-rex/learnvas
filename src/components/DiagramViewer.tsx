import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FIT_TRANSFORM, zoomDiagram, type DiagramImage } from '../lib/mermaid'

/** A portal avoids the transformed React Flow node's sizing/stacking context.
 * Native modal behavior supplies focus trapping and makes the canvas inert. */
export function DiagramViewer({ image, onClose }: { image: DiagramImage; onClose(): void }) {
  const titleId = useId()
  const hintId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [transform, setTransform] = useState(FIT_TRANSFORM)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const close = useCallback(() => {
    dialogRef.current?.close()
    onClose()
  }, [onClose])

  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const opener = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current!
    const resize = () => {
      setSize({ width: viewport.clientWidth, height: viewport.clientHeight })
      setTransform(FIT_TRANSFORM)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current!
    // Native non-passive listener: prevent wheel/trackpad page/canvas scrolling.
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = viewport.getBoundingClientRect()
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      setTransform(value => zoomDiagram(value, Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.01), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      }))
    }
    viewport.addEventListener('wheel', wheel, { passive: false })
    return () => viewport.removeEventListener('wheel', wheel)
  }, [])

  const fit = Math.min(Math.max(1, size.width - 40) / image.width, Math.max(1, size.height - 40) / image.height)

  return createPortal(
    <dialog
      ref={dialogRef}
      className="diagram-dialog nodrag nopan nowheel"
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={event => { event.preventDefault(); close() }}
      onClick={event => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
      }}
      // Portals retain React ancestry: do not let viewer actions reach cards.
      onMouseUp={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key !== 'Tab') return
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        // Explicitly wrap at the ends, including browsers that otherwise let
        // Tab visit browser chrome between native-dialog focus cycles.
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <header className="diagram-dialog-head">
        <h2 id={titleId}>Mermaid diagram</h2>
        <button type="button" className="ghost" onClick={close} aria-label="Close diagram" autoFocus>Close ×</button>
      </header>
      <div className="diagram-toolbar">
        <button type="button" className="ghost" aria-label="Zoom out" onClick={() => setTransform(value => zoomDiagram(value, 1 / 1.25))}>−</button>
        <output aria-label="Diagram zoom">{Math.round(transform.scale * 100)}%</output>
        <button type="button" className="ghost" aria-label="Zoom in" onClick={() => setTransform(value => zoomDiagram(value, 1.25))}>+</button>
        <button type="button" className="ghost" onClick={() => setTransform(FIT_TRANSFORM)}>Reset to fit</button>
        <span id={hintId}>Scroll to zoom · Drag to pan · Esc to close</span>
      </div>
      <div
        ref={viewportRef}
        className="diagram-viewport"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return
          event.preventDefault()
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          const previous = drag.current
          if (!previous || previous.id !== event.pointerId) return
          setTransform(value => ({ ...value, x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }))
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
        }}
        onPointerUp={event => {
          if (drag.current?.id !== event.pointerId) return
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
      >
        <img
          src={image.src}
          alt="Enlarged Mermaid diagram; original text is available in the card's Diagram source"
          draggable={false}
          style={{
            width: image.width * fit,
            height: image.height * fit,
            transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        />
      </div>
    </dialog>,
    document.body,
  )
}
