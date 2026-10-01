import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyExtensionReport, extensionLoadReport } from './extensions.mjs'

function extension(path, options = {}) {
  return {
    path,
    resolvedPath: path,
    sourceInfo: { source: 'npm:example', scope: 'user' },
    tools: new Map([['z_tool', { execute() {} }], ['a_tool', {}]]),
    commands: new Map([['hello', {}]]),
    handlers: new Map([['session_start', [() => {}]]]),
    ...options,
  }
}

test('inventory is a plain metadata snapshot, not executable extension/runtime state', () => {
  const loaded = extension('/agent/npm/example/index.ts')
  const result = {
    extensions: [loaded],
    errors: [{ path: '/bad.ts', error: 'failed to load', privateStack: 'not exposed' }],
    warnings: [{ path: '/warning.ts', warning: 'duplicate dependency' }],
    runtime: { credentials: 'must never be serialized' },
  }
  const report = extensionLoadReport(result)
  assert.deepEqual(report, {
    extensions: [{
      name: 'example', path: '/agent/npm/example/index.ts', source: 'npm:example', scope: 'user',
      tools: ['a_tool', 'z_tool'], commands: ['hello'], events: ['session_start'],
    }],
    errors: [{ path: '/bad.ts', error: 'failed to load' }],
    warnings: [{ path: '/warning.ts', warning: 'duplicate dependency' }],
    error: null,
  })
  loaded.tools.set('new_tool', {})
  assert.deepEqual(report.extensions[0].tools, ['a_tool', 'z_tool'], 'snapshot is independent of later registrations')
  assert.doesNotMatch(JSON.stringify(report), /credentials|execute|privateStack/)
})

test('local names, missing optional source metadata, ordering, and initialization failures', () => {
  const report = extensionLoadReport({
    extensions: [
      extension('/user/zebra.ts', { sourceInfo: undefined }),
      extension('/user/alpha.ts', { sourceInfo: undefined }),
    ],
    errors: [],
  }, 'No model available')
  assert.deepEqual(report.extensions.map(e => e.name), ['alpha', 'zebra'])
  assert.equal(report.extensions[1].source, '')
  assert.equal(report.extensions[1].scope, '')
  assert.deepEqual(report.warnings, [])
  assert.equal(report.error, 'No model available')
})

test('package labels identify src/dist entrypoints and distinguish multi-extension packages', () => {
  const report = extensionLoadReport({
    extensions: [
      extension('/npm/pi-web-access/dist/index.js', { sourceInfo: { source: 'npm:pi-web-access@1.2.3', scope: 'user' } }),
      extension('/npm/@example/pi-tools/src/index.ts', { sourceInfo: { source: 'npm:@example/pi-tools', scope: 'user' } }),
      extension('/npm/@example/pi-tools/extensions/guard/index.ts', { sourceInfo: { source: 'npm:@example/pi-tools', scope: 'user' } }),
    ],
    errors: [],
  })
  assert.deepEqual(report.extensions.map(e => e.name), [
    '@example/pi-tools', '@example/pi-tools / guard', 'pi-web-access',
  ])
})

test('empty inventory handles no installed/loaded extensions without inventing entries', () => {
  assert.deepEqual(extensionLoadReport({ extensions: [], errors: [] }), emptyExtensionReport())
})
