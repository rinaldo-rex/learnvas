# Thinking-effort comparison verification (#25)

## Scope

Effort choices live inside each expanded prompt card. One model remains selected in the toolbar. Ask/Re-run (including Ctrl/Cmd+Enter) starts the selected efforts together, with a visible response count. No separate Compare action, multi-model batch, benchmark, or background generation was added.

## Automated checks

```bash
pnpm test
pnpm build
```

New coverage:

- `server/tutor.test.mjs`: actual SDK capability helpers/default clamping, a disposable default-model probe, metadata before text, requested/effective differences, pinned-model fallback rejection, unsupported/unverifiable thinking, invalid request rejection, identical supplied notes/context, independent stream aborts, errors without retries, disconnect during creation, and legacy single-request behavior.
- `server/tutorSdk.test.mjs`: creates a real installed-SDK session with an isolated temporary agent directory and bundled model catalog, without credentials, network discovery, tools, or prompting. Confirms the capability/session-metadata APIs and memory-only retry/cache-warming policy. No provider request is made.
- `src/lib/api.test.mjs`: snapshot payloads, chunked metadata/text, one terminal callback, unexpected EOF, invalid metadata, silent aborts, and stale-bridge restart guidance.
- `src/lib/thinking.test.mjs`: one-effort defaults, empty/unsupported selections, independent submission snapshots, resized-sibling placement, honest labels, strict v2/v3 upgrades, and v4 selections/metadata round trips and rejection cases.
- Existing graph, merge, library, portable export, thread switching, stale-stream, deletion, and Mermaid tests remain enabled. Current fixtures emit v4; `legacy-v3.learn` retains an original v3 document for migration checks.

## Browser checks

Use a temporary file library and mocked SDK sessions with held streaming responses; do not generate paid answers or seed a personal library. Include a reasoning model supporting Low/High, a non-thinking model, an effort-limited model, and an old response with no thinking fields.

1. Two prompts initially show a single model-default choice. Selecting Low + High on one prompt does not change the other. Empty selection disables Ask and Ctrl/Cmd+Enter does not submit.
2. Ask shows **2 responses** and starts two streams immediately. Both use the same concrete model/context/notes; only effort differs. New siblings do not overlap each other or a resized sibling on the same continuation side.
3. Labels show the bridge-confirmed setting, including collapsed cards. Changing controls/model mid-flight does not relabel existing answers. Before confirmation, show requested effort as unconfirmed; missing historical metadata stays not recorded. A requested/effective difference displays both.
4. A new model's incompatible choices remain visible and block submission until reviewed. A non-thinking model offers **Use normal answer**, sends one request, and reports not supported rather than an invented effort.
5. Stop one stream; the other continues. A provider error does not stop/retry the other. Delete a live response and confirm only its request is aborted. Re-run keeps previous answers.
6. Switch threads with two active answers: both stop/flush/save with their metadata. Late events never modify the destination thread. Returning/reloading never resumes generation.
7. Export with two active answers: both are stopped and their buffered text/metadata is included. Import into a separate thread, open it, reload, and check saved prompt selections and answer labels. No model call occurs on open/import.
8. Check light/dark and phone-width layouts, keyboard checkbox use, response collapse, and ordinary canvas/Markdown/Mermaid interactions.

Implemented UI checks used system Chrome and a temporary Playwright driver with the real library API and injectable tutor handler, deterministic fake sessions, and no paid provider calls. Both the production build and Vite/React Strict Mode exercised parallel generation, per-prompt independence, empty/model-incompatible choices, unsupported thinking, errors/deletion/stop isolation, label differences, switching, and active export/import/reload. Checks also confirmed that merely opening a raw v3 document did not rewrite it, and that incompatible untouched defaults require review. Screenshots checked light/dark/narrow layouts. The SDK integration test separately checks the real installed SDK without prompting.

## Format and API notes

- New saves are strict `.learn` **v4**. v2/v3 validate under their own original field rules, then upgrade in memory without adding historical settings or rewriting bytes on read. Subsequent edits/saves/export write v4. **Older builds cannot read v4**; preserve v2/v3 backups for rollback.
- `thinkingEfforts` belongs to a prompt's next request; `requestedThinking` and bridge-confirmed `thinking` belong to individual answers. Missing confirmation remains unknown, including a stop/failure before metadata arrives.
- Model/effort metadata reports SDK session configuration, not measured compute or unreported physical-model/router adjustments. Higher effort is not a quality guarantee.
- The client snapshots its displayed global notes plus thread notes for all sibling requests. Session settings are copied into memory, with automatic retry/compaction/cache-warming calls disabled; shared Pi defaults remain untouched.
- After upgrading the frontend, restart the bridge too. An old inventory contract shows restart/reload guidance instead of guessing effort capabilities.

No live-provider quality, latency, cost, or internal reasoning claims were tested or made.
