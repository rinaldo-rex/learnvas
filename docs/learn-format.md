# Portable `.learn` document format — v3

[← Learnvas](../README.md)

A learning thread is **one complete canvas**, including any number of root conversations and branches. A `.learn` file is readable UTF-8 JSON, not a database, archive, or executable Pi session.

Saved text and layout are portable without Pi or model access. **Continuing generation requires configured model credentials** and an available provider. Opening a document must never start a request, execute extensions, or restore a Pi transcript/session.

The [bridge file-library API](thread-library.md) manages `~/.learnvas/<human-readable-title>.learn`, with confirmed numbered filenames for collisions and recoverable trash. The browser's **Threads** panel manages named canvases and file-backed autosave. Its import/export controls validate bounded UTF-8 documents, create copies only after collision confirmation, and export the current saved state without credentials or runtime objects. Filenames and titles are labels, **not identity**. Moving, copying, or renaming the file does not change its internal `threadId`; explicitly creating a new thread gives it a new ID.

## Envelope

All fields below are required. A document is identified by its **format marker and supported schema version**, never by `.learn` alone.

| Field | v3 value / meaning |
| --- | --- |
| `format` | Exactly `"learnvas"`. |
| `version` | Integer `3`. |
| `threadId` | Stable, nonempty string. Learnvas generates a UUID for new threads; readers treat IDs as opaque strings. |
| `title` | Nonempty human-readable title; chosen by the user when creating a thread. |
| `createdAt` | Valid UTC timestamp, exactly `YYYY-MM-DDTHH:mm:ss.sssZ`. Immutable during ordinary saves. |
| `updatedAt` | Same timestamp syntax, not earlier than `createdAt`; timestamp of the saved snapshot. |
| `tutorNotes` | Optional string (up to 4000 characters when saved): standing tutor requests for this thread, appended to the tutor's system prompt alongside the global notes store. Empty/whitespace values must be **omitted** rather than saved and round-trip verbatim otherwise. Threads without notes simply lack the field. |
| `cards` | Ordered array of prompt and response records. Empty is valid. |
| `connections` | Ordered array of directed connections. Empty is valid. |
| `viewport` | `{ "x": number, "y": number, "zoom": number }`: canvas translation and zoom. `x`/`y` must be finite; `zoom` must be finite and positive. |

IDs must contain at least one non-whitespace character. Card IDs are unique within `cards`; connection IDs are unique within `connections`. The two ID namespaces are separate. Arrays retain their order; keys are emitted in a consistent order with two-space indentation and a trailing newline. JSON object key order and whitespace are not semantically significant.

An empty, valid document:

