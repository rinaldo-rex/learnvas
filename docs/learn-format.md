# Portable `.learn` document format — v1

[← Learnvas](../README.md)

A learning thread is **one complete canvas**, including any number of root conversations and branches. A `.learn` file is readable UTF-8 JSON, not a database, archive, or executable Pi session.

Saved text and layout are portable without Pi or model access. **Continuing generation requires configured model credentials** and an available provider. Opening a document must never start a request, execute extensions, or restore a Pi transcript/session.

The [bridge file-library API](thread-library.md) manages `~/.learnvas/<human-readable-title>.learn`, with confirmed numbered filenames for collisions and recoverable trash. Named-thread UI, browser file-library integration, and export/import UI are not implemented. Filenames and titles are labels, **not identity**. Moving, copying, or renaming the file does not change its internal `threadId`; explicitly creating a new thread gives it a new ID.

## Envelope

All fields below are required. A document is identified by its **format marker and supported schema version**, never by `.learn` alone.

| Field | v1 value / meaning |
| --- | --- |
| `format` | Exactly `"learnvas"`. |
| `version` | Integer `1`. |
| `threadId` | Stable, nonempty string. Learnvas generates a UUID for new threads; readers treat IDs as opaque strings. |
| `title` | Nonempty human-readable title; currently `"Untitled"` for a new browser canvas. |
| `createdAt` | Valid UTC timestamp, exactly `YYYY-MM-DDTHH:mm:ss.sssZ`. Immutable during ordinary saves. |
| `updatedAt` | Same timestamp syntax, not earlier than `createdAt`; timestamp of the saved snapshot. |
| `cards` | Ordered array of prompt and response records. Empty is valid. |
| `connections` | Ordered array of directed connections. Empty is valid. |
| `viewport` | `{ "x": number, "y": number, "zoom": number }`: canvas translation and zoom. `x`/`y` must be finite; `zoom` must be finite and positive. |

IDs must contain at least one non-whitespace character. Card IDs are unique within `cards`; connection IDs are unique within `connections`. The two ID namespaces are separate. Arrays retain their order; keys are emitted in a consistent order with two-space indentation and a trailing newline. JSON object key order and whitespace are not semantically significant.

An empty, valid document:

```json
{
  "format": "learnvas",
  "version": 1,
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
| `quote` | Optional verbatim string containing a selected excerpt, including an empty string. Its parent is determined by the incoming connection; no separate quote reference exists. |

### Response-only fields

| Field | Meaning |
| --- | --- |
| `model` | Required nonempty string: normally `"provider/model-id"` or `"pi default"`. This is recorded metadata, not authentication or a requirement that the model be available when opening the file. Model identifiers are opaque and need not be known to this installation. |
| `status` | Required `"done"`, `"error"`, or `"stopped"`. No persisted active-request state. |
| `sourcePromptId` | Required ID of the prompt this response answers; must match the incoming connection's source. |

Runtime `streaming` responses are exported as `stopped`, keeping every text chunk already present in canvas state. Unflushed network/batching buffers are not part of the snapshot. Importing a document with `status: "streaming"` is invalid, rather than implying that a request exists.

## Connections and graph invariants

Each connection requires exactly these fields:

| Field | Meaning |
| --- | --- |
| `id` | Nonempty unique connection ID. |
| `source`, `target` | Existing card IDs. |
| `sourceHandle` | One of `"s-top"`, `"s"` (right), `"s-bottom"`, `"s-left"`, `"s-corner"` (upper-right fallback). |
| `targetHandle` | One of `"t-top"`, `"t-right"`, `"t-bottom"`, `"t"` (left). |

Handles are explicit in the document. The UI adapter maps absent/null legacy **runtime** handles to `s`/`t`; a `.learn` file may not omit them. Handle sides need not be opposite: the saved attachment arrangement is preserved exactly, not recomputed from positions.

The graph is a directed forest:

- A prompt may be a root or have one parent, either a prompt (e.g. a quoted question) or a response.
- A response must have exactly one incoming connection from the prompt identified by `sourcePromptId`.
- Any card may have multiple children, including multiple responses to one prompt/model comparisons and multiple children attached to the same port.
- No missing references, self-connections, cycles, or multiple parents are allowed.
- `sent` describes recorded prompt state; it is not inferred from the graph or used to execute requests.

These constraints keep conversation ancestry unambiguous for future generation.

## Validation and version/migration boundary

v1 is **strict**: missing required fields, incorrect types, unknown fields at any level, invalid dates, invalid dimensions/viewport values, and invalid graph references are rejected. Values are not coerced. Optional fields must be omitted rather than set to `null`. A plain JSON object is required. Standard `JSON.parse` semantics apply.

`validateDocument` checks the marker and version before validating the v1 body. This is the migration boundary: future schema versions need their own validator and explicit migration path. There are currently **no migrations**. Unsupported positive integer versions fail with `unsupported-version` and a message naming the version and the supported version. Missing/invalid markers fail with `invalid-format`; malformed JSON fails with `invalid-json`; other malformed fields fail with `invalid-document`. Errors include a field path. No silent downgrade, best-effort rewrite, or extension-based fallback is allowed.

Parsing and validation are read-only and return detached canonical objects. Serializing validates **before** JSON encoding so invalid numbers, undefined fields, and unexpected fields cannot quietly disappear. Helpers do not open, rename, truncate, or rewrite files. A caller must successfully validate before replacing current state or saving; rejected documents remain untouched.

If browser loading fails, Learnvas displays the error and disables autosave for that session, preserving the original storage entry. **Clear** explicitly asks permission to discard it and start a new thread. Storage quota/blocking failures are also shown; editing can continue in memory and later changes retry saving.

## Persisted versus runtime state

`canvasToDocument` projects an explicit allowlist instead of spreading React Flow nodes, edges, or arbitrary data. Automatic measurements, wrapper styles, selection, dragging, focus/autofocus signals, animated edges, activity/tool notes, credentials/configuration objects, AbortControllers, extension runtime state, network buffers, and undo history are not persisted. Theme remains an application preference.

`documentToCanvas` reconstructs node types, header drag handles, and explicit size styles. It initializes selection/dragging/focus and edge animation to inactive. It never creates requests, timers, model sessions, or extension instances.

**Text is not redacted.** A secret deliberately typed into a prompt or present in a response/quote remains part of that text; treat `.learn` files as potentially sensitive conversation records. Credentials are configured outside the document, not embedded as separate fields.

## Helpers, fixtures, and current storage

- [`src/lib/learnDocument.ts`](../src/lib/learnDocument.ts): canonical types; `createThreadMetadata`, `validateDocument`, `parseDocument`, `serializeDocument`, `canvasToDocument`, and `documentToCanvas`.
- [`src/lib/canvasStorage.ts`](../src/lib/canvasStorage.ts): browser storage adapter, using exactly the same JSON format under `learnvas:document`.
- [`branched.learn`](../src/lib/fixtures/branched.learn): multiple roots, prompt/response branches, all port handles, unsent/empty drafts, quotes, different model IDs, partial/error answers, expanded/collapsed sizes, and a translated/zoomed viewport.
- [`empty.learn`](../src/lib/fixtures/empty.learn): a valid canvas with no cards.
- [`src/lib/learnDocument.test.mjs`](../src/lib/learnDocument.test.mjs): round trips, runtime exclusion, strict validation, read-only file rejection, and browser storage tests. Run `pnpm test` and `pnpm build`.

The browser autosaves after a 400 ms debounce and restores the saved viewport rather than fitting over it. New canvases and **Clear** receive a fresh stable thread ID. The old MVP `learnvas:v1` raw-node storage entry is intentionally ignored, not migrated or deleted. Browser-local storage is still not a backup, and closing/reloading before the debounce completes may lose the latest edits.

The bridge reuses this validator and serializer directly; its [library API](thread-library.md) adds bounded sizes, filename rules, revision checks, and durable file operations without changing v1.

Out of scope: Pi transcript integration, arbitrary external-file editing, attachments, collaboration, browser file-library integration, and persisted undo history.
