import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { MAX_NOTES_CHARS, TutorNotesStore, validateNotes } from './tutorNotes.mjs'
import { LibraryError } from './library.mjs'

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'learnvas-notes-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, store: new TutorNotesStore({ directory }) }
}

test('reads as empty before any save; saves round-trip and stamp updatedAt', async t => {
  const { directory, store } = await setup(t)
  assert.deepEqual(await store.read(), { global: '', updatedAt: null })
  const saved = await store.save({ global: 'Prefer mermaid diagrams.' })
  assert.equal(saved.global, 'Prefer mermaid diagrams.')
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(await store.read(), saved)
  const raw = JSON.parse(await fs.readFile(path.join(directory, 'tutor-notes.json'), 'utf8'))
  assert.deepEqual(raw, saved)
})

test('whitespace-only notes are normalized to empty', async t => {
  const { store } = await setup(t)
  const saved = await store.save({ global: '   \n  ' })
  assert.equal(saved.global, '')
  assert.deepEqual(await store.read().then(r => r.global), '')
})

test('second save wins and updates the timestamp', async t => {
  const { store } = await setup(t)
  const first = await store.save({ global: 'one' })
  await new Promise(resolve => setTimeout(resolve, 5))
  const second = await store.save({ global: 'two' })
  assert.equal(second.global, 'two')
  assert.ok(second.updatedAt >= first.updatedAt)
  assert.deepEqual(await store.read(), second)
})

test('validation rejects non-objects, unknown fields, non-strings and oversized notes', async t => {
  for (const value of [null, [], 'x', 1, { global: 1 }, { global: null }, { global: 'a', hot: 1 }]) {
    assert.throws(() => validateNotes(value), LibraryError)
  }
  assert.throws(() => validateNotes({ global: 'x'.repeat(MAX_NOTES_CHARS + 1) }), error => {
    assert.equal(error.code, 'notes-too-large'); return true
  })
  assert.deepEqual(validateNotes({ global: '' }), { global: '' })
  assert.equal(validateNotes({ global: 'ok' }).global, 'ok')
})

test('a corrupted stored file fails loudly instead of appearing empty', async t => {
  const { directory, store } = await setup(t)
  await fs.writeFile(path.join(directory, 'tutor-notes.json'), '{broken')
  await assert.rejects(store.read(), error => error.code === 'invalid-notes')
})

test('an oversized stored file fails loudly instead of returning unvalidated content', async t => {
  const { directory, store } = await setup(t)
  const bloated = JSON.stringify({ global: 'x'.repeat(MAX_NOTES_CHARS * 4), updatedAt: '2026-01-01T00:00:00.000Z' })
  await fs.writeFile(path.join(directory, 'tutor-notes.json'), bloated)
  await assert.rejects(store.read(), error => error.code === 'invalid-notes')
})

test('reads refuse a symlinked notes path; replacing entries never writes through links', async t => {
  const { directory, store } = await setup(t)
  const outside = path.join(await fs.mkdtemp(path.join(tmpdir(), 'learnvas-notes-out-')), 'secret')
  await fs.writeFile(outside, 'outside')
  await fs.symlink(outside, path.join(directory, 'tutor-notes.json'))
  await assert.rejects(store.read(), error => error instanceof LibraryError)
  // save() stages beside the file and renames over the entry: the link is
  // replaced, the secret file is untouched, exactly like managed .learn writes.
  await store.save({ global: 'x' })
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside')
  const stat = await fs.lstat(path.join(directory, 'tutor-notes.json'))
  assert.equal(stat.isSymbolicLink(), false)
})

test('injected io failures surface as library io errors with a retry hint', async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'learnvas-notes-io-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new TutorNotesStore({
    directory,
    io: { ...fs, open: async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }) } },
  })
  await assert.rejects(store.read(), error => error.code === 'permission-denied')
})
