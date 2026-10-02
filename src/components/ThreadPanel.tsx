import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ThreadWorkspace } from '../lib/threadWorkspace'

export function ThreadPanel({ workspace, onClose }: { workspace: ThreadWorkspace; onClose(): void }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const [title, setTitle] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { dialog.current?.showModal() }, [])
  const perform = (operation: Promise<unknown>) => { void operation.catch(() => {}) }
  return (
    <dialog ref={dialog} className="thread-panel nodrag nopan nowheel" aria-labelledby="threads-title" onCancel={event => { event.preventDefault(); onClose() }}>
      <header className="help-dialog-head">
        <h2 id="threads-title">Learning threads</h2>
        <button className="ghost" onClick={onClose}>Close ×</button>
      </header>
      <div className="thread-panel-body">
        <p role="status">{state.active?.document.title ?? 'No active thread'} · {state.status}</p>
        {state.error && <div role="alert" className="extension-error">{state.error}. Your canvas remains available. Retry saving, or save a recovery copy with a new title. Conflicts never overwrite a newer revision.</div>}
        {!state.ready && <button className="ghost" disabled={state.busy} onClick={() => perform(workspace.start(null))}>Retry loading library</button>}
        <form onSubmit={event => { event.preventDefault(); perform(workspace.create(title)); }}>
          <label htmlFor="thread-title">Thread title</label>
          <input id="thread-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Neural networks" />
          <div className="thread-actions">
            <button className="primary" disabled={!title.trim() || state.busy || !state.ready}>New thread</button>
            <button type="button" className="ghost" disabled={!title.trim() || state.busy || !state.active} onClick={() => perform(workspace.rename(title))}>Rename active</button>
            <button type="button" className="ghost" disabled={!title.trim() || state.busy || !state.active} onClick={() => perform(workspace.recoverCopy(title))}>Save recovery copy</button>
          </div>
        </form>
        <div className="thread-actions">
          <button className="ghost" disabled={state.busy || !state.active} onClick={() => perform(workspace.retry())}>Retry save</button>
          <button className="ghost" disabled={state.busy || !state.active} onClick={() => { if (confirm('Move the active thread to Trash? It can be restored.')) perform(workspace.trashActive()) }}>Trash active</button>
          <button className="ghost" disabled={state.busy} onClick={() => perform(workspace.reload())}>Refresh list</button>
        </div>
        <nav aria-label="Saved learning threads">
          <ul className="thread-list">{state.threads.threads.map(thread => (
            <li key={thread.threadId}><button className="ghost" aria-current={state.active?.document.threadId === thread.threadId ? 'true' : undefined} disabled={state.busy} onClick={() => perform(workspace.select(thread.threadId))}>{thread.title}<small>{thread.filename}</small></button></li>
          ))}</ul>
        </nav>
        {!state.threads.threads.length && <p>No saved threads. Enter a title to create one.</p>}
        <button className="ghost" aria-expanded={showTrash} onClick={() => setShowTrash(!showTrash)}>Trash ({state.trash.threads.length})</button>
        {showTrash && <ul className="thread-list">{state.trash.threads.map(thread => <li key={thread.threadId}><span>{thread.title}</span> <button className="ghost" disabled={state.busy} onClick={() => perform(workspace.restore(thread.threadId, thread.revision))}>Restore {thread.title}</button></li>)}</ul>}
        {[...state.threads.warnings, ...state.trash.warnings].map((warning, index) => <p className="extension-warning" key={index}>{warning.filename}: {warning.message}</p>)}
        <p className="extensions-note">Switching stops generation and saves partial answers. Tab to a thread and press Enter to open it. Esc closes this panel. Undo history resets on switch.</p>
      </div>
    </dialog>
  )
}
