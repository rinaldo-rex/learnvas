import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { diagramSourceProblem, renderDiagram, type DiagramImage } from '../lib/mermaid'
import { DiagramViewer } from './DiagramViewer'
import './diagrams.css'

const StreamingContext = createContext(false)
const remarkPlugins = [remarkGfm, remarkBreaks]
const getTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' as const : 'light' as const
function subscribeTheme(change: () => void) {
  const observer = new MutationObserver(change)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function MermaidDiagram({ source, streaming }: { source: string; streaming: boolean }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  const [result, setResult] = useState<{ source: string; image?: DiagramImage; error?: string } | null>(null)
  const [open, setOpen] = useState(false)
  // Keep the previous image while re-theming, so an open viewer retains its
  // focus and pan/zoom state rather than briefly unmounting.
  const current = !streaming && result?.source === source ? result : null
  const problem = diagramSourceProblem(source)

  useEffect(() => {
    if (streaming || problem) return
    const controller = new AbortController()
    void renderDiagram(source, theme, controller.signal).then(
      image => { if (!controller.signal.aborted) setResult({ source, image }) },
      () => { if (!controller.signal.aborted) setResult({ source, error: 'This diagram could not be rendered.' }) },
    )
    return () => controller.abort()
  }, [source, theme, streaming, problem])

  const image = current?.image
  const notice = streaming ? 'Diagram source · renders when the answer finishes' : problem ?? current?.error ?? 'Rendering diagram…'

  return <figure
    className="mermaid-diagram nodrag nopan"
    onMouseUp={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()}
  >
    {image ? <>
      <img
        className="mermaid-image"
        src={image.src}
        alt="Mermaid diagram; text available under Diagram source"
        draggable={false}
        onError={() => setResult({ source, error: 'This diagram could not be displayed.' })}
      />
      <button type="button" className="ghost diagram-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>Open larger view</button>
      <details className="diagram-source"><summary>Diagram source</summary><pre className="nowheel"><code className="language-mermaid">{source}</code></pre></details>
    </> : <>
      <figcaption className="diagram-notice">{notice}</figcaption>
      <pre className="nowheel"><code className="language-mermaid">{source}</code></pre>
    </>}
    {open && image && <DiagramViewer image={image} onClose={() => setOpen(false)} />}
  </figure>
}

// Stable component identities keep viewer/render state across streamed tokens.
// Override pre rather than code so figures/dialogs never become invalid <pre>
// children. Ordinary fenced blocks and inline code retain their normal markup.
const mdComponents: Components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: function MarkdownPre({ node, children, ...props }) {
    const streaming = useContext(StreamingContext)
    const code = node?.children.length === 1 ? node.children[0] : null
    if (code?.type === 'element' && code.tagName === 'code' && Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
      const source = code.children.map(child => child.type === 'text' ? child.value : '').join('')
      return <MermaidDiagram source={source} streaming={streaming} />
    }
    return <pre {...props}>{children}</pre>
  },
}

export function ResponseMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  return <StreamingContext.Provider value={streaming}>
    <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>{text}</ReactMarkdown>
  </StreamingContext.Provider>
}
