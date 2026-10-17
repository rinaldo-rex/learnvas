import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { diagramSourceProblem, diagramConfig, renderDiagram, MAX_DIAGRAM_LENGTH, FIT_TRANSFORM, zoomDiagram } from './mermaid.ts'
import { parseDocument, serializeDocument, documentToCanvas, canvasToDocument } from './learnDocument.ts'

const fixture = readFileSync(new URL('./fixtures/mermaid.md', import.meta.url), 'utf8')

test('ordinary flowcharts, sequences, multiline labels and dense diagrams pass preflight', () => {
  for (const source of fixture.matchAll(/```mermaid\n([\s\S]*?)```/g)) assert.equal(diagramSourceProblem(source[1]), null)
  assert.equal(diagramSourceProblem('flowchart LR\nA[First<br/>Second] --> B'), null)
  assert.equal(diagramSourceProblem('flowchart LR\nA <--> B'), null)
})

test('configuration, active/resource markup and custom styles fail before any renderer/DOM work', async () => {
  const rejected = [
    '', '   ', 'x'.repeat(MAX_DIAGRAM_LENGTH + 1),
    '---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\n A-->B',
    ' \n---\ntitle: Configuration\n---\nflowchart TD\nA-->B',
    '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\nA-->B',
    '%% \n{init: {"themeCSS": "@import x"}}%%\nflowchart TD\nA-->B',
    'flowchart TD\nA@{ img: "//example.test/tracker.svg" }',
    'flowchart TD\nA@ { shape: image, img: "/api/tracker" }',
    'flowchart TD\nA["<img src=/api/tracker onerror=alert(1)>"]',
    'flowchart TD\nA["<svg onload=alert(1)></svg>"]',
    'flowchart TD\nA["<iframe src=/api/tracker></iframe>"]',
    'flowchart TD\nA["![image](/api/tracker)"]',
    'flowchart TD\nA-->B\nstyle A fill:red',
    'flowchart TD\nA-->B;classDef test fill:red',
    'flowchart TD\nA-->B\nlinkStyle 0 stroke:red',
    'flowchart TD\nA-->B\nclick A "//example.test"',
    'flowchart TD\nA["https://example.test/image.svg"]',
    'flowchart TD\nA["url(/api/tracker)"]',
    'flowchart TD\nA["u\\72l(/api/tracker)"]',
    'C4Context\nPerson(a, "A")\nUpdateElementStyle(a, $bgColor="red; background-image:image-set(\'/api/tracker\' 1x)")',
  ]
  for (const source of rejected) {
    assert.ok(diagramSourceProblem(source), source)
    // Node has no document. A rejection here proves Mermaid's rendering DOM
    // is never reached for these resource/config payloads.
    await assert.rejects(renderDiagram(source, 'light', new AbortController().signal), error => !/document|window/i.test(error.message))
  }
})

test('strict config pins safety limits and supplies separate light/dark palettes', () => {
  const light = diagramConfig('light')
  const dark = diagramConfig('dark')
  assert.equal(light.securityLevel, 'strict')
  assert.equal(light.startOnLoad, false)
  assert.equal(light.suppressErrorRendering, true)
  assert.equal(light.htmlLabels, false)
  assert.equal(light.flowchart.htmlLabels, false)
  assert.equal(light.maxTextSize, MAX_DIAGRAM_LENGTH)
  assert.equal(light.maxEdges, 300)
  assert.equal(light.theme, 'default')
  assert.equal(dark.theme, 'dark')
  for (const option of ['securityLevel', 'maxEdges', 'maxTextSize', 'htmlLabels', 'dompurifyConfig']) assert.ok(light.secure.includes(option))
  assert.ok(light.dompurifyConfig.FORBID_TAGS.includes('img'))
  assert.notEqual(light.dompurifyConfig, dark.dompurifyConfig)
})

test('aborted queued renders do not import or invoke the DOM renderer', async () => {
  await assert.rejects(renderDiagram('flowchart TD\nA-->B', 'light', AbortSignal.abort()), { name: 'AbortError' })
  await assert.rejects(renderDiagram('flowchart TD\nC-->D', 'dark', AbortSignal.abort()), { name: 'AbortError' })
})

test('zoom is immutable, bounded, reversible and anchored at the pointer', () => {
  assert.deepEqual(zoomDiagram(FIT_TRANSFORM, 2), { scale: 2, x: 0, y: 0 })
  const point = { x: 80, y: -30 }
  const zoomed = zoomDiagram(FIT_TRANSFORM, 2, point)
  assert.deepEqual(zoomed, { scale: 2, x: -80, y: 30 })
  assert.deepEqual(zoomDiagram(zoomed, 0.5, point), FIT_TRANSFORM)
  assert.equal(zoomDiagram(zoomed, 100).scale, 8)
  assert.equal(zoomDiagram(zoomed, 0.001).scale, 0.25)
  assert.deepEqual(FIT_TRANSFORM, { scale: 1, x: 0, y: 0 })
})

test('Mermaid source round-trips verbatim through saved documents and canvas adapters without derived SVG/viewer state', () => {
  const document = parseDocument(readFileSync(new URL('./fixtures/branched.learn', import.meta.url), 'utf8'))
  const response = document.cards.find(card => card.kind === 'response')
  response.text = fixture
  const restored = parseDocument(serializeDocument(document))
  const canvas = documentToCanvas(restored)
  const answer = canvas.nodes.find(node => node.id === response.id)
  answer.data.svg = '<svg>derived, not persisted</svg>'
  answer.data.diagramZoom = 4
  const projected = canvasToDocument(canvas, restored)
  assert.equal(projected.cards.find(card => card.id === response.id).text, fixture)
  assert.equal(serializeDocument(projected), serializeDocument(restored))
})