```json
{
  "format": "learnvas",
  "version": 3,
  "threadId": "e5131990-80b9-4489-bcae-d3d645c04b7c",
  "title": "Empty canvas",
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-01T10:00:00.000Z",
  "cards": [],
  "connections": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

## Cards

Card records are flat and independent of React Flow's node/data envelope.

### Common fields

| Field | Meaning |
| --- | --- |
| `id` | Required nonempty card ID. |
| `kind` | Required `"prompt"` or `"response"`. |
| `position` | Required `{ "x": number, "y": number }`, finite canvas coordinates of the card's top-left corner. Negative/fractional positions are valid. |
| `text` | Required string, including empty strings. Preserved verbatim: drafts, Markdown, Unicode, multiline text, partial responses, and recorded error messages. |
| `collapsed` | Required boolean. |
| `width`, `height` | Optional positive finite numbers in canvas units; independently optional. These are explicit user-saved dimensions, **not measured dimensions**. Omission lets the app size the card naturally. |

A collapsed card still saves its expanded height. On load, the UI applies width but does not apply the expanded wrapper height until the card is expanded. The saved height is not lost.

### Prompt-only fields

| Field | Meaning |
| --- | --- |
| `sent` | Required boolean. `false` preserves an unsent draft. Loading a `true` prompt does not resend it. |
| `quote` | Optional verbatim string containing a selected excerpt, including an empty string. Its parent is determined by the incoming connection; no separate quote reference exists. Not allowed on merge prompts. |
| `mergeContext` | Optional `"selected"` or `"histories"`. Its presence makes this a merge prompt, whose incoming connections identify its sources in connection-array order. `selected` includes only source-card content; `histories` includes their ancestry, respecting any earlier selected-only boundaries. |

### Response-only fields

| Field | Meaning |
| --- | --- |
| `model` | Required nonempty string: normally `"provider/model-id"` or `"pi default"`. This is recorded metadata, not authentication or a requirement that the model be available when opening the file. Model identifiers are opaque and need not be known to this installation. |
| `status` | Required `"done"`, `"error"`, or `"stopped"`. No persisted active-request state. |
| `sourcePromptId` | Required ID of the prompt this response answers; must match the incoming connection's source. |

Runtime `streaming` responses are exported as `stopped`, keeping every text chunk already present in canvas state. Unflushed network/batching buffers are not part of the generic projection; the browser's explicit export stops generation and flushes buffered text before saving and downloading. Importing a document with `status: "streaming"` is invalid, rather than implying that a request exists.

## Connections and graph invariants

Each connection requires exactly these fields:

| Field | Meaning |
| --- | --- |
| `id` | Nonempty unique connection ID. |
| `source`, `target` | Existing card IDs. |
| `sourceHandle` | One of `"s-top"`, `"s"` (right), `"s-bottom"`, `"s-left"`, `"s-corner"` (upper-right fallback). |
| `targetHandle` | One of `"t-top"`, `"t-right"`, `"t-bottom"`, `"t"` (left). |

Handles are explicit in the document. The UI adapter maps absent/null legacy **runtime** handles to `s`/`t`; a `.learn` file may not omit them. Handle sides need not be opposite: the saved attachment arrangement is preserved exactly, not recomputed from positions.

The graph is a directed acyclic graph (DAG):

- An ordinary prompt may be a root or have one parent, either a prompt (e.g. a quoted question) or a response.
- A merge prompt has one or more distinct incoming sources, either prompts or responses, including unrelated roots. Creation requires at least two selected cards; one source is valid after another source is deleted.
- A response must have exactly one incoming connection from the prompt identified by `sourcePromptId`.
- Any card may have multiple children, including multiple responses to one prompt/model comparisons and multiple children attached to the same port.
- No missing references, duplicate source/target pairs, self-connections, or cycles are allowed. Only merge prompts may have multiple parents.
- `sent` describes recorded prompt state; it is not inferred from the graph or used to execute requests.

Merged context includes each shared card once and labels independent conversation paths instead of flattening them into a fabricated chat transcript. Selected-only boundaries remain effective in subsequent continuations and nested history merges. Source-card text remains live context, not a frozen copy; deleting a source disconnects it. A shared merge and its descendants survive deletion while another source survives; deleting the merge itself or all its sources removes its downstream branch. Undo restores removed source connections.

## Validation and version/migration boundary

v3 is **strict**: missing required fields, incorrect types, unknown fields at any level, invalid dates, invalid dimensions/viewport values, and invalid graph references are rejected. Values are not coerced. Optional fields must be omitted rather than set to `null`. A plain JSON object is required. Standard `JSON.parse` semantics apply.

`validateDocument` checks the marker and version before validating the body. **Version 2 remains readable:** its original strict card and forest rules are validated first, then a detached v3 document is returned with identity, text, notes, layout, and timestamps unchanged. Reading/listing does not rewrite the source file or change its revision; the next save/export emits v3. v2 input cannot contain merge fields or multiple-parent prompts.

**Rollback:** older Learnvas builds cannot read v3 files. Back up v2 `.learn` files before editing/saving with this build if you need to return to an older build; reverting feature commits does not downgrade saved data. There is no lossy automatic downgrade of merged graphs.

Future versions need their own validator and explicit migration path. **Version 1 remains retired without migration.** Unsupported positive integer versions fail with `unsupported-version`, naming the version and supported versions. Missing/invalid markers fail with `invalid-format`; malformed JSON fails with `invalid-json`; other malformed fields fail with `invalid-document`. Errors include a field path. No silent downgrade, best-effort rewrite, or extension-based fallback is allowed.

Parsing and validation are read-only and return detached canonical objects. Serializing validates **before** JSON encoding so invalid numbers, undefined fields, and unexpected fields cannot quietly disappear. Helpers do not open, rename, truncate, or rewrite files. A caller must successfully validate before replacing current state or saving; rejected documents remain untouched.

Invalid/unsupported library documents are preserved with warnings. Save failures and stale revisions remain visible; switching cannot abandon unsaved work. Users may retry saving or create a separately named recovery copy. **Clear** resets only the active canvas, not its identity.

## Persisted versus runtime state

`canvasToDocument` projects an explicit allowlist instead of spreading React Flow nodes, edges, or arbitrary data. Automatic measurements, wrapper styles, selection, dragging, focus/autofocus signals, animated edges, activity/tool notes, credentials/configuration objects, AbortControllers, extension runtime state, network buffers, and undo history are not persisted. Theme remains an application preference.

`documentToCanvas` reconstructs node types, header drag handles, and explicit size styles. It initializes selection/dragging/focus and edge animation to inactive. It never creates requests, timers, model sessions, or extension instances.

**Text is not redacted.** A secret deliberately typed into a prompt or present in a response/quote remains part of that text; treat `.learn` files as potentially sensitive conversation records. Credentials are configured outside the document, not embedded as separate fields.

## Helpers, fixtures, and current storage

- [`src/lib/learnDocument.ts`](../src/lib/learnDocument.ts): canonical types; `createThreadMetadata`, `validateDocument`, `parseDocument`, `serializeDocument`, `canvasToDocument`, and `documentToCanvas`.
- [`src/lib/canvasStorage.ts`](../src/lib/canvasStorage.ts): legacy browser storage adapter (not used by current autosave), using exactly the same JSON format under `learnvas:document`.
- [`src/lib/portableDocument.ts`](../src/lib/portableDocument.ts): bounded UTF-8 uploads, schema/canonical-size validation, and download creation. The 8 MiB constant is shared with the bridge.
- [`src/lib/portableDocument.test.mjs`](../src/lib/portableDocument.test.mjs): cross-library round trips, duplicate/collision/cancel/error safety, size/version restrictions, current-state export and runtime exclusion.
- [`branched.learn`](../src/lib/fixtures/branched.learn): multiple roots, prompt/response branches, all port handles, unsent/empty drafts, quotes, different model IDs, partial/error answers, expanded/collapsed sizes, and a translated/zoomed viewport.
- [`empty.learn`](../src/lib/fixtures/empty.learn): a valid canvas with no cards.
- [`src/lib/learnDocument.test.mjs`](../src/lib/learnDocument.test.mjs): round trips, runtime exclusion, strict validation, read-only file rejection, and browser storage tests. Run `pnpm test` and `pnpm build`.

The browser autosaves through the bridge after a 400 ms debounce and restores each thread's saved viewport rather than fitting over it. New threads receive fresh stable IDs; **Clear** retains the active thread identity. Old `learnvas:document` and MVP `learnvas:v1` browser records are ignored, not migrated or deleted. Closing/reloading before saving finishes may lose the latest edits; back up library files separately.

The bridge reuses this validator and serializer directly; its [library API](thread-library.md) adds bounded sizes, filename rules, revision checks, and durable file operations without changing v3.

Out of scope: Pi transcript integration, arbitrary external-file editing, attachments, collaboration, automatic legacy migration, and persisted undo history.
