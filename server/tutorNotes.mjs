// Global tutor notes — one small settings file shared by every Learnvas thread.
//
//   GET  /api/tutor-notes        -> { notes: { global, updatedAt } }
//   PUT  /api/tutor-notes        -> { notes: { global } } ; returns the saved record
//
// Stored as ~/.learnvas/tutor-notes.json next to the managed .learn library.
// It is deliberately NOT a .learn document: the library scan ignores
// non-.learn entries, and this file carries no thread identity, cards, or
// graph. The `global` text is appended to every tutor session's system
// prompt, so it must stay small, deterministic, and free of volatile
// content (timestamps are stored once in updatedAt, never rendered into
// the prompt) to preserve provider prompt-cache prefixes.
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { LibraryError } from './library.mjs'

export const TUTOR_NOTES_FILE = 'tutor-notes.json'
export const MAX_NOTES_CHARS = 4000
const nofollow = constants.O_NOFOLLOW ?? 0

export class NotesError extends LibraryError {}

function fail(code, message, status = 400, details) {
  throw new NotesError(code, message, status, details)
}

/** Request/response surface: only the edit-facing fields are accepted. */
export function validateNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-request', 'Expected a JSON object')
  const extra = Object.keys(value).filter(k => k !== 'global')
  if (extra.length) fail('invalid-request', `Unknown request field: ${extra[0]}`)
  const global = value.global
  if (typeof global !== 'string') fail('invalid-request', 'notes.global must be a string (possibly empty)')
  if (global.length > MAX_NOTES_CHARS) fail('notes-too-large', `notes.global exceeds the ${MAX_NOTES_CHARS} character limit`, 413)
  return { global }
}

/** Stored record: same bounds, but updatedAt is expected and oversized/whitespace notes collapse to empty. */
function parseStored(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-notes', 'Stored tutor notes must be a JSON object', 422)
  if (typeof value.global !== 'string' || value.global.length > MAX_NOTES_CHARS) {
    fail('invalid-notes', 'Stored tutor notes are corrupt', 422)
  }
  return {
    global: value.global.trim() ? value.global : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

/** Cache-stable composition: global notes first, then thread notes, each only when nonempty. */
export function tutorNotesPrompt(globalNotes, threadNotes) {
  const sections = []
  if (globalNotes.trim()) sections.push(`## The student's standing requests (all threads)\n\n${globalNotes.trim()}`)
  if (threadNotes.trim()) sections.push(`## The student's requests for this thread\n\n${threadNotes.trim()}`)
  return sections.join('\n\n')
}

/**
 * Bounded, symlink-refusing settings file store. Injection matches
 * ThreadLibrary so failure tests can substitute an in-memory io.
 */
export class TutorNotesStore {
  constructor({ directory = path.join(homedir(), '.learnvas'), io = fs } = {}) {
    this.file = path.join(path.resolve(directory), TUTOR_NOTES_FILE)
    this.io = io
    this.queue = Promise.resolve()
  }

  /** Newest-wins serialization; a reader always observes one whole write. Failures propagate. */
  run(operation) {
    const result = this.queue.then(operation).catch(error => {
      throw error instanceof LibraryError ? error : mapError(error)
    })
    this.queue = result.catch(() => {})
    return result
  }

  async readRaw() {
    let handle
    try {
      handle = await this.io.open(this.file, constants.O_RDONLY | nofollow | constants.O_NONBLOCK)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) return null
      const bytes = await handle.readFile()
      if (bytes.length > MAX_NOTES_CHARS * 4 + 256) fail('notes-too-large', 'Stored tutor notes exceed the size limit', 413)
      let value
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
      catch { fail('invalid-notes', 'Stored tutor notes are not valid JSON', 422) }
      return parseStored(value)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    } finally {
      await handle.close()
    }
  }

  async read() {
    return this.run(async () => {
      const stored = await this.readRaw()
      return { global: stored?.global ?? '', updatedAt: stored?.updatedAt ?? null }
    })
  }

  /** Atomic replace: stage, sync, rename over the old file, fsync the directory. */
  async save(notes) {
    return this.run(async () => {
      const { global } = validateNotes(notes)
      const trimmed = global.trim() ? global : ''
      const record = { ...validateNotes({ global: trimmed }), updatedAt: new Date().toISOString() }
      const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n')
      const directory = path.dirname(this.file)
      // The notes file may be a library's very first write, before ThreadLibrary
      // has ever needed to create ~/.learnvas.
      try { await this.io.mkdir(directory, { recursive: true, mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
      const staged = path.join(directory, `.pending-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      const handle = await this.io.open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await this.io.rename(staged, this.file)
        const dir = await this.io.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | nofollow)
        try { await dir.sync() } finally { await dir.close() }
      } catch (error) {
        await this.io.unlink(staged).catch(() => {})
        throw error
      }
      return record
    })
  }
}

function mapError(error) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) {
    return new NotesError('permission-denied', 'Tutor notes access denied; check file permissions', 403)
  }
  return new NotesError('io-error', `Tutor notes filesystem operation failed (${error?.code ?? 'unknown'}); re-read before retrying`, 500)
}
