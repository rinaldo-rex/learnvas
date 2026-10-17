import { useEdges, useNodesData } from '@xyflow/react'
import { useApp } from '../actions'
import { sourceContext } from '../lib/mergeContext'
import type { LVEdge, LVNode, MergeContext } from '../types'

const scopeLabel = (scope: MergeContext) => scope === 'selected' ? 'Card only' : 'Card + history'
const excerpt = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line ? (line.length > 54 ? `${line.slice(0, 54)}…` : line) : 'Empty card'
}

export function MergeContextChoices({ id, scope, sent, collapsed }: { id: string; scope: MergeContext; sent: boolean; collapsed: boolean }) {
  const { updateMergeScope } = useApp()
  const incoming = useEdges<LVEdge>().filter(edge => edge.target === id)
  const sources = useNodesData<LVNode>(incoming.map(edge => edge.source))
  const scopes = incoming.map(edge => sourceContext(scope, edge))
  const mixed = new Set(scopes).size > 1
  const summary = mixed ? 'Mixed context' : scopes[0] === 'selected' ? 'Selected cards only' : 'Cards + histories'

  return <div className="merge-context nodrag nopan nowheel" onClick={event => event.stopPropagation()}>
    {sent ? <span className="merge-context-badge">{summary}</span> : <fieldset>
      <legend>Include for all sources</legend>
      <div className="merge-context-options">
        <button type="button" aria-pressed={!mixed && scopes[0] === 'selected'} onClick={() => updateMergeScope(id, 'selected')}>Selected cards only</button>
        <button type="button" aria-pressed={!mixed && scopes[0] === 'histories'} onClick={() => updateMergeScope(id, 'histories')}>Cards + histories</button>
      </div>
      <p>Adjust each source below. Shared history appears once.</p>
    </fieldset>}
    {!collapsed && <ul className="merge-source-list" aria-label="Merge sources">
      {incoming.map((edge, index) => {
        const source = sources.find(node => node.id === edge.source)
        const label = `${index + 1}. ${source?.type === 'response' ? 'Answer' : 'Question'}: ${excerpt(source?.data.text ?? '')}`
        const context = sourceContext(scope, edge)
        return <li key={edge.id}>
          <label>
            <span className="merge-source-label" title={source?.data.text}>{label}</span>
            {sent ? <span className="merge-source-scope">{scopeLabel(context)}</span> : <select
              aria-label={`Context for ${label}`}
              value={context}
              onChange={event => updateMergeScope(id, event.target.value as MergeContext, edge.source)}
            >
              <option value="selected">Card only</option>
              <option value="histories">Card + history</option>
            </select>}
          </label>
        </li>
      })}
    </ul>}
  </div>
}
