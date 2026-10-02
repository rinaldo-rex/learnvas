import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultKeybindingsHandlerIgnore, tinykeys } from 'tinykeys'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type XYPosition,
} from '@xyflow/react'
import { AppCtx, type AppActions } from './actions'
import { CommandPalette } from './components/CommandPalette'
import { ExtensionsPanel } from './components/ExtensionsPanel'
import { HelpButton, HelpDialog } from './components/HelpButton'
import { fetchModels, streamChat, type ModelInfo } from './lib/api'
import { captureDeletion, restoreDeletion, type CanvasGraph } from './lib/deletion'
import { loadCanvas, saveCanvas, type StoredCanvas } from './lib/canvasStorage'
import { canvasToDocument, createThreadMetadata, documentToCanvas, type ThreadMetadata } from './lib/learnDocument'
import { attachmentLayout, responseSide, SOURCE_HANDLES, type ContinuationPort } from './lib/ports'
import { parseThemePreference } from './lib/theme'
import { useTheme } from './lib/useTheme'
import { PromptCard } from './nodes/PromptCard'
import { ResponseCard } from './nodes/ResponseCard'
import type { ChatMsg, LVNode, PromptNode, ResponseData, ResponseNode } from './types'

const nodeTypes = { prompt: PromptCard, response: ResponseCard }

function loadSaved(): StoredCanvas {
  try {
    return loadCanvas(localStorage)
  } catch (error) {
    // Even accessing localStorage can throw when browser storage is blocked.
    return { kind: 'error', message: error instanceof Error ? error.message : 'Could not access canvas storage' }
  }
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
      <CommandPalette />
    </ReactFlowProvider>
  )
}

