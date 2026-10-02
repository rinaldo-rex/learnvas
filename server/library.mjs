import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { MAX_DOCUMENT_BYTES, parseDocument, serializeDocument, validateDocument } from '../src/lib/learnDocument.ts'

export { MAX_DOCUMENT_BYTES }
export const DEFAULT_LIBRARY = path.join(homedir(), '.learnvas')
const nofollow = constants.O_NOFOLLOW ?? 0

export class LibraryError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}
const fail = (code, message, status = 400, details) => { throw new LibraryError(code, message, status, details) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const revision = (bytes, stat) => hash(`${hash(bytes)}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`)

async function readBounded(handle, maximum) {
  const chunks = []
  let size = 0
  for (;;) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - size))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (!bytesRead) return Buffer.concat(chunks)
    chunks.push(buffer.subarray(0, bytesRead))
    size += bytesRead
    if (size > maximum) fail('document-too-large', 'Managed file exceeds its size limit', 413)
  }
}
function decode(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { fail('invalid-json', 'Document must contain valid UTF-8 JSON', 422) }
}

export function checkId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 256 || /[/\\\x00-\x1f\x7f]/.test(id) || id === '.' || id === '..') {
    fail('invalid-id', 'Expected a thread ID, not a filesystem path (maximum 256 characters)')
  }
  return id
}
export function checkTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || /[\x00-\x1f\x7f]/.test(title)) {
    fail('invalid-title', 'Title must be nonempty, at most 200 characters, and contain no control characters')
  }
  return title
}
export function filenameForTitle(title) {
  checkTitle(title)
  let stem = title.normalize('NFKC').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '')
  if (!stem) stem = 'Untitled'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`
  // Stay comfortably below common filesystem byte limits, including suffixes.
  while (Buffer.byteLength(stem) > 160) stem = Array.from(stem).slice(0, -1).join('')
  return `${stem}.learn`
}
function checkFilename(filename) {
  if (typeof filename !== 'string' || path.basename(filename) !== filename || /[/\\\x00-\x1f\x7f]/.test(filename) ||
      filename.startsWith('.') || !filename.endsWith('.learn') || Buffer.byteLength(filename) > 220) {
    fail('invalid-filename', 'Expected a managed .learn filename, not a path')
  }
  return filename
}
function canonical(document) {
  const d = validateDocument(document)
  checkId(d.threadId)
  checkTitle(d.title)
  const bytes = Buffer.from(serializeDocument(d))
  if (bytes.length > MAX_DOCUMENT_BYTES) fail('document-too-large', 'Document exceeds the 8 MiB limit', 413)
  return { document: d, bytes }
}
function mapError(error) {
  if (error instanceof LibraryError) return error
  if (error?.name === 'LearnDocumentError') return new LibraryError(error.code, error.message, 422, { path: error.path })
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return new LibraryError('permission-denied', 'Library access denied; check directory/file permissions', 403)
  if (error?.code === 'ELOOP') return new LibraryError('unsafe-path', 'Symlinks are not allowed in the managed library', 422)
  return new LibraryError('io-error', `Library filesystem operation failed (${error?.code ?? 'unknown'}); re-read before retrying`, 500)
}

/** One shared schema, no Pi runtime and no browser/React imports at runtime. */
export class ThreadLibrary {
  constructor({ directory = DEFAULT_LIBRARY, io = fs } = {}) {
    this.directory = path.resolve(directory)
    this.io = io // Injection is used only by isolated failure tests.
    this.queue = Promise.resolve()
  }
  area(trash = false) { return trash ? path.join(this.directory, '.trash') : this.directory }
  async syncDirectory(directory) {
    const handle = await this.io.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | nofollow)
    try { await handle.sync() } finally { await handle.close() }
  }
  async initialize() {
    // Check every ancestor before creating anything: recursive mkdir alone follows symlinks.
    let current = path.parse(this.directory).root
    for (const part of this.directory.slice(current.length).split(path.sep).filter(Boolean).concat('.trash')) {
      const parent = current
      current = path.join(current, part)
      try {
        await this.io.mkdir(current, { mode: 0o700 })
        await this.syncDirectory(parent)
      } catch (error) { if (error.code !== 'EEXIST') throw error }
      const stat = await this.io.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe-path', 'Library directories must be real directories, not symlinks', 422)
    }
  }
  async readFile(filename, trash = false) {
    const file = path.join(this.area(trash), checkFilename(filename))
    const handle = await this.io.open(file, constants.O_RDONLY | nofollow | constants.O_NONBLOCK)
    try {
      const before = await handle.stat({ bigint: true })
      if (!before.isFile() || before.nlink !== 1n) fail('unsafe-path', 'Only regular, non-hardlinked documents are managed', 422)
      if (before.size > BigInt(MAX_DOCUMENT_BYTES)) fail('document-too-large', 'Document exceeds the 8 MiB limit', 413)
      const bytes = await readBounded(handle, MAX_DOCUMENT_BYTES)
      const after = await handle.stat({ bigint: true })
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        fail('revision-conflict', 'Document changed while reading; try again', 409)
      }
      const document = parseDocument(decode(bytes))
      checkId(document.threadId)
      checkTitle(document.title)
      return { document, filename, revision: revision(bytes, after), digest: hash(bytes) }
    } finally { await handle.close() }
  }
  async scan(trash = false) {
    const records = []
    const warnings = []
    for (const filename of (await this.io.readdir(this.area(trash))).sort()) {
      if (!filename.endsWith('.learn')) continue
      try { records.push(await this.readFile(filename, trash)) }
      catch (error) { const e = mapError(error); warnings.push({ filename, code: e.code, message: e.message }) }
    }
    const counts = new Map()
    for (const r of records) counts.set(r.document.threadId, (counts.get(r.document.threadId) ?? 0) + 1)
    const valid = records.filter(r => {
      if (counts.get(r.document.threadId) === 1) return true
      warnings.push({ filename: r.filename, threadId: r.document.threadId, code: 'id-conflict', message: 'Duplicate thread ID; both files preserved' })
      return false
    })
    return { records: valid, warnings }
  }
  async find(id, trash = false) {
    checkId(id)
    const { records, warnings } = await this.scan(trash)
    if (warnings.some(w => w.threadId === id)) fail('id-conflict', 'Multiple documents have this thread ID; resolve the duplicate files first', 409)
    const record = records.find(r => r.document.threadId === id)
    if (!record) fail('not-found', 'Thread not found among valid managed documents', 404)
    return record
  }
  async assertRevision(record, expected, trash = false) {
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) fail('revision-required', 'Supply the revision from the last read', 428)
    let current
    try { current = await this.readFile(record.filename, trash) }
    catch (error) {
      if (['permission-denied', 'unsafe-path'].includes(mapError(error).code)) throw error
      fail('revision-conflict', 'Document was removed or is no longer valid; re-read before saving', 409)
    }
    if (current.revision !== expected) fail('revision-conflict', 'Document changed since your last read; re-read before saving', 409, { currentRevision: current.revision })
  }
  async chooseFilename(title, trash, exclude, confirmFilename) {
    if (confirmFilename !== undefined) checkFilename(confirmFilename)
    const entries = await this.io.readdir(this.area(trash))
    // Case-insensitive collision checks make names portable across common filesystems.
    const occupied = new Set(entries.filter(f => f !== exclude).map(f => f.normalize('NFKC').toLowerCase()))
    const base = filenameForTitle(title)
    let filename = base
    let number = 2
    while (occupied.has(filename.normalize('NFKC').toLowerCase())) filename = `${base.slice(0, -6)} (${number++}).learn`
    if (filename !== base && confirmFilename !== filename) {
      fail('filename-conflict', `${base} already exists; confirm ${filename} before saving`, 409, { proposedFilename: filename, confirmationRequired: true })
    }
    if (confirmFilename !== undefined && confirmFilename !== filename) {
      fail('filename-conflict', 'The available filename changed; confirm the new proposal', 409, { proposedFilename: filename, confirmationRequired: true })
    }
    return filename
  }
  async assertIdAvailable(id, trash = false) {
    const { records, warnings } = await this.scan(trash)
    if (records.some(r => r.document.threadId === id) || warnings.some(w => w.threadId === id)) fail('id-conflict', 'Thread ID already exists; no document was overwritten', 409)
  }
  async stage(bytes, directory) {
    const filename = `.pending-${randomUUID()}`
    const file = path.join(directory, filename)
    const handle = await this.io.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() }
    catch (error) { await this.io.unlink(file).catch(() => {}); throw error }
    finally { await handle.close() }
    return file
  }
  async publish(staged, filename, trash = false) {
    // link is an atomic no-clobber publish; rename would overwrite a raced-in file.
    try { await this.io.link(staged, path.join(this.area(trash), filename)) }
    catch (error) { if (error.code === 'EEXIST') fail('filename-conflict', 'Filename became occupied; retry to obtain a new proposal', 409); throw error }
    await this.io.unlink(staged)
    await this.syncDirectory(this.area(trash))
  }
  async write(bytes, filename, record = null, expected = null) {
    const staged = await this.stage(bytes, this.directory)
    try {
      if (record) {
        await this.assertRevision(record, expected)
        await this.io.rename(staged, path.join(this.directory, filename))
        await this.syncDirectory(this.directory)
      } else await this.publish(staged, filename)
    } finally { await this.io.unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    return this.readFile(filename)
  }
  async writeJournal(journal) {
    const staged = await this.stage(Buffer.from(JSON.stringify(journal)), this.directory)
    try {
      await this.io.link(staged, path.join(this.directory, '.transaction.json'))
      await this.io.unlink(staged)
      await this.syncDirectory(this.directory)
    } finally { await this.io.unlink(staged).catch(() => {}) }
  }
  async recover() {
    const journalPath = path.join(this.directory, '.transaction.json')
    let handle
    try { handle = await this.io.open(journalPath, constants.O_RDONLY | nofollow | constants.O_NONBLOCK) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    let j
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) fail('recovery-conflict', 'Unsafe transaction journal; no files changed', 409)
      j = JSON.parse(decode(await readBounded(handle, 4096)))
      if (!j || Object.keys(j).sort().join() !== 'destination,digest,revision,source,staged' ||
          !j.source || !j.destination || Object.keys(j.source).sort().join() !== 'filename,trash' ||
          Object.keys(j.destination).sort().join() !== 'filename,trash' ||
          typeof j.source.trash !== 'boolean' || typeof j.destination.trash !== 'boolean' ||
          !/^[a-f0-9]{64}$/.test(j.digest) || !/^[a-f0-9]{64}$/.test(j.revision) ||
          !/^\.pending-[a-f0-9-]{36}$/.test(j.staged)) fail('recovery-conflict', 'Invalid transaction journal; no files changed', 409)
      checkFilename(j.source.filename); checkFilename(j.destination.filename)
      if (j.source.trash === j.destination.trash && j.source.filename === j.destination.filename) fail('recovery-conflict', 'Invalid transaction locations', 409)
    } catch (error) { throw error instanceof LibraryError ? error : new LibraryError('recovery-conflict', 'Unreadable transaction journal; no files changed', 409) }
    finally { await handle.close() }
    const staged = path.join(this.directory, j.staged)
    const sourcePath = path.join(this.area(j.source.trash), j.source.filename)
    const destinationPath = path.join(this.area(j.destination.trash), j.destination.filename)
    const exists = async file => {
      try { await this.io.lstat(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
    }
    const sourceExists = await exists(sourcePath)
    if (sourceExists) {
      const source = await this.readFile(j.source.filename, j.source.trash)
      if (source.revision !== j.revision) fail('recovery-conflict', 'Interrupted operation source changed; both copies are preserved', 409)
    }
    if (!await exists(destinationPath)) {
      if (!sourceExists) fail('recovery-conflict', 'Interrupted operation is missing both documents', 409)
      const h = await this.io.open(staged, constants.O_RDONLY | nofollow)
      try {
        const stat = await h.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_DOCUMENT_BYTES) fail('recovery-conflict', 'Unsafe staged document', 409)
        const bytes = await readBounded(h, MAX_DOCUMENT_BYTES)
        if (hash(bytes) !== j.digest) fail('recovery-conflict', 'Staged document changed; original preserved', 409)
        canonical(parseDocument(decode(bytes)))
      } finally { await h.close() }
      await this.publish(staged, j.destination.filename, j.destination.trash)
    } else {
      // A crash between link/unlink leaves two links. Remove only the known staging link.
      if (await exists(staged)) {
        const a = await this.io.lstat(staged)
        const b = await this.io.lstat(destinationPath)
        if (a.isSymbolicLink() || !a.isFile()) fail('recovery-conflict', 'Unsafe staged document; all files preserved', 409)
        if (a.ino !== b.ino || a.dev !== b.dev) {
          // The no-clobber publish lost a race. Cancel only an untouched,
          // uncommitted transaction; never delete the foreign destination.
          if (!sourceExists || a.nlink !== 1) fail('recovery-conflict', 'Unexpected destination; all files preserved', 409)
          const h = await this.io.open(staged, constants.O_RDONLY | nofollow)
          try {
            if (hash(await readBounded(h, MAX_DOCUMENT_BYTES)) !== j.digest) fail('recovery-conflict', 'Staging changed; all files preserved', 409)
          } finally { await h.close() }
          await this.io.unlink(staged)
          await this.io.unlink(journalPath)
          await this.syncDirectory(this.directory)
          fail('filename-conflict', 'Destination became occupied; retry for a new filename proposal', 409)
        }
        await this.io.unlink(staged)
      }
      let destination
      try { destination = await this.readFile(j.destination.filename, j.destination.trash) }
      catch { fail('recovery-conflict', 'Interrupted operation destination is no longer valid; all copies preserved', 409) }
      if (destination.digest !== j.digest) fail('recovery-conflict', 'Interrupted operation destination changed; both copies preserved', 409)
      await this.syncDirectory(this.area(j.destination.trash))
    }
    if (sourceExists) {
      // Verify again immediately before deleting the original.
      const source = await this.readFile(j.source.filename, j.source.trash)
      if (source.revision !== j.revision) fail('recovery-conflict', 'Source changed during recovery; both copies preserved', 409)
      await this.io.unlink(sourcePath)
      await this.syncDirectory(this.area(j.source.trash))
    }
    await this.io.unlink(journalPath)
    await this.syncDirectory(this.directory)
  }
  async move(record, document, sourceTrash, destinationTrash, filename, expected) {
    const { bytes } = canonical(document)
    const staged = await this.stage(bytes, this.directory)
    let journalWritten = false
    try {
      await this.assertRevision(record, expected, sourceTrash)
      await this.writeJournal({
        source: { filename: record.filename, trash: sourceTrash },
        destination: { filename, trash: destinationTrash },
        staged: path.basename(staged), revision: expected, digest: hash(bytes),
      })
      journalWritten = true
      await this.recover()
      return await this.readFile(filename, destinationTrash)
    } catch (error) {
      if (error instanceof LibraryError && error.code === 'filename-conflict') {
        // Cancel a raced, unpublished destination now rather than leaving a
        // known collision to surprise the next API request during recovery.
        try { await this.recover() }
        catch (recoveryError) { if (recoveryError.code !== 'filename-conflict') throw recoveryError }
      }
      throw error
    } finally {
      // Once journaled, retain staging for recovery after I/O failures.
      let exists = false
      try { await this.io.lstat(path.join(this.directory, '.transaction.json')); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (!journalWritten && !exists) await this.io.unlink(staged).catch(() => {})
    }
  }
  async lock() {
    const filename = path.join(this.directory, '.writer-lock')
    for (let attempt = 0; attempt < 2; attempt++) {
      let handle
      try { handle = await this.io.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600) }
      catch (error) {
        if (error.code !== 'EEXIST') throw error
        const h = await this.io.open(filename, constants.O_RDONLY | nofollow | constants.O_NONBLOCK)
        let pid
        try {
          const stat = await h.stat()
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32) fail('unsafe-path', 'Unsafe writer lock', 422)
          pid = Number(decode(await readBounded(h, 32)))
        } finally { await h.close() }
        if (!Number.isSafeInteger(pid) || pid <= 0) fail('library-busy', 'Another writer is initializing, or the writer lock is invalid', 409)
        try { process.kill(pid, 0); fail('library-busy', 'Another bridge is writing this library; retry shortly', 409) }
        catch (e) { if (e.code !== 'ESRCH') throw e }
        // Do not race another stale-lock remover: use a separate exclusive recovery lock.
        let recovery
        const recoveryPath = path.join(this.directory, '.lock-recovery')
        try { recovery = await this.io.open(recoveryPath, 'wx', 0o600) }
        catch (e) { if (e.code === 'EEXIST') fail('library-busy', 'Writer lock recovery is in progress', 409); throw e }
        try {
          const current = await this.io.open(filename, constants.O_RDONLY | nofollow | constants.O_NONBLOCK)
          let same
          try {
            const stat = await current.stat()
            if (!stat.isFile() || stat.nlink !== 1) fail('unsafe-path', 'Unsafe writer lock', 422)
            same = Number(decode(await readBounded(current, 32))) === pid
          } finally { await current.close() }
          if (same) await this.io.unlink(filename)
        } finally { await recovery.close(); await this.io.unlink(recoveryPath) }
        continue
      }
      try { await handle.writeFile(String(process.pid)); await handle.sync() }
      catch (error) { await handle.close(); await this.io.unlink(filename); throw error }
      await handle.close()
      return async () => { await this.io.unlink(filename) }
    }
    fail('library-busy', 'Library writer lock changed; retry', 409)
  }
  run(operation) {
    const result = this.queue.then(async () => {
      let release
      try {
        await this.initialize()
        release = await this.lock()
        await this.recover()
        return await operation()
      } catch (error) { throw mapError(error) }
      finally { if (release) { try { await release() } catch (error) { throw mapError(error) } } }
    })
    this.queue = result.catch(() => {})
    return result
  }
  list(trash = false) {
    return this.run(async () => {
      const { records, warnings } = await this.scan(trash)
      return { threads: records.map(({ document: d, filename, revision }) => ({
        threadId: d.threadId, title: d.title, createdAt: d.createdAt, updatedAt: d.updatedAt, filename, revision,
      })), warnings }
    })
  }
  read(id, trash = false) { return this.run(async () => this.publicRecord(await this.find(id, trash))) }
  publicRecord({ document, filename, revision }) { return { document, filename, revision } }
  create(document, confirmFilename) {
    return this.run(async () => {
      const { document: d, bytes } = canonical(document)
      await this.assertIdAvailable(d.threadId)
      await this.assertIdAvailable(d.threadId, true)
      const filename = await this.chooseFilename(d.title, false, null, confirmFilename)
      return this.publicRecord(await this.write(bytes, filename))
    })
  }
  save(id, document, expected) {
    return this.run(async () => {
      const { document: d, bytes } = canonical(document)
      const record = await this.find(id)
      await this.assertRevision(record, expected)
      if (d.threadId !== id || d.createdAt !== record.document.createdAt || d.title !== record.document.title) {
        fail('immutable-metadata', 'Save cannot change threadId, createdAt, or title; use rename for title changes', 422)
      }
      if (d.updatedAt < record.document.updatedAt) fail('invalid-document', 'updatedAt must not move backwards', 422)
      return this.publicRecord(await this.write(bytes, record.filename, record, expected))
    })
  }
  rename(id, title, expected, confirmFilename) {
    return this.run(async () => {
      checkTitle(title)
      const record = await this.find(id)
      await this.assertRevision(record, expected)
      const filename = await this.chooseFilename(title, false, record.filename, confirmFilename)
      const document = { ...record.document, title, updatedAt: new Date(Math.max(Date.now(), Date.parse(record.document.updatedAt))).toISOString() }
      if (filename === record.filename) return this.publicRecord(await this.write(canonical(document).bytes, filename, record, expected))
      return this.publicRecord(await this.move(record, document, false, false, filename, expected))
    })
  }
  trash(id, expected, confirmFilename) {
    return this.run(async () => {
      const record = await this.find(id)
      await this.assertRevision(record, expected)
      await this.assertIdAvailable(id, true)
      const filename = await this.chooseFilename(record.document.title, true, null, confirmFilename)
      return this.publicRecord(await this.move(record, record.document, false, true, filename, expected))
    })
  }
  restore(id, expected, confirmFilename) {
    return this.run(async () => {
      const record = await this.find(id, true)
      await this.assertRevision(record, expected, true)
      await this.assertIdAvailable(id)
      const filename = await this.chooseFilename(record.document.title, false, null, confirmFilename)
      return this.publicRecord(await this.move(record, record.document, true, false, filename, expected))
    })
  }
}
