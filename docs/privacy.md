# Data and privacy

[← Learnvas](../README.md)

## What is saved

Named canvases autosave as [portable `.learn` v1 documents](learn-format.md) through the bridge's [filesystem library](thread-library.md) under `~/.learnvas/`, with revision-checked saves and recoverable `.trash/`. The document saves a stable thread ID, title, timestamps, text/quotes/model identifiers, cards, connections, explicit sizes/collapse state, and viewport.

Browser `localStorage` holds only convenience preferences: `learnvas:last-thread` and `learnvas:theme`. Clearing site data does not delete library files. Old `learnvas:document` and `learnvas:v1` canvases are ignored, without automatic migration or deletion. Invalid/unsupported library files are preserved and reported as warnings, never rewritten silently.

There is currently no canvas export/import UI, account sync, or collaboration. Reloading does not resume generation; saved partial answers are marked stopped. Text/layout is portable, but continuing generation requires configured model credentials. Runtime objects, credentials/configuration fields, extension state, and undo stacks are not stored in the document. Text itself is not redacted.

Saves use a 400 ms debounce. Reloading or closing before it finishes may lose the latest changes. Storage failures/conflicts are shown in the toolbar and thread panel; the canvas remains editable in memory. Switching refuses to abandon unsaved work. Retry explicitly, or save a separately named recovery copy. Stop the bridge before manually editing library files.

Pi sessions are in-memory and are not saved as Pi session files by Learnvas. `.learn` files are conversation records, not executable Pi sessions. Treat both as potentially sensitive; file-library documents retain conversation text verbatim.

## What leaves your machine

Prompts and the selected branch's history are sent to the chosen model provider. Web tools may send queries or URLs to external services. Learnvas is not an offline-only tutor.

Responses can be inaccurate. Verify important claims and sources, especially for consequential decisions.

## Tutor isolation

Each request creates a fresh, in-memory Pi session with a Learnvas tutor system prompt. It does not load `AGENTS.md` context files, skills, prompt templates, or Pi themes into the tutor session. Built-in file and shell tools are not enabled.

Web-enabled tutor requests explicitly load only `pi-web-access` with an allowlisted tool set. Tool-free requests load no extensions and have no tools. The bridge separately loads Pi extensions at startup for provider/model registration; see [Models and configuration](configuration.md).

**This is configuration isolation, not a security sandbox.** Startup extensions and the web extension execute local code with the bridge process's permissions. Load only extensions you trust.

## Local-service security

The bridge binds **127.0.0.1 only** and checks loopback peers, trusted Host headers, and trusted browser Origin/Referer headers for every endpoint. Vite also defaults to a loopback bind. Cross-site browser requests are rejected and no CORS access is granted. Library requests cannot submit arbitrary filesystem paths; symlinked directories/documents and hardlinked files are rejected.

These checks are **not authentication against local programs**, which can forge headers. Use a trusted local machine and trusted apps on allowlisted origins. Do not expose the bridge through remote proxies or deploy it publicly. See [library access boundaries and configuration](thread-library.md#local-access-boundary).

File writes are staged, synced, and atomic, with recovery journals for moves. Standard revision checks protect against stale browser tabs and changes detected before replacement. Stop the bridge before manually editing managed files; unrelated editors do not participate in its writer lock. Back up the library separately—trash and atomic writes are not substitutes for backups.

Keep Pi credentials private. Redact API keys, tokens, private prompts, and other sensitive information from logs and bug reports.

Related: [Getting started](getting-started.md) · [Troubleshooting](troubleshooting.md).
