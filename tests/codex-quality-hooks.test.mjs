import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { runHook } from '../tools/codex/quality-hook.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-quality-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q')
  await writeFile(path.join(root, '.gitignore'), '.local/\n')
  await writeFile(
    path.join(root, 'inherited.mjs'),
    'export const inherited = 1\n'
  )
  git('add', '.')
  git(
    '-c',
    'user.name=Quality Test',
    '-c',
    'user.email=quality@example.invalid',
    'commit',
    '-qm',
    'baseline'
  )
  const calls = []
  let valid = true
  const execute = (_root, executable, args) => {
    calls.push({ executable, args })
    return {
      ok: executable === 'pnpm' ? valid : true,
      output: valid ? 'passed' : 'validation failed',
    }
  }

  const hook = (event, extra = {}) =>
    runHook(
      { session_id: 'test-session', hook_event_name: event, ...extra },
      { root, execute }
    )
  return {
    root,
    git,
    calls,
    hook,
    fail: () => {
      valid = false
    },
    pass: () => {
      valid = true
    },
  }
}

test('questions and missing baselines do not validate or change inherited dirty files', async (t) => {
  const f = await fixture(t)
  await writeFile(
    path.join(f.root, 'inherited.mjs'),
    'unfinished inherited work\n'
  )
  assert.deepEqual(await f.hook('PostToolUse'), {})
  await f.hook('UserPromptSubmit', { prompt: 'Explain the code' })
  assert.deepEqual(await f.hook('Stop'), {})
  assert.equal(f.calls.length, 0)
  assert.equal(
    await readFile(path.join(f.root, 'inherited.mjs'), 'utf8'),
    'unfinished inherited work\n'
  )
})

test('edits are processed once, with paths as arguments, without touching the index', async (t) => {
  const f = await fixture(t)
  await writeFile(path.join(f.root, 'inherited.mjs'), 'existing dirty file\n')
  await f.hook('UserPromptSubmit')
  const index = f.git('diff', '--cached')
  const edited = path.join(f.root, 'file with spaces.mjs')
  await writeFile(edited, 'export const ready=!!1\n')
  await f.hook('PostToolUse')
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every(({ args }) => args.includes(edited)))
  assert.ok(
    f.calls.every(
      ({ args }) => !args.includes(path.join(f.root, 'inherited.mjs'))
    )
  )
  assert.ok(f.calls[0].args.includes('unused-imports/no-unused-imports: off'))
  assert.equal(f.git('diff', '--cached'), index)
  await f.hook('PostToolUse')
  assert.equal(f.calls.length, 2)
  await f.hook('Stop')
  await f.hook('Stop')
  assert.equal(
    f.calls.filter(({ executable }) => executable === 'pnpm').length,
    1
  )
})

test('Stop catches missed edits and deletions, and caches successful versions', async (t) => {
  const f = await fixture(t)
  await f.hook('UserPromptSubmit')
  await writeFile(
    path.join(f.root, 'inherited.mjs'),
    'export const changed = 2\n'
  )
  await f.hook('Stop')
  assert.equal(f.calls.length, 3)
  await f.hook('Stop')
  assert.equal(f.calls.length, 3)
  await rm(path.join(f.root, 'inherited.mjs'))
  await f.hook('Stop')
  assert.equal(f.calls.length, 4)
  await f.hook('UserPromptSubmit', { prompt: 'A question with no edits' })
  await f.hook('Stop')
  assert.equal(f.calls.length, 4)
})

test('failed validation continues at most once, and rechecks a repaired version', async (t) => {
  const f = await fixture(t)
  await f.hook('UserPromptSubmit')
  await writeFile(path.join(f.root, 'new.mjs'), 'export const value = 1\n')
  f.fail()
  const failure = await f.hook('Stop')
  assert.equal(failure.decision, 'block')
  assert.match(failure.reason, /^\[codex-quality\]/)
  await f.hook('UserPromptSubmit', { prompt: failure.reason })
  const repeated = await f.hook('Stop', { stop_hook_active: true })
  assert.equal(repeated.decision, undefined)
  assert.match(repeated.systemMessage, /still fail/)
  assert.equal(
    f.calls.filter(({ executable }) => executable === 'pnpm').length,
    1
  )
  f.pass()
  await writeFile(path.join(f.root, 'new.mjs'), 'export const value = 2\n')
  assert.deepEqual(await f.hook('Stop', { stop_hook_active: true }), {})
  assert.equal(
    f.calls.filter(({ executable }) => executable === 'pnpm').length,
    2
  )
})

test('concurrent hooks serialize corrections and ignore symlinks and plan mode', async (t) => {
  const f = await fixture(t)
  await f.hook('UserPromptSubmit')
  await symlink(
    path.join(f.root, 'inherited.mjs'),
    path.join(f.root, 'linked.mjs')
  )
  await writeFile(path.join(f.root, 'new.mjs'), 'export const value = 1\n')
  await f.hook('PostToolUse', { permission_mode: 'plan' })
  assert.equal(f.calls.length, 0)
  await Promise.all([f.hook('PostToolUse'), f.hook('PostToolUse')])
  assert.equal(f.calls.length, 2)
  assert.ok(
    f.calls.every(({ args }) => !args.includes(path.join(f.root, 'linked.mjs')))
  )
})

test('changes during validation are not recorded as a successful validation', async (t) => {
  const f = await fixture(t)
  await f.hook('UserPromptSubmit')
  await writeFile(path.join(f.root, 'new.mjs'), 'export const value = 1\n')
  const result = await runHook(
    { session_id: 'test-session', hook_event_name: 'Stop' },
    {
      root: f.root,
      execute: async (_root, executable) => {
        if (executable === 'pnpm') {
          await writeFile(
            path.join(f.root, 'new.mjs'),
            'export const value = 2\n'
          )
        }

        return { ok: true, output: 'passed' }
      },
    }
  )
  assert.equal(result.decision, 'block')
})
