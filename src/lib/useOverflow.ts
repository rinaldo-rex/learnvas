import { useEffect, useState, type RefObject } from 'react'

/**
 * True while the referenced element's content overflows vertically.
 *
 * Re-checked when deps or the element's box change, descendants mutate, or
 * an image loads. Async Markdown/diagram layout can change scrollHeight
 * without changing the element's own dimensions.
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
    // Async diagram rendering/image loads can change scrollHeight without
    // changing the body's own box or the response text.
    const mutations = new MutationObserver(check)
    mutations.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open'] })
    el.addEventListener('load', check, true)
    return () => {
      ro.disconnect()
      mutations.disconnect()
      el.removeEventListener('load', check, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return overflowing
}