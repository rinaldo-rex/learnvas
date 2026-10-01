import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentLayout, openPorts, responseSide } from './ports.ts'

test('open sides account for incoming and outgoing connections, including legacy handles', () => {
  assert.deepEqual(openPorts('node', []), ['top', 'right', 'bottom', 'left'])
  assert.deepEqual(openPorts('node', [
    { source: 'parent', target: 'node', targetHandle: 't' },
    { source: 'node', target: 'child', sourceHandle: 's' },
    { source: 'unrelated', target: 'other', sourceHandle: 's-top' },
  ]), ['top', 'bottom'])
  assert.deepEqual(openPorts('node', [{ source: 'parent', target: 'node' }]), ['top', 'right', 'bottom'])
})

test('all connected sides always offer a corner, even after multiple corner connections', () => {
  const edges = ['s-top', 's', 's-bottom', 's-left'].map(sourceHandle => ({ source: 'node', target: sourceHandle, sourceHandle }))
  assert.deepEqual(openPorts('node', edges), ['corner'])
  edges.push({ source: 'node', target: 'extra1', sourceHandle: 's-corner' })
  edges.push({ source: 'node', target: 'extra2', sourceHandle: 's-corner' })
  assert.deepEqual(openPorts('node', edges), ['corner'])
  assert.deepEqual(openPorts('node', edges.filter(e => e.sourceHandle !== 's-top')), ['top'])
})

test('attachments lie beyond the selected side and connect to the facing side', () => {
  const source = { x: 100, y: 200, width: 340, height: 300 }
  const child = { width: 280, height: 160 }
  assert.deepEqual(attachmentLayout(source, 'top', child), {
    position: { x: 130, y: -50 }, sourceHandle: 's-top', targetHandle: 't-bottom',
  })
  assert.deepEqual(attachmentLayout(source, 'right', child), {
    position: { x: 530, y: 200 }, sourceHandle: 's', targetHandle: 't',
  })
  assert.deepEqual(attachmentLayout(source, 'bottom', child), {
    position: { x: 130, y: 590 }, sourceHandle: 's-bottom', targetHandle: 't-top',
  })
  assert.deepEqual(attachmentLayout(source, 'left', child), {
    position: { x: -270, y: 200 }, sourceHandle: 's-left', targetHandle: 't-right',
  })
  assert.deepEqual(attachmentLayout(source, 'corner', child, 260), {
    position: { x: 530, y: -310 }, sourceHandle: 's-corner', targetHandle: 't',
  })
})

test('responses continue away from the parent for every branch direction', () => {
  assert.equal(responseSide('t-bottom'), 'top')
  assert.equal(responseSide('t-top'), 'bottom')
  assert.equal(responseSide('t-right'), 'left')
  assert.equal(responseSide('t'), 'right')
  assert.equal(responseSide(), 'right')
})
