# Development

[← Learnvas](../README.md)

See [Getting started](getting-started.md) for installation and provider authentication.

## Commands

Run these from the project directory:

| Command | Purpose |
| --- | --- |
| `pnpm install` / `just setup` | Install dependencies. |
| `just learn` | Start the bridge and browser app together. |
| `pnpm bridge` | Start only the Pi bridge. |
| `pnpm dev` | Start only Vite. |
| `pnpm test` | Run Node's test runner for document serialization/validation/storage, isolated file-library APIs/security/recovery, thread switching/save failures/conflicts/stream ownership, deletion history, extension inventory, ports, and themes. |
| `pnpm build` / `just build` | Type-check TypeScript and build the frontend into `dist/`. |
| `pnpm preview` | Preview the built frontend; this is not a complete application launcher and does not start the bridge. |

## Architecture

```mermaid
flowchart TD
  A[React canvas] -->|same-origin /api| B[Vite proxy]
  B --> C[Node HTTP bridge]
  C --> D[Fresh Pi tutor session]
  C -->|Canvas autosave| F[Managed .learn files]
  D --> E[Selected model provider]
  C -->|SSE text and tool events| A
```

- **Frontend:** React 19, TypeScript, Vite, and [React Flow](https://reactflow.dev/). Prompt and response cards are custom node types. `react-markdown`, `remark-gfm`, and `remark-breaks` render answer text.
- **Bridge:** Node's built-in HTTP server and `@earendil-works/pi-coding-agent`; no separate backend framework or database.
- **Conversation graph:** Directed edges connect cards. Before sending, the frontend walks only the prompt's ancestry to assemble user/assistant messages. The bridge folds those messages into a transcript plus the new question for a fresh Pi session.
- **Streaming:** The bridge emits Server-Sent Events over the chat POST response. The frontend batches text updates with `requestAnimationFrame`.

Provider warmup, per-request extension loading, and tutor isolation are explained in [Models and configuration](configuration.md) and [Data and privacy](privacy.md).

## Source map

Paths below are relative to the project root.

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Canvas state, persistence, model selection, branch history, and response lifecycle. |
| `src/nodes/` | Prompt and response card interactions and rendering. |
| `src/components/NodePorts.tsx` | Hover **+** buttons and connection handles. |
| `src/components/ExtensionsPanel.tsx` | Read-only extension inventory. |
| `src/components/HelpButton.tsx`, `public/help.html` | Modal help overlay and its self-contained HTML guide. |
| `src/lib/api.ts` | Model/inventory requests and SSE consumption. |
| `src/lib/ports.ts` | Available sides, branch placement, and response direction. |
| `src/lib/learnDocument.ts`, `src/lib/canvasStorage.ts` | Canonical `.learn` v1 schema, validation/serialization, UI projection, and browser storage. See [format specification](learn-format.md). |
| `src/lib/fixtures/*.learn` | Representative portable canvases used by round-trip tests. |
| `src/lib/theme.ts`, `src/lib/useTheme.ts`, `src/theme.css` | Theme preference, system appearance, and color tokens. |
| `server/index.mjs` | Pi session creation, provider warmup, and bridge startup (loopback-only). |
| `server/http.mjs` | Trusted-origin/Host boundary, bounded JSON bodies, library routes, and structured errors. |
| `server/library.mjs`, `server/library.test.mjs` | Revision-checked durable `.learn` operations, collision confirmation, trash/restore, recovery journals, and isolated API/failure tests. |
| `server/extensions.mjs` | Plain-JSON projection of loader metadata, without exposing runtime objects. |
| `vite.config.ts` | Frontend server and local API proxy. |

The bridge exposes `GET /api/models`, `GET /api/extensions`, `POST /api/chat`, and the [thread-library endpoints](thread-library.md#http-endpoints). Chat streams contain `delta`, `tool`, `done`, and `error` events. All routes enforce trusted local request headers. Library operations do not require model credentials or wait for Pi warmup.

The bridge imports the canonical TypeScript validator using Node's built-in type stripping (Node 22.19+); no separate schema copy, database, or backend dependency is introduced. API tests use temporary directories and ephemeral loopback ports, never `~/.learnvas/`. The browser uses `threadApi.ts` and the serial mutation controller `threadWorkspace.ts`. `ThreadPanel.tsx` provides the collapsible sidebar; `streamOwner.ts` invalidates late generation callbacks when stopped/unmounted. Canvas bindings capture synchronous refs, including flushed stream buffers, before switching. A keyed provider remount resets graph and deletion history; saved viewports are applied on initialization. Legacy `canvasStorage.ts` remains only as a tested adapter, not active persistence.

## Contribution checks

Before submitting a change:

```bash
pnpm test
pnpm build
```

There is no committed browser-test runner yet. For UI changes, also manually check text-selection branching, all four continuation sides and the corner fallback, header dragging, resized-card collapse, and both color themes. Describe the UI behavior you verified.

For bug reports, see [Troubleshooting](troubleshooting.md#reporting-a-problem).
