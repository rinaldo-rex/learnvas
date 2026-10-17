# Conversation merge verification

## Per-source scope follow-up (#22)

- `pnpm test`: **212 tests pass**; `pnpm build` passes (existing Vite large-chunk warning).
- Each draft source has a **Card only** / **Card + history** selector. Whole-merge buttons reset every source; sent merges lock controls and show **Mixed context** when applicable.
- Regression tests cover both override directions, shared-history deduplication, nested/continued exclusions, literal vs expanded paths in either visit order, strict connection validation, source deletion/undo, and persistence/export/import across isolated libraries.
- System Chrome against both production and Vite development builds, with a temporary library and deterministic SSE endpoint, verified source order, real-keyboard selection, reset-all behavior, autosave/reload, captured mixed request context, sent locking/collapse, and light/dark/narrow rendering without paid provider calls. The browser harness could not start; the documented Playwright fallback was used. No page exceptions.
- Only `.learn` **v5** is supported. Older experimental schemas are rejected without modifying existing files; migration support and the legacy fixture were removed by agreement.

The sections below record the original whole-merge implementation's verification.

## Original automated checks

- `pnpm test`: **173 tests pass** (154 before this feature).
- `pnpm build`: TypeScript and production build pass. Vite still reports the existing large-chunk warning.
- `git diff --check`: clean.

New regression coverage includes:

- v3 merge scopes and source-order round trips; strict rejection of malformed scopes, duplicate sources, cycles, ambiguous quotes, and multiple-parent ordinary prompts/responses.
- Strict, read-only v2-to-v3 upgrades: unchanged identity/content and original bytes/revision until a revision-checked save. Stale writes still fail.
- Unrelated roots, sibling branches, overlapping ancestry, and deduplication of shared cards.
- Selected-only boundaries in later continuations, nested merges, and cards reached through both literal and history paths.
- Ordinary transcript/quote compatibility and histories longer than the old 1000-card cutoff.
- Merge-draft source validation, default scope, placement, and runtime-state exclusion.
- Shared-source deletion, deleting all sources/a common root, explicit merge deletion, and undo restoring source connections without rolling back edits.
- Export/import across isolated file libraries, retaining source order and context boundaries for both scopes.

## Real-browser checks

Ran headless system Chrome through Playwright against Vite and the actual library HTTP API, using a temporary library. The chat endpoint was a deterministic SSE stub: **no personal library data or paid model calls**. The normal browser harness was unavailable because no browser instance was running.

Verified both **Selected cards only** and **Cards + histories**:

- Real **S**, click-to-toggle, **M**, and **Ctrl+Enter** input; selection with Space/Enter also works.
- At least two sources required; three answers selected across shared and unrelated roots.
- Selecting does not collapse cards, edit their text, or generate a response.
- Merge draft opens, takes focus, preserves original cards, and has all incoming connections. Creation alone sends no request.
- Real typing of shortcut letters inside the draft does not trigger canvas actions.
- Draft text/scope/connections autosave and survive reload without generation.
- Captured request context matches the selected scope, preserves source ordering, and includes shared history once.
- A separate response appears; the saved scope badge remains visible after sending.
- Continuing from that response retains the scope boundary; excluded histories do not reappear.
- Hover-X deletes one source while keeping the shared merge; Ctrl+Z restores its source connection.
- Selection/cancel works in zen mode; its bar fits a 430px-wide viewport.
- Existing response resize, collapse/expand size restoration, and real text-selection quote branching still work with the selection wrapper.
- Light/dark draft rendering and selection highlighting checked visually.
- No application console errors or page exceptions. Chrome requested the pre-existing missing `/favicon.ico` (404), unrelated to merges.

The browser run validates request construction and streaming UI, not the quality of a real provider's synthesis. There is still no committed browser-test runner; pure logic, persistence, and portability regressions run with `pnpm test`.

## Rollback and deliberate limits

- Feature work is split into conventional, atomic commits on `feat/conversation-merges`; the pre-existing untracked `pnpm-workspace.yaml` is untouched.
- Current saves/exports emit `.learn` v5 only. Earlier experimental files are intentionally unsupported and are not migrated or deleted. Reverting code does not downgrade saved data.
- Per-source scopes are supported by #22; settings remain locked once sent. Compare scopes using separate merge drafts.
- Sources are live card references, not frozen snapshots. Re-running uses their current content. Deleting a source disconnects it; remaining sources keep the shared merge alive.
- Merge creation itself is not undoable; existing deletion undo can remove/restore a merge branch.
