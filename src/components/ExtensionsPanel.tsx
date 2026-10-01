import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchExtensions,
  type ExtensionInfo,
  type ExtensionInventory,
  type ExtensionLoadReport,
} from '../lib/api'

function ExtensionEntry({ extension }: { extension: ExtensionInfo }) {
  return (
    <details className="extension-entry">
      <summary>
        <strong>{extension.name}</strong>
        {extension.scope && <span className="hint">{extension.scope}</span>}
      </summary>
      <div className="extension-meta">
        {extension.source && <div>Source: <code>{extension.source}</code></div>}
        <div>Path: <code>{extension.path}</code></div>
        {extension.tools.length > 0 && <div>Registered tools: {extension.tools.join(', ')}</div>}
        {extension.commands.length > 0 && <div>Commands: {extension.commands.map((c) => `/${c}`).join(', ')}</div>}
        {extension.events.length > 0 && <div>Event hooks: {extension.events.join(', ')}</div>}
      </div>
    </details>
  )
}

function LoadDiagnostics({ report }: { report: ExtensionLoadReport }) {
  return (
    <>
      {report.error && <p className="extension-error" role="alert">Session initialization: {report.error}</p>}
      {report.errors.map((item, i) => (
        <div key={`${item.path}-${i}`} className="extension-error">
          <strong>Load error</strong>: {item.error}
          <code>{item.path}</code>
        </div>
      ))}
      {report.warnings.map((item, i) => (
        <div key={`${item.path}-${i}`} className="extension-warning">
          <strong>Warning</strong>: {item.warning}
          <code>{item.path}</code>
        </div>
      ))}
    </>
  )
}

export function ExtensionsPanel() {
  const [inventory, setInventory] = useState<ExtensionInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const requestRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    setLoading(true)
    setError(null)
    try {
      const result = await fetchExtensions(request.signal)
      if (!request.signal.aborted) setInventory(result)
    } catch (e) {
      if (!request.signal.aborted) setError(String((e as Error).message))
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => {
      if (detailsRef.current?.open) void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      requestRef.current?.abort()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const tutor = inventory?.tutor

  return (
    <details
      ref={detailsRef}
      className="extensions-panel nodrag nopan nowheel"
      onToggle={(e) => { if (e.currentTarget.open) void refresh() }}
    >
      <summary>
        Extensions
        <span className="hint">
          {loading ? 'Loading…' : inventory ? `${inventory.startup.extensions.length} startup` : 'Unavailable'}
        </span>
      </summary>
      <div className="extensions-body" aria-busy={loading}>
        <p className="extensions-note">Read-only. This does not enable extensions or change Pi settings.</p>
        {error && <p className="extension-error" role="alert">{error}</p>}
        {inventory && tutor && (
          <>
            <h3>Tutor sessions</h3>
            <div className="tutor-extension">
              <strong>{tutor.source}</strong>
              <span className="extension-status">{tutor.enabled ? 'Enabled for new responses' : 'Disabled'}</span>
            </div>
            {!tutor.enabled ? (
              <p className="extensions-note">Disabled by LEARNVAS_WEB_ACCESS=0. Tutor sessions have no tools.</p>
            ) : (
              <>
                <p className="extensions-note">Allowed tools: {tutor.tools.join(', ')}</p>
                {tutor.lastLoad ? (
                  <>
                    <p className="extensions-note">Last tutor session load:</p>
                    {tutor.lastLoad.extensions.map((extension) => (
                      <ExtensionEntry key={extension.path} extension={extension} />
                    ))}
                    {tutor.lastLoad.extensions.length === 0 && <p>No extensions loaded.</p>}
                    <LoadDiagnostics report={tutor.lastLoad} />
                  </>
                ) : (
                  <p className="extensions-note">Configured; not loaded in a tutor session yet. Loads when a response starts.</p>
                )}
              </>
            )}
            <h3>Startup-loaded ({inventory.startup.extensions.length})</h3>
            <p className="extensions-note">
              Loaded during bridge startup for provider/model registration, then that session is disposed.
              Only the tutor extensions above are loaded again for chats. This is a load snapshot, not every installed package.
            </p>
            {inventory.startup.extensions.map((extension) => (
              <ExtensionEntry key={extension.path} extension={extension} />
            ))}
            {inventory.startup.extensions.length === 0 && <p>No startup extensions loaded.</p>}
            <LoadDiagnostics report={inventory.startup} />
          </>
        )}
        <button className="ghost" disabled={loading} onClick={() => void refresh()}>
          Refresh inventory
        </button>
      </div>
    </details>
  )
}
