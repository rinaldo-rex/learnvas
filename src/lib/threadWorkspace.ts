import { createThreadMetadata, LEARN_VERSION, validateDocument, type LearnDocument } from './learnDocument.ts'
import { ThreadApiError, type ThreadApi, type ThreadList, type ThreadRecord } from './threadApi.ts'
import { portableExport, validatePortableDocument } from './portableDocument.ts'

export const LAST_THREAD_KEY = 'learnvas:last-thread'
export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
interface CanvasBinding { snapshot(): LearnDocument; stop(): void }
interface WorkspaceState {
  active: ThreadRecord | null
  threads: ThreadList
  trash: ThreadList
  status: SaveStatus
  error: string | null
  busy: boolean
  ready: boolean
}
const emptyList = (): ThreadList => ({ threads: [], warnings: [] })
const content = (d: LearnDocument) => JSON.stringify({ ...d, updatedAt: '' })

/** Serializes mutations and owns revisions. Canvas bindings never survive a thread switch. */
export class ThreadWorkspace {
  private state: WorkspaceState = { active: null, threads: emptyList(), trash: emptyList(), status: 'loading', error: null, busy: false, ready: false }
  /** Metadata-only overlay (tutor notes) merged into captures until a save lands. */
  private metadataOverride: Partial<LearnDocument> | null = null
  private listeners = new Set<() => void>()
  private binding: CanvasBinding | null = null
  private pending: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private startup: Promise<void> | undefined
  private api: ThreadApi
  private remember: (id: string | null) => void
  private confirmFilename: (filename: string) => boolean | Promise<boolean>
  constructor(api: ThreadApi, remember: (id: string | null) => void = () => {}, confirmFilename: (filename: string) => boolean | Promise<boolean> = () => false) {
    this.api = api
    this.remember = remember
    this.confirmFilename = confirmFilename
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  bind(id: string, binding: CanvasBinding) {
    if (this.state.active?.document.threadId !== id) return () => {}
    this.binding = binding
    return () => { if (this.binding === binding) this.binding = null }
  }
  private capture() {
    const active = this.state.active!.document
    const snapshot = this.binding?.snapshot() ?? active
    // The override carries in-flight metadata edits (per-thread tutor notes).
    // A spread alone cannot express "key removed": patchMetadata('') stores
    // the explicit empty string, and here that strips any snapshot notes so
    // the validated document simply omits the field. It is never cleared
    // after save: the saved value equals the override, and clearing early
    // raced the next snapshot into resurrecting the pre-edit value.
    const dropping = this.metadataOverride?.tutorNotes === ''
    const body = dropping
      ? (() => { const { tutorNotes: _gone, ...rest } = snapshot; return rest })()
      : snapshot
    const { tutorNotes: overrideNotes, ...overrideRest } = this.metadataOverride ?? {}
    return validateDocument({
      ...body,
      ...overrideRest,
      // '' means "removed": omit the key (the schema rejects empty strings).
      ...(dropping || (overrideNotes !== undefined && !overrideNotes.trim())
        ? {}
        : (overrideNotes !== undefined ? { tutorNotes: overrideNotes } : {})),
      threadId: active.threadId, title: active.title, createdAt: active.createdAt, updatedAt: active.updatedAt,
    })
  }
  /** Metadata-only edit (per-thread tutor notes); merges into every capture until saved. */
  patchMetadata(part: { tutorNotes: string }) {
    const active = this.state.active?.document
    if (!active) return
    if ((active.tutorNotes ?? '') === part.tutorNotes) return // idempotent: every keystroke routes here
    const override: Partial<LearnDocument> & { tutorNotes: string } = {
      threadId: active.threadId, title: active.title, createdAt: active.createdAt, updatedAt: active.updatedAt,
      tutorNotes: part.tutorNotes, // '' expresses deletion for capture()
    }
    this.metadataOverride = override
    // A conflict requires explicit retry/recovery, not background overwrites.
    if (this.state.status !== 'conflict' && this.state.status !== 'error') {
      this.patch({ status: 'unsaved' })
      this.cancelTimer()
      this.pending = setTimeout(() => { void this.retry().catch(() => {}) }, 400)
    }
  }
  private cancelTimer() { clearTimeout(this.pending); this.pending = undefined }
  private activate(record: ThreadRecord | null) {
    this.cancelTimer()
    this.binding = null
    this.metadataOverride = null
    this.patch({ active: record, status: 'saved', error: null })
    try { this.remember(record?.document.threadId ?? null) } catch { /* convenience only */ }
  }
  private failure(error: unknown) {
    this.patch({ status: error instanceof ThreadApiError && error.code === 'revision-conflict' ? 'conflict' : 'error', error: error instanceof Error ? error.message : 'Library operation failed' })
  }
  private run<T>(operation: () => Promise<T>, affectsCanvas = true): Promise<T> {
    if (affectsCanvas) this.cancelTimer()
    const result = this.queue.then(async () => {
      this.patch({ busy: true })
      try { return await operation() }
      catch (error) {
        if (affectsCanvas) this.failure(error)
        else this.patch({ error: error instanceof Error ? error.message : 'Library operation failed' })
        throw error
      }
      finally { this.patch({ busy: false }) }
    })
    this.queue = result.catch(() => {})
    return result
  }
  async refresh() {
    const [threads, trash] = await Promise.all([this.api.list(), this.api.list(true)])
    this.patch({ threads, trash })
  }
  reload() { return this.run(() => this.refresh(), false) }
  private async refreshAfterMutation() {
    try { await this.refresh() } catch (error) { this.patch({ error: error instanceof Error ? error.message : 'Could not refresh library list' }) }
  }
  start(lastId: string | null) {
    // StrictMode can invoke startup twice; never create duplicate threads.
    this.startup ??= this.run(async () => {
      await this.refresh()
      const id = this.state.threads.threads.some(thread => thread.threadId === lastId) ? lastId : this.state.threads.threads[0]?.threadId
      if (id) this.activate(await this.api.read(id))
      this.patch({ ready: true, status: 'saved' })
    }).catch(() => { this.startup = undefined })
    return this.startup
  }
  changed() {
    if (!this.state.active || !this.binding) return
    if (content(this.capture()) === content(this.state.active.document)) return
    // A conflict requires an explicit retry or recovery copy, not background overwrites.
    if (this.state.status === 'conflict' || this.state.status === 'error') return
    this.patch({ status: 'unsaved' })
    this.cancelTimer()
    this.pending = setTimeout(() => { void this.retry().catch(() => {}) }, 400)
  }
  private async flush(stop = false) {
    if (!this.state.active) return
    if (stop) this.binding?.stop()
    // Drain ongoing saves via run's queue before capturing the freshest canvas.
    const document = this.capture()
    const active = this.state.active
    if (content(document) === content(active.document)) { this.patch({ status: 'saved', error: null }); return }
    document.updatedAt = new Date(Math.max(Date.now(), Date.parse(active.document.updatedAt))).toISOString()
    this.patch({ status: 'saving' })
    const saved = await this.api.save(active.document.threadId, document, active.revision)
    this.patch({ active: saved, status: 'saved', error: null })
    // Edits made during the request are not marked saved.
    if (content(this.capture()) !== content(saved.document)) this.changed()
  }
  private async saveOutgoing() {
    await this.flush(true)
    if (this.state.active && content(this.capture()) !== content(this.state.active.document)) throw new Error('Canvas changed while saving; retry switching')
  }
  retry() { return this.run(async () => { await this.flush(); await this.refreshAfterMutation() }) }
  select(id: string) { return this.run(async () => {
    if (this.state.active?.document.threadId === id) return
    // Read before stopping/saving: a bad destination never replaces this canvas.
    const next = await this.api.read(id)
    await this.saveOutgoing()
    this.activate(next)
  }) }
  private async confirmed(operation: (filename?: string) => Promise<ThreadRecord | null>): Promise<ThreadRecord | null> {
    let filename: string | undefined
    for (;;) {
      try { return await operation(filename) }
      catch (error) {
        if (!(error instanceof ThreadApiError) || error.code !== 'filename-conflict' || !error.proposedFilename) throw error
        if (!await this.confirmFilename(error.proposedFilename)) return null
        filename = error.proposedFilename
      }
    }
  }
  create(title: string) { return this.run(async () => {
    await this.saveOutgoing()
    const metadata = createThreadMetadata(title.trim())
    const document = validateDocument({ ...metadata, format: 'learnvas', version: LEARN_VERSION, cards: [{ id: crypto.randomUUID(), kind: 'prompt', position: { x: 100, y: 140 }, text: '', collapsed: false, sent: false }], connections: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const record = await this.confirmed(filename => this.api.create(document, filename))
    if (!record) return
    this.activate(record)
    await this.refreshAfterMutation()
  }) }
  rename(title: string) { return this.run(async () => {
    await this.saveOutgoing()
    const active = this.state.active
    if (!active) return
    const record = await this.confirmed(filename => this.api.rename(active.document.threadId, title.trim(), active.revision, filename))
    if (!record) return
    this.patch({ active: record, status: 'saved', error: null })
    await this.refreshAfterMutation()
  }) }
  trashActive() { return this.run(async () => {
    await this.saveOutgoing()
    const active = this.state.active
    if (!active) return
    const record = await this.confirmed(filename => this.api.trash(active.document.threadId, active.revision, filename))
    if (!record) return
    this.activate(null)
    await this.refreshAfterMutation()
  }) }
  restore(id: string, revision: string) { return this.run(async () => {
    const record = await this.confirmed(filename => this.api.restore(id, revision, filename))
    if (record) await this.refreshAfterMutation()
  }) }
  exportActive() { return this.run(async () => {
    if (!this.state.active) throw new Error('Select a thread before exporting')
    await this.saveOutgoing()
    const active = this.state.active!
    const saved = await this.api.read(active.document.threadId)
    if (saved.revision !== active.revision) throw new ThreadApiError('Saved thread changed elsewhere; export cancelled', 'revision-conflict')
    if (content(this.capture()) !== content(saved.document)) throw new Error('Canvas changed during export; no file was downloaded. Retry exporting')
    return portableExport(saved.document, saved.filename)
  }) }
  /** Import never stops generation, saves, or replaces the active canvas. Open it separately. */
  importDocument(input: unknown, approve: (kind: 'import' | 'copy', document: LearnDocument) => boolean | Promise<boolean>) {
    return this.run(async () => {
      let document = validatePortableDocument(input)
      if (!await approve('import', document)) return null
      let copied = false
      const record = await this.confirmed(async filename => {
        try { return await this.api.create(document, filename) }
        catch (error) {
          if (!(error instanceof ThreadApiError) || error.code !== 'id-conflict' || copied) throw error
          if (!await approve('copy', document)) return null
          // Copy-only flow: new identity and timestamps; all exploration content retained.
          document = { ...document, ...createThreadMetadata(document.title) }
          copied = true
          return this.api.create(document, filename)
        }
      })
      if (record) await this.refreshAfterMutation()
      return record
    }, false)
  }
  /** Explicit recovery from save failures: the stored original is never replaced. */
  recoverCopy(title: string) { return this.run(async () => {
    if (!this.state.active) return
    this.binding?.stop()
    const document = { ...this.capture(), ...createThreadMetadata(title.trim()) }
    const record = await this.confirmed(filename => this.api.create(document, filename))
    if (!record) return
    this.activate(record)
    await this.refreshAfterMutation()
  }) }
}
