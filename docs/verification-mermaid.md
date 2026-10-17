# Mermaid diagram verification (#24)

## Automated checks

```bash
pnpm test
pnpm build
```

`src/lib/mermaid.test.mjs` covers source preflight before DOM work, strict light/dark configuration, aborted queued renders, bounded pointer-anchored zoom, and verbatim Markdown round trips through `.learn`/canvas adapters. `src/lib/fixtures/mermaid.md` contains mixed Markdown/code, a small flowchart, a sequence diagram, a dense flowchart, a malformed block, and a valid diagram after that failure.

Mermaid is lazy-loaded only for eligible, non-streaming diagrams. Production builds include its local diagram chunks; bundle-size warnings are expected. No external renderer/CDN, new service, persisted SVG, or schema change is required.

## Manual fixture without model calls

Create a portable fixture, then use **Threads → Import .learn** and explicitly open the imported thread. This command only writes a temporary file:

```bash
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises'
const now = new Date().toISOString()
const text = await readFile('src/lib/fixtures/mermaid.md', 'utf8')
const document = {
  format: 'learnvas', version: 4, threadId: crypto.randomUUID(),
  title: 'Mermaid checks', createdAt: now, updatedAt: now,
  cards: [
    { id: 'q', kind: 'prompt', text: 'Diagram fixture', position: { x: 0, y: 0 }, collapsed: true, sent: true },
    { id: 'a', kind: 'response', text, position: { x: 0, y: 220 }, collapsed: false,
      width: 520, height: 600, model: 'fixture/offline', status: 'done', sourcePromptId: 'q' },
  ],
  connections: [{ id: 'qa', source: 'q', target: 'a', sourceHandle: 's-bottom', targetHandle: 't-top' }],
  viewport: { x: 80, y: 100, zoom: 0.8 },
}
await writeFile('/tmp/mermaid-checks.learn', JSON.stringify(document, null, 2))
JS
```

Verify:

- Four valid diagrams render independently; the malformed block stays readable and does not prevent the final valid diagram from rendering. Inline code and the JavaScript fence stay ordinary code.
- Each **Open larger view** opens the correct diagram. Wheel/trackpad zoom anchors around the pointer; dragging pans; **−**, **+**, and **Reset to fit** work by keyboard too.
- Tab/Shift+Tab stay in the modal. **Esc**, **Close ×**, and backdrop clicks close it; focus returns to its opener. Opening/viewing/closing does not move/resize cards or save viewer state.
- Viewer gestures do not scroll/zoom the canvas, and S/M/X/Z do not activate behind the modal. Figure controls do not collapse cards or create quoted branches. Ordinary answer-text selection still branches.
- Both themes remain readable, including an OS theme change while a viewer is open. A narrow-screen viewer fits the window. Resize/collapse/expand preserves card size and source; merge-selection mode keeps diagram controls inert.
- Reload and export/import preserve Markdown verbatim, without generation, credentials, derived images, or viewer transforms. A scrollable response still captures wheel scrolling after its diagrams finish loading.

For streaming/stop checks, use a stub chat response: emit an incomplete Mermaid fence and hold the SSE connection open. The source must stay readable without repeated error banners. Finish a valid block and end generation (or stop it after the complete block arrives); that block should then render. Invalid/stopped incomplete blocks remain source.

For security checks, include raw/entity-encoded HTML image labels, image-shape assets, Markdown images, custom configuration directives/frontmatter, click links, and custom style/C4 style directives. Unsafe/unsupported features must stay source or be sanitized as inert text, never execute callbacks or fetch external assets. Inspect network requests, not just the final SVG. This is a conservative read-only subset, not a general-purpose Mermaid sandbox.

## Implementation validation

Checked in system Chrome with a temporary Playwright driver against an isolated file library and deterministic SSE stub (no real provider calls or personal threads), on both the production build and Vite/React Strict Mode:

- Multiple/mixed/dense diagrams, invalid-block recovery, raw/encoded hostile labels, and source fallback.
- Zoom buttons, wheel zoom, pointer pan, reset, focus trapping/return, canvas isolation, independent diagram targets, light/dark/system changes, and phone-width layout.
- Resize/collapse/expand, selection-mode inertness, verbatim reload/import/export, incomplete streaming, and rendering a stopped answer's complete diagram.

The dev-only proxy used for this check did not forward Vite's HMR WebSocket; this produced an HMR warning, not an application error. Production checks had no application errors. No external diagram-asset requests were observed.
