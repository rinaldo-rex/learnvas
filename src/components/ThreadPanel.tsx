import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ThreadWorkspace } from '../lib/threadWorkspace'
import { downloadPortable, readPortableFile } from '../lib/portableDocument'

export function ThreadPanel({ workspace, onClose }: { workspace: ThreadWorkspace; onClose(): void }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const [title, setTitle] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(true)
  const busy = state.busy || transferring
  useLayoutEffect(() => { mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false } }, [])
  const perform = (operation: Promise<unknown>) => { void operation.catch(() => {}) }
  const importFile = async (file: File) => {
    setTransferring(true); setTransferError(null); setNotice(null)
    try {
      const document = await readPortableFile(file)
      // Closing the panel while reading is a cancellation, not an import.
      if (!mounted.current) return
      const record = await workspace.importDocument(document, (kind, document) => mounted.current && confirm(kind === 'import'
        ? `Import “${document.title}” into the library? Your current canvas stays open.`
        : `This thread ID already exists (possibly in Trash). Import “${document.title}” as a separate copy with a new ID? The existing thread will not be changed.`))
      if (mounted.current) setNotice(record ? `Imported ${record.filename}. Select it below to open it. Your previous canvas is unchanged.` : 'Import cancelled. No document was added.')
    } catch (error) {
      if (mounted.current) setTransferError(error instanceof Error ? error.message : 'Could not import file')
    } finally { if (mounted.current) setTransferring(false) }
  }
  const exportActive = async () => {
    if (!confirm('Save the current canvas and export a portable copy? Active answers will be stopped; nothing is downloaded if saving fails.')) return
    setTransferring(true); setTransferError(null); setNotice(null)
    try {
      const exported = await workspace.exportActive()
      // Even if the panel closes, this explicitly requested download can complete.
      downloadPortable(exported)
      if (mounted.current) setNotice(`Exported the current saved state as ${exported.filename}.`)
    } catch (error) {
      if (mounted.current) setTransferError(error instanceof Error ? error.message : 'Could not export file')
    } finally { if (mounted.current) setTransferring(false) }
  }
  return (
    <dialog ref={dialog} className="thread-panel nodrag nopan nowheel" aria-labelledby="threads-title" onCancel={event => { event.preventDefault(); onClose() }}>
      <header className="help-dialog-head">
        <h2 id="threads-title">Learning threads</h2>
        <button className="ghost" onClick={onClose}>Close ×</button>
      </header>
      <div className="thread-panel-body">
        <p role="status">{state.active?.document.title ?? 'No active thread'} · {state.status}</p>
        {(transferError || state.error) && <div role="alert" className="extension-error">{transferError || state.error}. Your canvas remains available. Save errors can be retried or recovered with a new title. Conflicts never overwrite a newer revision.</div>}
        {!state.ready && <button className="ghost" disabled={busy} onClick={() => perform(workspace.start(null))}>Retry loading library</button>}
        <form onSubmit={event => { event.preventDefault(); perform(workspace.create(title)); }}>
          <label htmlFor="thread-title">Thread title</label>
          <input id="thread-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Neural networks" />
          <div className="thread-actions">
            <button className="primary" disabled={!title.trim() || busy || !state.ready}>New thread</button>
            <button type="button" className="ghost" disabled={!title.trim() || busy || !state.active} onClick={() => perform(workspace.rename(title))}>Rename active</button>
            <button type="button" className="ghost" disabled={!title.trim() || busy || !state.active} onClick={() => perform(workspace.recoverCopy(title))}>Save recovery copy</button>
          </div>
        </form>
        <div className="thread-actions">
          <button className="ghost" disabled={busy || !state.active} onClick={() => perform(workspace.retry())}>Retry save</button>
          <button className="ghost" disabled={busy || !state.active} onClick={() => { if (confirm('Move the active thread to Trash? It can be restored.')) perform(workspace.trashActive()) }}>Trash active</button>
          <button className="ghost" disabled={busy} onClick={() => perform(workspace.reload())}>Refresh list</button>
        </div>
        <section aria-label="Portable documents">
          <div className="thread-actions">
            <button className="ghost" disabled={busy || !state.ready} onClick={() => fileInput.current?.click()}>Import .learn</button>
            <button className="ghost" disabled={busy || !state.active} onClick={() => { void exportActive() }}>Save and export active</button>
          </div>
          <input ref={fileInput} type="file" accept=".learn,application/json" aria-label="Import portable document" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importFile(file)
          }} />
          <p className="extensions-note">Up to 8 MiB. Files preserve text, branches, drafts, quotes, layout, sizes, and view—not model credentials, live requests, or undo history. Text is not redacted. Opening an import never starts generation. Exports save first and stop active answers. The original uploaded file is never modified.</p>
          {notice && <p role="status">{notice}</p>}
        </section>
        <nav aria-label="Saved learning threads">
          <ul className="thread-list">{state.threads.threads.map(thread => (
            <li key={thread.threadId}><button className="ghost" aria-current={state.active?.document.threadId === thread.threadId ? 'true' : undefined} disabled={busy} onClick={() => perform(workspace.select(thread.threadId))}>{thread.title}<small>{thread.filename}</small></button></li>
          ))}</ul>
        </nav>
        {!state.threads.threads.length && <p>No saved threads. Enter a title to create one.</p>}
        <button className="ghost" aria-expanded={showTrash} onClick={() => setShowTrash(!showTrash)}>Trash ({state.trash.threads.length})</button>
        {showTrash && <ul className="thread-list">{state.trash.threads.map(thread => <li key={thread.threadId}><span>{thread.title}</span> <button className="ghost" disabled={busy} onClick={() => perform(workspace.restore(thread.threadId, thread.revision))}>Restore {thread.title}</button></li>)}</ul>}
        {[...state.threads.warnings, ...state.trash.warnings].map((warning, index) => <p className="extension-warning" key={index}>{warning.filename}: {warning.message}</p>)}
        <p className="extensions-note">Switching stops generation and saves partial answers. Tab to a thread and press Enter to open it. Esc closes this panel. Undo history resets on switch.</p>
      </div>
    </dialog>
  )
}