function Canvas() {
  const { preference, theme, setPreference } = useTheme()
  const [stored] = useState(loadSaved)
  const saved = useMemo(() => stored.kind === 'loaded' ? documentToCanvas(stored.document) : null, [stored])
  const [metadata, setMetadata] = useState<ThreadMetadata>(() => {
    if (stored.kind !== 'loaded') return createThreadMetadata()
    const { threadId, title, createdAt, updatedAt } = stored.document
    return { threadId, title, createdAt, updatedAt }
  })
  const [viewport, setViewport] = useState(saved?.viewport ?? { x: 0, y: 0, zoom: 1 })
  const [autosaveBlocked, setAutosaveBlocked] = useState(stored.kind === 'error')
  const [persistenceError, setPersistenceError] = useState(stored.kind === 'error' ? stored.message : null)
  const [nodes, setNodes, onNodesChange] = useNodesState<LVNode>(saved?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(saved?.edges ?? [])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('') // '' = pi default
  const [zen, setZen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const hoveredNodeRef = useRef<string | null>(null)
  const deletionHistory = useRef<CanvasGraph[]>([])
  const helpFocusRef = useRef<HTMLElement | null>(null)
  const { screenToFlowPosition, getZoom, getViewport, setCenter } = useReactFlow()

  const openHelp = useCallback(() => {
    helpFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setHelpOpen(true)
  }, [])
  const closeHelp = useCallback(() => {
    setHelpOpen(false)
    helpFocusRef.current?.focus({ preventScroll: true })
  }, [])

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const aborts = useRef(new Map<string, AbortController>())

  /* ---------- provider → model selection ---------- */
  const providers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of models) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [models])

  // selectedModel is always "provider/model-id" or '' (pi default), so the
  // active provider is just the segment before the first slash.
  const selectedProvider = selectedModel ? selectedModel.slice(0, selectedModel.indexOf('/')) : ''
  const providerModels = useMemo(
    () => models.filter((m) => m.provider === selectedProvider),
    [models, selectedProvider],
  )
  const pickProvider = useCallback(
    (provider: string) => {
      if (!provider) {
        setSelectedModel('')
        return
      }
      // Selecting a provider immediately picks its first model — the model
      // dropdown then narrows to that provider alone.
      const first = models.find((m) => m.provider === provider)
      setSelectedModel(first ? first.id : '')
    },
    [models],
  )

  /* ---------- persistence (debounced) ---------- */
  useEffect(() => {
    if (autosaveBlocked) return
    const t = setTimeout(() => {
      try {
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(metadata.updatedAt))).toISOString()
        saveCanvas(localStorage, canvasToDocument(
          { nodes, edges, viewport: getViewport() },
          { ...metadata, updatedAt },
        ))
        setPersistenceError(null)
      } catch (error) {
        setPersistenceError(error instanceof Error ? error.message : 'Could not save canvas')
      }
    }, 400)
    return () => clearTimeout(t)
  }, [nodes, edges, viewport, metadata, autosaveBlocked, getViewport])

  /* ---------- model list ---------- */
  useEffect(() => {
    fetchModels().then(setModels).catch(() => {})
  }, [])

  // The bridge may restart (with a different extension-registered model set)
  // while this tab stays open — refetch when the user returns to the window.
  useEffect(() => {
    const onFocus = () => {
      fetchModels().then(setModels).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  /* ---------- starter card on a fresh canvas ---------- */
  useEffect(() => {
    if (stored.kind !== 'empty') return
    const t = setTimeout(() => {
      setNodes((ns) =>
        ns.length
          ? ns
          : [
              {
                id: crypto.randomUUID(),
                type: 'prompt',
                dragHandle: '.card-head',
                position: { x: -140, y: 0 },
                data: { kind: 'prompt', text: '', sent: false, collapsed: false, focus: true },
              } satisfies PromptNode,
            ],
      )
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- node helpers ---------- */
  const patchNode = useCallback(
    (id: string, patch: Partial<(PromptNode | ResponseNode)['data']>) => {
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id) return n
          const next = { ...n, data: { ...n.data, ...patch } } as LVNode
          // Keep the saved expanded height without forcing a collapsed card
          // to fill it. User-saved width stays applied in either state.
          if (patch.collapsed !== undefined) {
            next.style = {
              ...next.style,
              height: patch.collapsed ? undefined : next.data.height,
            }
          }
          return next
        }),
      )
    },
    [setNodes],
  )

  const removeNode = useCallback(
    (id: string) => {
      const deleted = captureDeletion({ nodes: nodesRef.current, edges: edgesRef.current }, id)
      if (!deleted) return
      deletionHistory.current.push(deleted)
      if (deletionHistory.current.length > 50) deletionHistory.current.shift()
      const doomed = new Set(deleted.nodes.map((node) => node.id))
      const doomedEdges = new Set(deleted.edges.map((edge) => edge.id))
      if (hoveredNodeRef.current && doomed.has(hoveredNodeRef.current)) hoveredNodeRef.current = null
      for (const d of doomed) {
        aborts.current.get(d)?.abort()
        aborts.current.delete(d)
      }
      // Keep refs current for consecutive delete/undo events before React renders.
      nodesRef.current = nodesRef.current.filter((node) => !doomed.has(node.id))
      edgesRef.current = edgesRef.current.filter((edge) => !doomedEdges.has(edge.id))
      setNodes((ns) => ns.filter((n) => !doomed.has(n.id)))
      setEdges((es) => es.filter((e) => !doomedEdges.has(e.id)))
    },
    [setNodes, setEdges],
  )

  const undoDeletion = useCallback(() => {
    const deleted = deletionHistory.current.pop()
    if (!deleted) return
    const restored = restoreDeletion({ nodes: nodesRef.current, edges: edgesRef.current }, deleted)
    nodesRef.current = restored.nodes
    edgesRef.current = restored.edges
    setNodes((ns) => restoreDeletion({ nodes: ns, edges: [] }, deleted).nodes)
    setEdges((es) => restoreDeletion({ nodes: restored.nodes, edges: es }, deleted).edges)
  }, [setNodes, setEdges])

  /* ---------- canvas shortcuts ---------- */
  useEffect(() => {
    const unsubscribe = tinykeys(window, {
      x: (event) => {
        const id = hoveredNodeRef.current
        if (!id) return
        event.preventDefault()
        removeNode(id)
      },
      '[Shift]+?': (event) => {
        event.preventDefault()
        openHelp()
      },
      z: (event) => {
        event.preventDefault()
        setZen((value) => !value)
      },
      '$mod+z': (event) => {
        if (!deletionHistory.current.length) return
        event.preventDefault()
        undoDeletion()
      },
    }, {
      ignore: (event) => defaultKeybindingsHandlerIgnore(event) ||
        (event.target instanceof HTMLElement && event.target.isContentEditable) ||
        document.querySelector('dialog[open]') !== null,
    })
    const clearHover = () => { hoveredNodeRef.current = null }
    window.addEventListener('blur', clearHover)
    return () => {
      unsubscribe()
      window.removeEventListener('blur', clearHover)
    }
  }, [openHelp, removeNode, undoDeletion])

  const addPromptNode = useCallback(
    (position: XYPosition, focus = false, quote?: string) => {
      const id = crypto.randomUUID()
      const node: PromptNode = {
        id,
        type: 'prompt',
        dragHandle: '.card-head',
        position,
        data: { kind: 'prompt', text: '', sent: false, collapsed: false, focus, quote },
      }
      setNodes((ns) => [...ns, node])
      return id
    },
    [setNodes],
  )

  const newPrompt = useCallback(() => {
    const p = screenToFlowPosition({ x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 60 })
    addPromptNode(p, true)
  }, [screenToFlowPosition, addPromptNode])

  /* ---------- conversation graph ---------- */

  /** Walk from a prompt card up to the root, collecting [user, assistant] pairs.
   *  Parent edges are either response→prompt (branched from an answer) or
   *  prompt→prompt (branched from a quoted part of a prompt). */
  const buildChain = useCallback((promptId: string): ChatMsg[] => {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
    const es = edgesRef.current
    const msgs: ChatMsg[] = []
    let cur: string | undefined = promptId
    let guard = 0
    while (cur && guard++ < 1000) {
      const node = byId.get(cur)
      if (!node) break
      if (node.type === 'prompt') {
        const d = node.data
        const userContent =
          (d.quote ? `Regarding this excerpt from the previous message:\n"${d.quote}"\n\n` : '') +
          (d.text.trim() || '(empty question)')
        msgs.push({ role: 'user', content: userContent })
        const inEdge = es.find((e) => e.target === node.id)
        const src = inEdge ? byId.get(inEdge.source) : undefined
        cur = src?.type === 'response' || src?.type === 'prompt' ? src.id : undefined
      } else {
        const d = (node as ResponseNode).data
        msgs.push({ role: 'assistant', content: d.text || '(no answer recorded)' })
        cur = d.sourcePromptId
      }
    }
    return msgs.reverse()
  }, [])

  /** Create the response card for a prompt and stream into it. */
  const startResponse = useCallback(
    (prompt: PromptNode, messages: ChatMsg[]) => {
      const promptId = prompt.id
      // Continue away from the parent instead of overlapping it when the
      // prompt was added to the left or above its source card.
      const incoming = edgesRef.current.find(e => e.target === promptId)
      const side = responseSide(incoming?.targetHandle)
      const siblings = edgesRef.current.filter(e => e.source === promptId && e.sourceHandle === SOURCE_HANDLES[side]).length
      const layout = attachmentLayout(
        {
          ...prompt.position,
          width: prompt.measured?.width ?? 280,
          height: prompt.measured?.height ?? 160,
        },
        side,
        // A normal answer can grow to a 400px body plus header. Reserve that
        // space above the prompt so upward-streaming answers don't cover it.
        { width: 340, height: 440 },
        siblings * 80,
      )

      const respId = crypto.randomUUID()
      const model = selectedModelRef.current
      const resp: ResponseNode = {
        id: respId,
        type: 'response',
        dragHandle: '.card-head',
        position: layout.position,
        data: {
          kind: 'response',
          text: '',
          model: model || 'pi default',
          status: 'streaming',
          collapsed: false,
          sourcePromptId: promptId,
        },
      }
      setNodes((ns) => [...ns, resp])
      setEdges((es) => [
        ...es,
        {
          id: `e-${promptId}-${respId}`,
          source: promptId,
          target: respId,
          sourceHandle: layout.sourceHandle,
          targetHandle: layout.targetHandle,
          animated: true,
        },
      ])

      const ac = new AbortController()
      aborts.current.set(respId, ac)

      let pending = ''
      let raf = 0
      const flush = () => {
        raf = 0
        if (!pending) return
        const chunk = pending
        pending = ''
        setNodes((ns) =>
          ns.map((n) =>
            n.id === respId && n.type === 'response'
              ? { ...n, data: { ...n.data, text: (n.data as ResponseData).text + chunk } }
              : n,
          ),
        )
      }
      const finish = (status: 'done' | 'error' | 'stopped', message?: string) => {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        flush()
        aborts.current.delete(respId)
        setNodes((ns) =>
          ns.map((n) =>
            n.id === respId && n.type === 'response'
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status,
                    activity: undefined,
                    text:
                      status === 'error'
                        ? (n.data as ResponseData).text + `\n\n⚠️ ${message}`
                        : (n.data as ResponseData).text,
                  },
                }
              : n,
          ),
        )
        setEdges((es) => es.map((e) => (e.target === respId ? { ...e, animated: false } : e)))
      }

      streamChat({
        model,
        messages,
        signal: ac.signal,
        onDelta(t) {
          pending += t
          if (!raf) raf = requestAnimationFrame(flush)
        },
        onTool(name, phase) {
          patchNode(respId, { activity: phase === 'start' ? `🔎 ${name}…` : undefined })
        },
        onDone() {
          finish('done')
        },
        onError(msg) {
          finish('error', msg)
        },
      })
    },
    [setEdges, setNodes],
  )

  const sendPrompt = useCallback(
    (promptId: string) => {
      const prompt = nodesRef.current.find((n) => n.id === promptId)
      if (!prompt || prompt.type !== 'prompt' || !prompt.data.text.trim()) return
      const messages = buildChain(promptId)
      patchNode(promptId, { sent: true, collapsed: true, focus: false })
      startResponse(prompt, messages)
    },
    [buildChain, patchNode, startResponse],
  )

  /** Both text selections and hover + buttons create real connected drafts.
   *  A response starts only when that draft is sent. */
  const addAttachedPrompt = useCallback(
    (sourceId: string, port: ContinuationPort, quote?: string) => {
      const source = nodesRef.current.find((n) => n.id === sourceId)
      if (!source) return
      const siblings = edgesRef.current.filter(e => e.source === sourceId && e.sourceHandle === SOURCE_HANDLES[port]).length
      const layout = attachmentLayout(
        {
          ...source.position,
          width: source.measured?.width ?? (source.type === 'prompt' ? 280 : 340),
          height: source.measured?.height ?? 160,
        },
        port,
        { width: 280, height: quote ? 240 : 160 },
        siblings * 260,
      )
      const promptId = crypto.randomUUID()
      const promptNode: PromptNode = {
        id: promptId,
        type: 'prompt',
        dragHandle: '.card-head',
        position: layout.position,
        data: {
          kind: 'prompt',
          text: '',
          sent: false,
          collapsed: false,
          quote: quote?.trim(),
          focus: true,
        },
      }
      const parentEdge: Edge = {
        id: `e-${sourceId}-${promptId}`,
        source: sourceId,
        target: promptId,
        sourceHandle: layout.sourceHandle,
        targetHandle: layout.targetHandle,
      }
      setNodes((ns) => [...ns, promptNode])
      setEdges((es) => [...es, parentEdge])
      void setCenter(promptNode.position.x + 140, promptNode.position.y + 120, {
        zoom: getZoom(),
        duration: 200,
      })
    },
    [getZoom, setCenter, setEdges, setNodes],
  )

  const branchPrompt = useCallback(
    (sourceId: string, quote: string) => {
      if (quote.trim()) addAttachedPrompt(sourceId, 'right', quote)
    },
    [addAttachedPrompt],
  )

  const resizeNode = useCallback(
    (id: string, width: number, height: number) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? ({
                ...n,
                style: { ...n.style, width, height },
                data: { ...n.data, width, height },
              } as LVNode)
            : n,
        ),
      )
    },
    [setNodes],
  )

  const stopStream = useCallback(
    (respId: string) => {
      aborts.current.get(respId)?.abort()
      aborts.current.delete(respId)
      setNodes((ns) =>
        ns.map((n) =>
          n.id === respId && n.type === 'response'
            ? { ...n, data: { ...n.data, status: 'stopped', activity: undefined } }
            : n,
        ),
      )
      setEdges((es) => es.map((e) => (e.target === respId ? { ...e, animated: false } : e)))
    },
    [setEdges, setNodes],
  )

  /* ---------- actions ---------- */
  const actions: AppActions = useMemo(
    () => ({
      patchNode,
      updatePrompt: patchNode,
      removeNode,
      sendPrompt,
      branchPrompt,
      continuePrompt: addAttachedPrompt,
      resizeNode,
      stopStream,
      newPrompt,
      models,
      selectedModel,
      setSelectedModel,
    }),
    [patchNode, removeNode, sendPrompt, branchPrompt, addAttachedPrompt, resizeNode, stopStream, newPrompt, models, selectedModel],
  )

  return (
    <AppCtx.Provider value={actions}>
      <div className="canvas-wrap" onMouseLeave={() => { hoveredNodeRef.current = null }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          colorMode={theme}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeMouseEnter={(_, node) => { hoveredNodeRef.current = node.id }}
          onNodeMouseLeave={(_, node) => {
            if (hoveredNodeRef.current === node.id) hoveredNodeRef.current = null
          }}
          nodesConnectable={false}
          deleteKeyCode={null}
          defaultViewport={saved?.viewport}
          onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
          fitView={!saved}
          minZoom={saved ? Math.min(0.2, saved.viewport.zoom) : 0.2}
          maxZoom={saved ? Math.max(2, saved.viewport.zoom) : 2}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
          <Controls showInteractive={false} style={zen ? { display: 'none' } : undefined} />
          <MiniMap pannable zoomable style={zen ? { display: 'none' } : undefined} />
          <Panel position="top-left" className="canvas-controls" style={zen ? { display: 'none' } : undefined}>
            <div className="toolbar">
              <button className="primary" onClick={newPrompt}>
                ＋ New prompt
              </button>
              <select
                value={selectedProvider}
                onChange={(e) => pickProvider(e.target.value)}
                title="Provider"
              >
                <option value="">pi default</option>
                {providers.map(([p, count]) => (
                  <option key={p} value={p}>
                    {p} ({count})
                  </option>
                ))}
              </select>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={!selectedProvider}
                title="Model used for new responses"
              >
                {selectedProvider ? (
                  providerModels.map((m) => (
                    <option key={m.id} value={m.id} title={m.id}>
                      {m.name}
                    </option>
                  ))
                ) : (
                  <option value="">pi default</option>
                )}
              </select>
              <select
                title="Theme"
                aria-label="Theme"
                value={preference}
                onChange={(e) => setPreference(parseThemePreference(e.target.value))}
              >
                <option value="system">Theme: System</option>
                <option value="light">Theme: Light</option>
                <option value="dark">Theme: Dark</option>
              </select>
              <button
                className="ghost"
                onClick={() => {
                  if (confirm(autosaveBlocked ? 'Discard the unreadable saved document and start a new canvas?' : 'Clear the whole canvas?')) {
                    setMetadata(createThreadMetadata())
                    setAutosaveBlocked(false)
                    setPersistenceError(null)
                    deletionHistory.current = []
                    hoveredNodeRef.current = null
                    for (const [id, ac] of aborts.current) {
                      ac.abort()
                      aborts.current.delete(id)
                    }
                    setNodes([])
                    setEdges([])
                    addPromptNode({ x: -140, y: 0 }, true)
                  }
                }}
              >
                Clear
              </button>
            </div>
            {persistenceError && (
              <div role="alert" className="extension-error">
                {autosaveBlocked
                  ? `Saved canvas could not be loaded: ${persistenceError}. Autosave is disabled to preserve it. Use Clear to discard it explicitly.`
                  : `Canvas could not be saved: ${persistenceError}. Your latest changes are not persisted.`}
              </div>
            )}
            <ExtensionsPanel />
          </Panel>
          <Panel position="top-right" style={zen ? { display: 'none' } : undefined}>
            <HelpButton onOpen={openHelp} />
          </Panel>
        </ReactFlow>
      </div>
      {helpOpen && <HelpDialog theme={theme} onClose={closeHelp} />}
    </AppCtx.Provider>
  )
}
