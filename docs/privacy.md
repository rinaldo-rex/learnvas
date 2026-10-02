# Data and privacy

[← Learnvas](../README.md)

## What is saved

Canvas data is stored in browser `localStorage` under `learnvas:document`, using the [portable `.learn` v1 format](learn-format.md); theme preference uses `learnvas:theme`. The document saves a stable thread ID, title, timestamps, text/quotes/model identifiers, cards, connections, explicit sizes/collapse state, and viewport. Browser-local storage is **not a backup**.

The old MVP `learnvas:v1` storage is ignored, with no migration. New canvases have an internal “Untitled” title until named-thread UI is implemented. Invalid or unsupported saved documents produce a visible error and disable autosave so they are not silently overwritten; **Clear** explicitly discards the unreadable document after confirmation.

Storage belongs to the browser profile and origin. Changing the hostname or port, using another profile, or clearing site data can make the canvas unavailable. Saving may fail if browser storage is blocked or full.

There is currently no canvas export/import UI, filesystem library, account sync, or collaboration. Reloading does not resume generation; saved partial answers are marked stopped. Text/layout is portable, but continuing generation requires configured model credentials. Runtime objects, credentials/configuration fields, extension state, and undo stacks are not stored in the document. Text itself is not redacted.

Saves use a 400 ms debounce. Reloading or closing before it finishes may lose the latest changes. Storage failures are shown in the toolbar; the canvas remains editable in memory.

Pi sessions are in-memory and are not saved as Pi session files by Learnvas. The browser canvas is the persisted conversation record.

## What leaves your machine

Prompts and the selected branch's history are sent to the chosen model provider. Web tools may send queries or URLs to external services. Learnvas is not an offline-only tutor.

Responses can be inaccurate. Verify important claims and sources, especially for consequential decisions.

## Tutor isolation

Each request creates a fresh, in-memory Pi session with a Learnvas tutor system prompt. It does not load `AGENTS.md` context files, skills, prompt templates, or Pi themes into the tutor session. Built-in file and shell tools are not enabled.

Web-enabled tutor requests explicitly load only `pi-web-access` with an allowlisted tool set. Tool-free requests load no extensions and have no tools. The bridge separately loads Pi extensions at startup for provider/model registration; see [Models and configuration](configuration.md).

**This is configuration isolation, not a security sandbox.** Startup extensions and the web extension execute local code with the bridge process's permissions. Load only extensions you trust.

## Local-service security

The bridge has **no authentication** and currently listens without an explicit loopback-only bind. Keep it on a trusted local machine; do not expose it to untrusted networks or deploy it as a public service without adding access controls.

Keep Pi credentials private. Redact API keys, tokens, private prompts, and other sensitive information from logs and bug reports.

Related: [Getting started](getting-started.md) · [Troubleshooting](troubleshooting.md).
