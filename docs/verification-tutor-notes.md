# Tutor notes feature — v2 (issue #8): verification

## Automated

- pnpm test → 152/152 pass (format, notes store, library/API, workspace, portable, theme, ports)
- pnpm build → tsc --noEmit + vite build clean

## Bridge endpoints (curl-equivalent via node http)

- GET /api/tutor-notes before any save → {"global":"","updatedAt":null}
- PUT /api/tutor-notes {"global":"..."} → saved record; GET returns it (verified via library.test.mjs route test)
- Rejections verified: unknown field, non-string, >4000 chars (413), non-JSON body (400), POST (405)

## Session composition (server/index.mjs)

- makeSession(appends [notes]) → DefaultResourceLoader.appendSystemPrompt = [composed]
- Composed order: global section first, thread section second, omitted when empty
- Fixture-free sanity: tutorNotesPrompt('g', 't') produces two markdown headers in stable order

## Live app (manual)

- just learn → open http://localhost:5173
- Notes chip (top-right, collapsed by default) expands showing:
  - Global · all threads accordion (empty state 'empty')
  - This thread accordion (disabled when no thread active)
- Typed into global; 500ms debounce → tutor-notes.json appears in ~/.learnvas
- Typed into thread notes; ~400ms debounced save → .learn file contains tutorNotes
- Sent a question → response honors the note (e.g. mermaid diagram appears)
- Esc closes; outside click closes; textarea focus safe; zen mode hides chip
- Thread switch → thread notes show the other thread's value (loaded from file)
- Export/import round trip → thread notes preserved in the portable file
- Global notes: cleared browser localStorage → notes survive (server-backed)

## Not verified in this run

- Provider prompt-cache CH% visibility (requires provider metrics; covered by issue #9)
