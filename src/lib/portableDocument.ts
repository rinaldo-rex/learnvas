import { MAX_DOCUMENT_BYTES, parseDocument, serializeDocument, validateDocument, type LearnDocument } from './learnDocument.ts'

export class PortableDocumentError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
function checkSize(size: number) {
  if (size > MAX_DOCUMENT_BYTES) throw new PortableDocumentError('document-too-large', 'Document exceeds the 8 MiB limit')
}
export function validatePortableDocument(input: unknown): LearnDocument {
  const document = validateDocument(input)
  checkSize(new TextEncoder().encode(serializeDocument(document)).byteLength)
  return document
}
/** Extension is only a picker hint: trust the bounded UTF-8 content and schema. */
export function parsePortableDocument(bytes: Uint8Array): LearnDocument {
  checkSize(bytes.byteLength)
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new PortableDocumentError('invalid-json', 'Document must contain valid UTF-8 JSON') }
  return validatePortableDocument(parseDocument(text))
}
export async function readPortableFile(file: { size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<LearnDocument> {
  checkSize(file.size) // Refuse huge uploads before allocating the buffer.
  return parsePortableDocument(new Uint8Array(await file.arrayBuffer()))
}
export function portableExport(document: LearnDocument, filename: string) {
  return { filename, json: serializeDocument(validatePortableDocument(document)) }
}
/** Export only after the caller has obtained the confirmed, current saved snapshot. */
export function downloadPortable(exported: { filename: string; json: string }) {
  const url = URL.createObjectURL(new Blob([exported.json], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
