import type { MermaidConfig } from 'mermaid'

export const MAX_DIAGRAM_LENGTH = 30_000

/** Mermaid's strict mode sanitizes markup, but is not a network boundary.
 * Keep resource/config/style features out BEFORE its temporary measuring DOM
 * exists. This is deliberately a diagram reader, not a Mermaid app embed. */
export function diagramSourceProblem(source: string): string | null {
  if (!source.trim()) return 'The diagram is empty.'
  if (source.length > MAX_DIAGRAM_LENGTH) return 'This diagram is too large to render.'
  if (/^\s*---/.test(source) || /%%\s*\{/.test(source)) {
    return 'Custom Mermaid configuration is not supported.'
  }
  if (
    /@\s*\{|!\s*\[|<\s*\/?\s*(?!br\s*\/?\s*>)[a-z!]/i.test(source) ||
    /\b(?:style|classDef|linkStyle|click)\s/i.test(source) ||
    /\bUpdate\w*(?:Style|Config)\s*\(/i.test(source) ||
    /(?:url\s*\(|@import|(?:https?|data|file|javascript|blob|ftp):|\\)/i.test(source)
  ) {
    return 'Embedded HTML, assets, links, and custom styles are not supported.'
  }
  return null
}

export function diagramConfig(theme: 'light' | 'dark'): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    logLevel: 5,
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'system-ui, sans-serif',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: MAX_DIAGRAM_LENGTH,
    maxEdges: 300,
    // Defense in depth for entity-encoded HTML in text labels.
    dompurifyConfig: {
      FORBID_TAGS: ['img', 'image', 'script', 'style', 'foreignobject', 'math', 'iframe', 'object', 'embed', 'link', 'video', 'audio', 'source'],
      FORBID_ATTR: ['src', 'srcset', 'style'],
    },
    secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'htmlLabels', 'dompurifyConfig'],
  }
}

export interface DiagramImage { src: string; width: number; height: number }
let queue: Promise<unknown> = Promise.resolve()
let sequence = 0

/** Serialize initialize/render because Mermaid has global config. Never insert
 * its SVG into React's DOM or call bindFunctions: SVG images are inert (no
 * scripts, interactive links, or external-resource loading in image mode). */
export function renderDiagram(source: string, theme: 'light' | 'dark', signal: AbortSignal): Promise<DiagramImage> {
  const problem = diagramSourceProblem(source)
  if (problem) return Promise.reject(new Error(problem))
  const job = queue.then(async () => {
    signal.throwIfAborted()
    const { default: mermaid } = await import('mermaid')
    signal.throwIfAborted()
    mermaid.initialize(diagramConfig(theme))
    mermaid.parseError = () => { /* The card provides a quiet source fallback. */ }
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden;pointer-events:none'
    host.setAttribute('aria-hidden', 'true')
    document.body.append(host)
    try {
      const { svg } = await mermaid.render(`learnvas-diagram-${++sequence}`, source, host)
      signal.throwIfAborted()
      const documentSvg = new DOMParser().parseFromString(svg, 'image/svg+xml')
      const root = documentSvg.documentElement
      const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
      if (root.localName !== 'svg' || !box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
        throw new Error('Invalid diagram dimensions')
      }
      // Explicit intrinsic dimensions keep <img> sizing consistent across
      // diagram types, rather than SVG's default 300x150 image dimensions.
      root.setAttribute('width', String(box[2]))
      root.setAttribute('height', String(box[3]))
      root.removeAttribute('style')
      const image = new XMLSerializer().serializeToString(root)
      return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`, width: box[2], height: box[3] }
    } finally {
      host.remove()
    }
  })
  // A malformed diagram must not poison subsequent renders.
  queue = job.catch(() => {})
  return job
}

export interface DiagramTransform { scale: number; x: number; y: number }
export const FIT_TRANSFORM: DiagramTransform = { scale: 1, x: 0, y: 0 }

/** Zoom around a point measured from the viewer's center, in CSS pixels. */
export function zoomDiagram(transform: DiagramTransform, factor: number, point = { x: 0, y: 0 }): DiagramTransform {
  const scale = Math.min(8, Math.max(0.25, transform.scale * factor))
  const ratio = scale / transform.scale
  return { scale, x: point.x - (point.x - transform.x) * ratio, y: point.y - (point.y - transform.y) * ratio }
}
