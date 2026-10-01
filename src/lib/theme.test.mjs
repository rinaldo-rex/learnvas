import assert from 'node:assert/strict'
import test from 'node:test'
import { parseThemePreference, resolveTheme } from './theme.ts'

test('only supported saved theme preferences are accepted', () => {
  assert.equal(parseThemePreference('light'), 'light')
  assert.equal(parseThemePreference('dark'), 'dark')
  for (const value of ['system', 'invalid', '', null, undefined, 42]) {
    assert.equal(parseThemePreference(value), 'system')
  }
})

test('system mode follows the OS while explicit preferences override it', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})
