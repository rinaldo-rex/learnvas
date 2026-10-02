import { parseDocument, serializeDocument, type LearnDocument } from './learnDocument.ts'

// Deliberately separate from the discarded MVP's learnvas:v1 raw React Flow snapshot.
export const CANVAS_STORE_KEY = 'learnvas:document'
type CanvasStorage = Pick<Storage, 'getItem' | 'setItem'>

export type StoredCanvas =
  | { kind: 'empty' }
  | { kind: 'loaded'; document: LearnDocument }
  | { kind: 'error'; message: string }

export function loadCanvas(storage: CanvasStorage): StoredCanvas {
  try {
    const raw = storage.getItem(CANVAS_STORE_KEY)
    return raw === null ? { kind: 'empty' } : { kind: 'loaded', document: parseDocument(raw) }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Could not read canvas storage' }
  }
}

/** Throws before touching storage if the document is invalid. Callers must not save after a failed load. */
export function saveCanvas(storage: CanvasStorage, document: LearnDocument): void {
  const json = serializeDocument(document)
  storage.setItem(CANVAS_STORE_KEY, json)
}
