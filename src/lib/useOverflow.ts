import { useEffect, useState, type RefObject } from 'react'

/**
 * True while the referenced element's content overflows vertically.
 *
 * Re-checked whenever `deps` change (content growth doesn't resize the
 * element itself, so callers must pass the state that drives content size)
 * and whenever the element's own box resizes (via ResizeObserver).
 */
export function useOverflowing(ref: RefObject<HTMLElement | null>, deps: unknown[]): boolean {
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return overflowing
}