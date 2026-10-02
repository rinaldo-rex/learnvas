import { validateDocument, type LearnDocument, type ThreadMetadata } from './learnDocument.ts'

export interface ThreadRecord { document: LearnDocument; filename: string; revision: string }
export interface ThreadSummary extends ThreadMetadata { filename: string; revision: string }
export interface ThreadList { threads: ThreadSummary[]; warnings: { filename: string; message: string }[] }
export class ThreadApiError extends Error {
  readonly code: string
  readonly proposedFilename?: string
  constructor(message: string, code: string, proposedFilename?: string) {
    super(message)
    this.code = code
    this.proposedFilename = proposedFilename
  }
}
export interface ThreadApi {
  list(trash?: boolean): Promise<ThreadList>
  read(id: string, trash?: boolean): Promise<ThreadRecord>
  create(document: LearnDocument, confirmFilename?: string): Promise<ThreadRecord>
  save(id: string, document: LearnDocument, revision: string): Promise<ThreadRecord>
  rename(id: string, title: string, revision: string, confirmFilename?: string): Promise<ThreadRecord>
  trash(id: string, revision: string, confirmFilename?: string): Promise<ThreadRecord>
  restore(id: string, revision: string, confirmFilename?: string): Promise<ThreadRecord>
}
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const value = await response.json()
  if (!response.ok) throw new ThreadApiError(value.error ?? 'Library request failed', value.code ?? 'request-failed', value.proposedFilename)
  return value
}
async function record(path: string, method = 'GET', body?: unknown): Promise<ThreadRecord> {
  const result = await request(path, method, body)
  return { ...result, document: validateDocument(result.document) }
}
const url = (id: string, trash = false) => `${trash ? 'trash' : 'threads'}/${encodeURIComponent(id)}`
export const threadApi: ThreadApi = {
  list: (trash = false) => request(trash ? 'trash' : 'threads'),
  read: (id, trash = false) => record(url(id, trash)),
  create: (document, confirmFilename) => record('threads', 'POST', { document, confirmFilename }),
  save: (id, document, revision) => record(url(id), 'PUT', { document, revision }),
  rename: (id, title, revision, confirmFilename) => record(`${url(id)}/rename`, 'POST', { title, revision, confirmFilename }),
  trash: (id, revision, confirmFilename) => record(`${url(id)}/trash`, 'POST', { revision, confirmFilename }),
  restore: (id, revision, confirmFilename) => record(`${url(id, true)}/restore`, 'POST', { revision, confirmFilename }),
}
