import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { fetchModels, streamChat, type ModelInfo } from './lib/api'
import { PromptCard } from './nodes/PromptCard'
import { ResponseCard } from './nodes/ResponseCard'
import type { ChatMsg, LVNode, PromptNode, ResponseData, ResponseNode } from './types'

const nodeTypes = { prompt: PromptCard, response: ResponseCard }
const STORE_KEY = 'learnvas:v1'

function loadSaved(): { nodes: LVNode[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as { nodes?: LVNode[]; edges?: Edge[] }
    if (!Array.isArray(j.nodes) || !Array.isArray(j.edges)) return null
    // A reload mid-stream leaves stale status; normalize.
    for (const n of j.nodes) {
      if (n.type === 'response') {
        const d = n.data as ResponseData
        if (d.status === 'streaming') d.status = 'stopped'
        d.activity = undefined
      }
      n.selected = false
    }
    for (const e of j.edges) e.animated = false
    return { nodes: j.nodes, edges: j.edges }
  } catch {
    return null
  }
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  )
}

function Canvas() {
  const saved = useMemo(loadSaved, [])
  const [nodes, setNodes, onNodesChange] = useNodesState<LVNode>(saved?.nodes ?? [])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(saved?.edges ?? [])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModel, setSelectedModel] = useState('') // '' = pi default
  const { screenToFlowPosition } = useReactFlow()

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
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORE_KEY,
          JSON.stringify({
            nodes: nodes.map((n) =>
              n.type === 'response' && (n.data as ResponseData).status === 'streaming'
                ? { ...n, data: { ...n.data, status: 'stopped', activity: undefined } }
                : n,
            ),
            edges,
          }),
        )
      } catch {
        /* storage full / private mode — canvas still works, just not persisted */
      }
    }, 400)
    return () => clearTimeout(t)
  }, [nodes, edges])

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
    if (saved) return
    const t = setTimeout(() => {
      setNodes((ns) =>
        ns.length
          ? ns
          : [
              {
                id: crypto.randomUUID(),
                type: 'prompt',
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
        ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as LVNode) : n)),
      )
    },
    [setNodes],
  )

  const removeNode = useCallback(
    (id: string) => {
      // Cascade: deleting a node removes everything downstream of it.
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const e of edgesRef.current) {
          if (doomed.has(e.source) && !doomed.has(e.target)) {
            doomed.add(e.target)
            grew = true
          }
        }
      }
      for (const d of doomed) {
        aborts.current.get(d)?.abort()
        aborts.current.delete(d)
      }
      setNodes((ns) => ns.filter((n) => !doomed.has(n.id)))
      setEdges((es) => es.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)))
    },
    [setNodes, setEdges],
  )

  const addPromptNode = useCallback(
    (position: XYPosition, focus = false, quote?: string) => {
      const id = crypto.randomUUID()
      const node: PromptNode = {
        id,
        type: 'prompt',
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

  /** Walk from a prompt card up to the root, collecting [user, assistant] pairs. */
  const buildChain = useCallback((promptId: string): ChatMsg[] => {
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
    const es = edgesRef.current
    type Seg = { promptText: string; quote?: string; responseText?: string }
    const segs: Seg[] = []
    let curId: string | undefined = promptId
    let guard = 0
    while (curId && guard++ < 1000) {
      const prompt = byId.get(curId)
      if (!prompt || prompt.type !== 'prompt') break
      const d = prompt.data
      const parentEdge = es.find((e) => e.target === prompt.id && byId.get(e.source)?.type === 'response')
      const response = parentEdge ? (byId.get(parentEdge.source) as ResponseNode | undefined) : undefined
      segs.push({ promptText: d.text, quote: d.quote, responseText: response?.data.text })
      curId = response?.data.sourcePromptId
    }
    segs.reverse()
    const msgs: ChatMsg[] = []
    for (const s of segs) {
      const userContent =
        (s.quote ? `Regarding this excerpt from the previous answer:\n"${s.quote}"\n\n` : '') +
        (s.promptText.trim() || '(empty question)')
      msgs.push({ role: 'user', content: userContent })
      if (s.responseText !== undefined) {
        msgs.push({ role: 'assistant', content: s.responseText || '(no answer recorded)' })
      }
    }
    return msgs
  }, [])

  const sendPrompt = useCallback(
    (promptId: string, opts?: { rerun?: boolean }) => {
      const prompt = nodesRef.current.find((n) => n.id === promptId)
      if (!prompt || prompt.type !== 'prompt' || !prompt.data.text.trim()) return
      const messages = buildChain(promptId)

      patchNode(promptId, { sent: true, collapsed: true, focus: false })

      // Stack multiple responses of the same prompt vertically.
      const siblings = edgesRef.current.filter((e) => e.source === promptId).length
      const pw = prompt.measured?.width ?? 280
      const position = {
        x: prompt.position.x + pw + 90,
        y: prompt.position.y + siblings * 80,
      }

      const respId = crypto.randomUUID()
      const model = selectedModelRef.current
      const resp: ResponseNode = {
        id: respId,
        type: 'response',
        position,
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
          sourceHandle: 's',
          targetHandle: 't',
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
    [buildChain, patchNode, setEdges, setNodes],
  )

  const branchFrom = useCallback(
    (responseId: string, quote: string) => {
      const resp = nodesRef.current.find((n) => n.id === responseId)
      if (!resp || resp.type !== 'response') return
      const rw = resp.measured?.width ?? 340
      const promptId = addPromptNode(
        { x: resp.position.x + rw + 90, y: resp.position.y - 10 },
        true,
        quote,
      )
      setEdges((es) => [
        ...es,
        {
          id: `e-${responseId}-${promptId}`,
          source: responseId,
          target: promptId,
          sourceHandle: 's',
          targetHandle: 't',
        },
      ])
    },
    [addPromptNode, setEdges],
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
      branchFrom,
      resizeNode,
      stopStream,
      newPrompt,
      models,
      selectedModel,
      setSelectedModel,
    }),
    [patchNode, removeNode, sendPrompt, branchFrom, resizeNode, stopStream, newPrompt, models, selectedModel],
  )

  return (
    <AppCtx.Provider value={actions}>
      <div className="canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#d9d6cf" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable bgColor="#f4f3ef" maskColor="rgba(240,239,236,.85)" nodeColor="#cfcabe" />
          <Panel position="top-left">
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
              <button
                className="ghost"
                onClick={() => {
                  if (confirm('Clear the whole canvas?')) {
                    for (const [id, ac] of aborts.current) {
                      ac.abort()
                      aborts.current.delete(id)
                    }
                    setNodes([])
                    setEdges([])
                    localStorage.removeItem(STORE_KEY)
                    addPromptNode({ x: -140, y: 0 }, true)
                  }
                }}
              >
                Clear
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </AppCtx.Provider>
  )
}
